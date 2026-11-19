// The sealed files' download on a slow, uneven site: cut only on a stall (no new byte for stallMs), never because it
// is slow; a cut costs one part; parts that arrived are kept, also across a failed download; without parts on the
// site the file comes whole. A fake site serves bytes the way a test asks: whole, in pieces over time, stuck midway,
// stuck before answering, a wrong length, or 404.
import { describe, expect, it } from 'vitest';
import { download, getBytes, HttpStatus, type FetchFn } from '../src/app/download';
import { PART_BYTES, partCount, partLength, partPath } from '../src/core/parts';

type Way =
  | { kind: 'ok' }
  | { kind: 'pieces'; bytes: number; everyMs: number } // the whole answer, a piece at a time
  | { kind: 'stuck-after'; bytes: number } // sends this many bytes, then nothing more
  | { kind: 'no-answer' } // never answers
  | { kind: 'short' } // answers one byte less, and ends
  | { kind: 'status'; status: number };

const STALL = 150;
const fast = { stallMs: STALL, pauseMs: 1 };

function file(size: number, seed = 7): Uint8Array {
  const b = new Uint8Array(size);
  let x = seed;
  for (let i = 0; i < size; i++) b[i] = x = (x * 1103515245 + 12345) & 0xff;
  return b;
}

/** A fake site: `files` by path; parts (<path>.p<i>) cut from the files when `parts` is on. */
function site(files: Record<string, Uint8Array>, opts: { parts: boolean; way?: (url: string, n: number) => Way }) {
  const calls: Record<string, number> = {};
  const fetchFn: FetchFn = (url, { signal }) => {
    const n = (calls[url] = (calls[url] ?? 0) + 1);
    const m = /^(.*)\.p(\d+)$/.exec(url);
    let body: Uint8Array | undefined;
    if (m && opts.parts && files[m[1]!]) {
      const whole = files[m[1]!]!;
      const i = Number(m[2]);
      if (i < partCount(whole.length)) body = whole.slice(i * PART_BYTES, i * PART_BYTES + partLength(whole.length, i));
    } else if (!m) body = files[url];
    const way: Way = body ? (opts.way?.(url, n) ?? { kind: 'ok' }) : { kind: 'status', status: 404 };
    const aborted = () => new DOMException('The operation was aborted.', 'AbortError');
    if (way.kind === 'no-answer') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(aborted())));
    if (way.kind === 'status') return Promise.resolve(new Response('no', { status: way.status }));
    const b = way.kind === 'short' ? body!.slice(0, body!.length - 1) : body!;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        signal.addEventListener('abort', () => {
          timers.forEach(clearTimeout);
          try {
            c.error(aborted());
          } catch {
            /* already closed */
          }
        });
        if (way.kind === 'ok' || way.kind === 'short') {
          c.enqueue(b);
          c.close();
        } else if (way.kind === 'stuck-after') {
          c.enqueue(b.slice(0, way.bytes)); // and then nothing, never closed
        } else {
          for (let at = 0, k = 1; at < b.length; at += way.bytes, k++) {
            const piece = b.slice(at, at + way.bytes);
            const last = at + way.bytes >= b.length;
            timers.push(
              setTimeout(() => {
                c.enqueue(piece);
                if (last) c.close();
              }, k * way.everyMs),
            );
          }
        }
      },
    });
    return Promise.resolve(new Response(stream, { headers: { 'content-length': String(b.length) } }));
  };
  return { fetchFn, calls };
}

const URL_ = '/enc/chipnet/big.jce';

describe('a big file comes in parts; a cut costs one part', () => {
  it('a part stuck midway is cut on its stall and fetched again on its own; the other parts once each', async () => {
    const data = file(3 * PART_BYTES + 1000); // 4 parts
    const s = site({ [URL_]: data }, { parts: true, way: (u, n) => (u === partPath(URL_, 1) && n === 1 ? { kind: 'stuck-after', bytes: 200_000 } : { kind: 'ok' }) });
    const t0 = Date.now();
    const got = await download(URL_, { ...fast, size: data.length, fetchFn: s.fetchFn });
    expect(got).toEqual(data);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(STALL - 10);
    expect(s.calls).toEqual({ [partPath(URL_, 0)]: 1, [partPath(URL_, 1)]: 2, [partPath(URL_, 2)]: 1, [partPath(URL_, 3)]: 1 });
  });

  it('a failed download keeps its parts: the next try fetches only the part that was missing', async () => {
    const data = file(3 * PART_BYTES + 5, 3);
    let broken = true;
    const s = site({ [URL_]: data }, { parts: true, way: (u) => (u === partPath(URL_, 2) && broken ? { kind: 'stuck-after', bytes: 10 } : { kind: 'ok' }) });
    const store: (Uint8Array | undefined)[] = [];
    await expect(download(URL_, { ...fast, tries: 2, size: data.length, store, fetchFn: s.fetchFn })).rejects.toThrow(/stalled, no data/);
    expect(store.filter(Boolean)).toHaveLength(3);
    broken = false;
    const got = await download(URL_, { ...fast, tries: 2, size: data.length, store, fetchFn: s.fetchFn });
    expect(got).toEqual(data);
    expect(s.calls).toEqual({ [partPath(URL_, 0)]: 1, [partPath(URL_, 1)]: 1, [partPath(URL_, 2)]: 3, [partPath(URL_, 3)]: 1 });
  });

  it('a part of the wrong length is fetched again', async () => {
    const data = file(PART_BYTES + 77, 5);
    const s = site({ [URL_]: data }, { parts: true, way: (u, n) => (u === partPath(URL_, 0) && n === 1 ? { kind: 'short' } : { kind: 'ok' }) });
    expect(await download(URL_, { ...fast, size: data.length, fetchFn: s.fetchFn })).toEqual(data);
    expect(s.calls[partPath(URL_, 0)]).toBe(2);
  });

  it('progress ends at the full size, and a broken part\'s bytes are taken back', async () => {
    const data = file(2 * PART_BYTES + 9, 11);
    const s = site({ [URL_]: data }, { parts: true, way: (u, n) => (u === partPath(URL_, 0) && n === 1 ? { kind: 'stuck-after', bytes: 300_000 } : { kind: 'ok' }) });
    const seen: [number, number][] = [];
    await download(URL_, { ...fast, parallel: 1, size: data.length, fetchFn: s.fetchFn, onProgress: (g, t) => seen.push([g, t]) });
    expect(seen.every(([g, t]) => t === data.length && g >= 0 && g <= data.length)).toBe(true);
    expect(seen).toContainEqual([300_000, data.length]);
    expect(seen).toContainEqual([0, data.length]); // the stuck try's 300 000 bytes no longer count
    expect(seen.at(-1)).toEqual([data.length, data.length]);
  });

  it('gives up after its tries and says the download stalled', async () => {
    const data = file(PART_BYTES + 1);
    const s = site({ [URL_]: data }, { parts: true, way: (u) => (u === partPath(URL_, 1) ? { kind: 'stuck-after', bytes: 0 } : { kind: 'ok' }) });
    await expect(download(URL_, { ...fast, tries: 3, size: data.length, fetchFn: s.fetchFn })).rejects.toThrow(/\.p1: stalled, no data for/);
    expect(s.calls[partPath(URL_, 1)]).toBe(3);
  });
});

describe('the stall rule', () => {
  it('a slow but moving download is never cut, even when it takes many times the stall time', async () => {
    const data = file(48_000, 9);
    const s = site({ [URL_]: data }, { parts: false, way: () => ({ kind: 'pieces', bytes: 4_000, everyMs: 60 }) }); // 12 pieces ≈ 0.7 s
    const t0 = Date.now();
    expect(await download(URL_, { ...fast, fetchFn: s.fetchFn })).toEqual(data);
    expect(Date.now() - t0).toBeGreaterThan(4 * STALL);
    expect(s.calls[URL_]).toBe(1);
  });

  it('no answer at all: cut after the stall time and tried again', async () => {
    const data = file(1000);
    const s = site({ [URL_]: data }, { parts: false, way: (_u, n) => (n === 1 ? { kind: 'no-answer' } : { kind: 'ok' }) });
    const t0 = Date.now();
    expect(await download(URL_, { ...fast, fetchFn: s.fetchFn })).toEqual(data);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(STALL - 10);
    expect(s.calls[URL_]).toBe(2);
  });

  it('getBytes reports the length the server gives and each piece as it comes', async () => {
    const data = file(10_000);
    const s = site({ [URL_]: data }, { parts: false, way: () => ({ kind: 'pieces', bytes: 2_500, everyMs: 5 }) });
    let len = 0;
    const pieces: number[] = [];
    expect(await getBytes(URL_, s.fetchFn, STALL, (n) => pieces.push(n), (l) => (len = l))).toEqual(data);
    expect(len).toBe(10_000);
    expect(pieces).toEqual([2_500, 2_500, 2_500, 2_500]);
  });
});

describe('without parts on the site', () => {
  it('a part answers 404 (the dev server): the file comes whole, once', async () => {
    const data = file(2 * PART_BYTES + 3, 13);
    const s = site({ [URL_]: data }, { parts: false });
    expect(await download(URL_, { ...fast, size: data.length, fetchFn: s.fetchFn })).toEqual(data);
    expect(s.calls[URL_]).toBe(1);
    expect(s.calls[partPath(URL_, 0)]).toBe(1);
  });

  it('a small file is never asked for in parts', async () => {
    const data = file(PART_BYTES);
    const s = site({ [URL_]: data }, { parts: true });
    expect(await download(URL_, { ...fast, size: data.length, fetchFn: s.fetchFn })).toEqual(data);
    expect(Object.keys(s.calls)).toEqual([URL_]);
  });

  it('a whole file that stalls starts again; a 404 is not retried', async () => {
    const data = file(30_000);
    const s = site({ [URL_]: data }, { parts: false, way: (_u, n) => (n === 1 ? { kind: 'stuck-after', bytes: 1000 } : { kind: 'ok' }) });
    expect(await download(URL_, { ...fast, fetchFn: s.fetchFn })).toEqual(data);
    expect(s.calls[URL_]).toBe(2);
    const gone = site({}, { parts: false });
    await expect(download('/enc/none.jce', { ...fast, fetchFn: gone.fetchFn })).rejects.toBeInstanceOf(HttpStatus);
    expect(gone.calls['/enc/none.jce']).toBe(1);
  });
});
