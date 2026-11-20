// On a slow line the checks' own small files must not wait behind the 4.5 MB sealed cover: the sealed files start
// loading only after every check has answered (a rejected or failed check counts as answered), and only the accepted
// parts are fetched. Measured 20.11.2026: the cover's download started at Start, the subtitle previews waited behind
// it, the scene stopped at the subtitles and Pay never came up.
import { describe, expect, it, vi } from 'vitest';
import { Order } from '../src/app/order';
import { OFFERS } from '../src/data/offers';

function deferred<T = unknown>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}

function order(): Order {
  const o = new Order('chipnet', 'sam');
  const put = (slot: string, key: string, ok: boolean, who?: 'sam' | 'lena') =>
    (o.results[slot] = { key, who, verdict: ok ? { ok: true, note: '' } : { ok: false, reason: 'late' }, offer: OFFERS.chipnet[key]!.signed, detail: '' } as never);
  put('cover', 'cover', true);
  put('cover:b', 'cover:b', true);
  put('sam', 'sam:careless', false, 'sam');
  put('lena', 'lena:good', true, 'lena');
  put('logo', 'logo', true);
  return o;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('sealed files load after the checks', () => {
  it('nothing is fetched while any check is still out; then exactly the accepted parts', async () => {
    const o = order();
    const spy = vi.spyOn(o, 'prefetch').mockImplementation(() => undefined);
    const cover = deferred(), bad = deferred(), good = deferred(), logo = deferred();
    const done = o.prefetchAccepted([cover.promise, bad.promise, good.promise, logo.promise]);
    cover.resolve(1); // the cover's check is instant (no network): this used to start the 4.5 MB download at once
    logo.resolve(1);
    await tick();
    expect(spy).not.toHaveBeenCalled();
    bad.resolve(1);
    await tick();
    expect(spy).not.toHaveBeenCalled(); // the good subtitles' preview is still on its way
    good.resolve(1);
    await done;
    expect(spy.mock.calls.map((c) => c[0]).sort()).toEqual(['cover', 'lena:good', 'logo']);
  });

  it('a check that failed still lets the others load (it counts as answered)', async () => {
    const o = order();
    const spy = vi.spyOn(o, 'prefetch').mockImplementation(() => undefined);
    const a = deferred(), b = deferred();
    const done = o.prefetchAccepted([a.promise, b.promise]);
    a.reject(new Error('preview did not load'));
    await tick();
    expect(spy).not.toHaveBeenCalled();
    b.resolve(1);
    await done;
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('the rejected part and the cover not chosen are never fetched', async () => {
    const o = order();
    const spy = vi.spyOn(o, 'prefetch').mockImplementation(() => undefined);
    await o.prefetchAccepted([Promise.resolve()]);
    const keys = spy.mock.calls.map((c) => c[0]);
    expect(keys).not.toContain('sam:careless');
    expect(keys).not.toContain('cover:b');
  });
});

describe('the page wires it so', () => {
  it('runChecks starts the sealed files only through prefetchAccepted, never right after one check', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/app/controller.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('function runChecks('), src.indexOf('\n}\n', src.indexOf('function runChecks(')));
    expect(body).toMatch(/o\.prefetchAccepted\(\[icon, descBad, descGood, voice\]\)/);
    expect(body).not.toMatch(/o\.prefetch\(/);
  });
});
