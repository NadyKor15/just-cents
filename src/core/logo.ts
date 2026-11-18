// A logo traced from a sketch into clean outlines (SVG): rules published before any work starts, checked by plain code.
// The file is read as text, so the same checks run in the browser, in the API and in tests.
// Likeness to the sketch (SSIM) is measured by the caller after drawing both at the same size (see image.ts).
import type { Verdict } from './rules';

export const LOGO_RULES = {
  maxColors: 3,
  maxContours: 200,
  maxBytes: 100 * 1024,
  minSsim: 0.85,
  text: 'Logo: an SVG file of clean outlines, up to 3 colours and 200 outlines, no picture pasted inside, up to 100 KB, and like the sketch when drawn (similarity 0.85 or more).',
};

export type SvgFacts = { bytes: number; colors: string[]; contours: number; raster: boolean; active: boolean; root: boolean };

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080' };

/** A colour value → "#rrggbb", or null for none/transparent/references. */
export function normColor(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent' || s === 'inherit' || s === 'currentcolor' || s.startsWith('url(')) return null;
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return '#' + [...m[1]!].map((c) => c + c).join('');
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return '#' + m[1];
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (m) return '#' + [m[1], m[2], m[3]].map((x) => Math.min(255, +x!).toString(16).padStart(2, '0')).join('');
  return NAMED[s] ?? s;
}

export function inspectSvg(svg: string): SvgFacts {
  const bytes = new TextEncoder().encode(svg).length;
  const body = svg.replace(/<!--[\s\S]*?-->/g, '');
  const colors = new Set<string>();
  for (const m of body.matchAll(/\b(fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*([^"';>]+)/gi)) {
    const c = normColor(m[2]!);
    if (c) colors.add(c);
  }
  let contours = 0;
  for (const m of body.matchAll(/<path\b[^>]*\sd\s*=\s*["']([^"']*)["']/gi)) contours += (m[1]!.match(/[Mm]/g) ?? []).length;
  contours += (body.match(/<(polygon|polyline|rect|circle|ellipse|line)\b/gi) ?? []).length;
  const raster = /<image\b/i.test(body) || /data:image\//i.test(body) || /<foreignObject\b/i.test(body);
  const active = /<script\b/i.test(body) || /\son[a-z]+\s*=/i.test(body) || /javascript:/i.test(body);
  const root = /^\s*(<\?xml[^>]*>\s*)?(<!DOCTYPE[^>]*>\s*)?<svg\b/i.test(svg);
  return { bytes, colors: [...colors], contours, raster, active, root };
}

export function checkLogo(svg: string, likeness: number): Verdict {
  const R = LOGO_RULES, f = inspectSvg(svg);
  if (!f.root) return { ok: false, reason: 'not an SVG file' };
  if (f.active) return { ok: false, reason: 'the SVG has scripts in it' };
  if (f.raster) return { ok: false, reason: 'a picture is pasted inside, not outlines' };
  if (f.bytes > R.maxBytes) return { ok: false, reason: `the file is ${Math.round(f.bytes / 1024)} KB, at most 100 KB` };
  if (f.colors.length > R.maxColors) return { ok: false, reason: `${f.colors.length} colours, at most ${R.maxColors}` };
  if (f.contours > R.maxContours) return { ok: false, reason: `${f.contours} outlines, at most ${R.maxContours}` };
  if (!(likeness >= R.minSsim)) return { ok: false, reason: `not like the sketch: similarity ${likeness.toFixed(2)}, at least ${R.minSsim}` };
  return { ok: true, note: `${f.colors.length} colours, ${f.contours} outlines, similarity ${likeness.toFixed(2)}` };
}
