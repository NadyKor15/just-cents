// Downloads on a slow, uneven site: Cloudflare's speed for the same file swings from 0.2 to 5 MB/s, and it ignores
// Range on static files. So a download is cut only when it STALLS (no new byte for `stallMs`), never because it is
// slow, and a cut costs at most one part: a big file comes as parts (src/core/parts.ts), a few at a time; a part
// that stalls or breaks is fetched again on its own; parts that arrived are kept in `store`, which the caller keeps,
// so even a failed download's parts are reused by the next try. Without published parts (a 404 on a part, e.g. the
// dev server) the file comes whole, with the same stall rule. The caller checks the joined bytes against the
// fingerprint it trusts: a part can delay a file, never change it.
import { PART_BYTES, partCount, partLength, partPath } from '../core/parts';

/** No new byte for this long = the download stalled. */
export const STALL_MS = 15_000;
/** Tries per part (or per whole file). */
export const TRIES = 4;
/** Parts in flight at once. */
export const PARALLEL = 3;

export type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

export type DownloadOpts = {
  /** The file's size in bytes, when known: a file larger than one part is fetched in parts. */
  size?: number;
  /** Parts already here (index → bytes); filled as parts arrive, kept by the caller across tries. */
  store?: (Uint8Array | undefined)[];
  /** Bytes in so far, of the total (the total is 0 until known). */
  onProgress?: (got: number, total: number) => void;
  stallMs?: number;
  tries?: number;
  parallel?: number;
  /** Pause before try n+1: pauseMs × n. */
  pauseMs?: number;
  fetchFn?: FetchFn;
};

/** The server answered, but not with the file. */
export class HttpStatus extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`${url}: HTTP ${status}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const defaultFetch: FetchFn = (url, init) => fetch(url, init);

/**
 * One GET, read to its end. It is cut only when nothing arrives for `stallMs`: neither the answer nor a new piece of
 * the body. A slow but moving download is never cut.
 */
export async function getBytes(url: string, fetchFn: FetchFn, stallMs: number, onBytes: (n: number) => void, onLength?: (n: number) => void): Promise<Uint8Array> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stalled = false;
  let cut: (e: Error) => void = () => undefined;
  const cutP = new Promise<never>((_, reject) => (cut = reject));
  cutP.catch(() => undefined);
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      cut(new Error(`${url}: stalled, no data for ${Math.round(stallMs / 1000)} s`));
      ac.abort();
    }, stallMs);
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  arm();
  try {
    const r = await Promise.race([fetchFn(url, { signal: ac.signal }), cutP]);
    if (!r.ok) {
      void r.body?.cancel().catch(() => undefined);
      throw new HttpStatus(r.status, url);
    }
    const len = Number(r.headers.get('content-length'));
    if (len > 0) onLength?.(len);
    if (!r.body) {
      const b = new Uint8Array(await Promise.race([r.arrayBuffer(), cutP]));
      onBytes(b.length);
      return b;
    }
    reader = r.body.getReader();
    const pieces: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), cutP]);
      if (done) break;
      if (!value?.length) continue;
      pieces.push(value);
      n += value.length;
      onBytes(value.length);
      arm(); // new bytes: the stall clock starts again
    }
    const out = new Uint8Array(n);
    let at = 0;
    for (const p of pieces) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  } catch (e) {
    if (stalled) void reader?.cancel().catch(() => undefined);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches a file: in parts when it is published in parts (size known and above one part), else whole. */
export async function download(url: string, o: DownloadOpts = {}): Promise<Uint8Array> {
  const n = o.size ? partCount(o.size) : 0;
  if (n) {
    const joined = await inParts(url, o.size!, n, o);
    if (joined) return joined;
  }
  return whole(url, o);
}

/** The parts of one file, a few at a time; null when the site does not publish parts of it (a part answers 404). */
async function inParts(url: string, size: number, n: number, o: DownloadOpts): Promise<Uint8Array | null> {
  const fetchFn = o.fetchFn ?? defaultFetch;
  const stallMs = o.stallMs ?? STALL_MS;
  const tries = o.tries ?? TRIES;
  const pauseMs = o.pauseMs ?? 1000;
  const store = o.store ?? [];
  if (store.length !== n || store.some((p, i) => p && p.length !== partLength(size, i))) store.splice(0, store.length, ...new Array<undefined>(n));
  let have = 0;
  for (const p of store) have += p?.length ?? 0;
  const report = () => o.onProgress?.(have, size);
  report();
  const queue = [...Array(n).keys()].filter((i) => !store[i]);
  let missing = false;
  let failed: Error | null = null;
  const worker = async () => {
    while (queue.length && !failed && !missing) {
      const i = queue.shift()!;
      for (let t = 1; ; t++) {
        let partial = 0;
        try {
          const b = await getBytes(partPath(url, i), fetchFn, stallMs, (k) => {
            partial += k;
            have += k;
            report();
          });
          if (b.length !== partLength(size, i)) throw new Error(`${partPath(url, i)}: ${b.length} bytes, expected ${partLength(size, i)}`);
          store[i] = b;
          break;
        } catch (e) {
          have -= partial; // a broken part's bytes do not count; the parts that arrived stay
          report();
          if (e instanceof HttpStatus && e.status === 404) {
            missing = true;
            return;
          }
          if (t >= tries || failed) {
            failed ??= e instanceof Error ? e : new Error(String(e));
            return;
          }
          await sleep(pauseMs * t);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.parallel ?? PARALLEL, queue.length) }, () => worker()));
  if (missing) return null;
  if (failed) throw failed;
  const out = new Uint8Array(size);
  for (let i = 0; i < n; i++) {
    const p = store[i];
    if (!p) throw new Error(`${partPath(url, i)}: missing`);
    out.set(p, i * PART_BYTES);
  }
  return out;
}

/** The whole file in one GET; a stalled try starts again from the beginning (only when no parts are published). */
async function whole(url: string, o: DownloadOpts): Promise<Uint8Array> {
  const fetchFn = o.fetchFn ?? defaultFetch;
  const tries = o.tries ?? TRIES;
  const pauseMs = o.pauseMs ?? 1000;
  let total = o.size ?? 0;
  for (let t = 1; ; t++) {
    let got = 0;
    try {
      return await getBytes(
        url,
        fetchFn,
        o.stallMs ?? STALL_MS,
        (k) => {
          got += k;
          o.onProgress?.(got, total);
        },
        (len) => (total = len),
      );
    } catch (e) {
      o.onProgress?.(0, total);
      if (t >= tries || (e instanceof HttpStatus && e.status === 404)) throw e;
      await sleep(pauseMs * t);
    }
  }
}
