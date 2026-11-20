// An invisible layer must not take taps. The toast is hidden with opacity 0 and sits over the bottom of the screen,
// where Pay is on a phone: without pointer-events:none, Pay stopped working after the pay window was closed once
// (seen on the live site, iPhone size, 20.11.2026).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../public/assets/site.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Flat rules (selector → declarations), media blocks included. */
function rules(text: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m; (m = re.exec(text)); ) out.push([m[1]!.trim().replace(/^.*@media[^{]*$/s, '').trim(), m[2]!]);
  return out;
}

const decl = (body: string, prop: string) => body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1]?.trim();

describe('invisible layers', () => {
  it('the hidden toast does not take taps', () => {
    const toast = rules(css).find(([sel]) => sel === '.jc-toast');
    expect(toast).toBeTruthy();
    expect(decl(toast![1], 'opacity')).toBe('0');
    expect(decl(toast![1], 'pointer-events')).toBe('none');
  });

  it('every rule that hides an element with opacity 0 also lets taps through', () => {
    const hidden = rules(css).filter(([, body]) => decl(body, 'opacity') === '0');
    expect(hidden.length).toBeGreaterThan(0);
    for (const [sel, body] of hidden) expect(`${sel}: ${decl(body, 'pointer-events') ?? 'auto'}`).toBe(`${sel}: none`);
  });
});
