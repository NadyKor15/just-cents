import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkModel, fitsBed, parseStl } from '../src/core/mesh';

// a unit cube from 12 triangles, outward-facing; drop or flip faces to break it
const CUBE: number[][][] = [
  [[0, 0, 0], [0, 1, 0], [1, 1, 0]], [[0, 0, 0], [1, 1, 0], [1, 0, 0]], // bottom (−z)
  [[0, 0, 1], [1, 0, 1], [1, 1, 1]], [[0, 0, 1], [1, 1, 1], [0, 1, 1]], // top (+z)
  [[0, 0, 0], [1, 0, 0], [1, 0, 1]], [[0, 0, 0], [1, 0, 1], [0, 0, 1]], // front (−y)
  [[0, 1, 0], [0, 1, 1], [1, 1, 1]], [[0, 1, 0], [1, 1, 1], [1, 1, 0]], // back (+y)
  [[0, 0, 0], [0, 0, 1], [0, 1, 1]], [[0, 0, 0], [0, 1, 1], [0, 1, 0]], // left (−x)
  [[1, 0, 0], [1, 1, 0], [1, 1, 1]], [[1, 0, 0], [1, 1, 1], [1, 0, 1]], // right (+x)
];

function stl(tris: number[][][], scale = 1): ArrayBuffer {
  const b = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(b);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.flat().forEach((v, k) => dv.setFloat32(84 + i * 50 + 12 + k * 4, v * scale, true)));
  return b;
}

describe('3D model rules', () => {
  it('a closed cube passes', () => {
    const v = checkModel(stl(CUBE, 10));
    expect(v.ok).toBe(true);
    expect(v.facts?.openEdges).toBe(0);
    expect(v.facts?.sizeMm).toEqual([10, 10, 10]);
  });

  it('a cube with one triangle missing is not watertight', () => {
    const v = checkModel(stl(CUBE.slice(1), 10));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/not watertight: 3 open edges/);
  });

  it('a flipped face is caught', () => {
    const t = CUBE.map((x) => x.slice());
    t[2] = [t[2]![0]!, t[2]![2]!, t[2]![1]!];
    t[3] = [t[3]![0]!, t[3]![2]!, t[3]![1]!];
    expect(checkModel(stl(t, 10)).reason).toMatch(/faces flipped/);
  });

  it('too big for the bed', () => {
    const v = checkModel(stl(CUBE, 300));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/does not fit the 256 × 256 × 256 mm bed: 300 × 300 × 300 mm/);
    expect(checkModel(stl(CUBE, 300), [300, 300, 300]).ok).toBe(true);
  });

  it('the bed fit allows turning the model', () => {
    expect(fitsBed([300, 20, 10], [256, 256, 400])).toBe(true);
    expect(fitsBed([300, 20, 10], [256, 256, 256])).toBe(false);
  });

  it('ASCII STL is read too', () => {
    const txt = 'solid x\n' + CUBE.map((t) => 'facet normal 0 0 0\nouter loop\n' + t.map((p) => `vertex ${p.join(' ')}`).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid x\n';
    const buf = new TextEncoder().encode(txt).buffer as ArrayBuffer;
    expect(parseStl(buf).triangles).toBe(12);
    expect(checkModel(buf).ok).toBe(true);
  });

  it('a figure made from a game sprite is watertight by construction', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jc-fig-'));
    for (const args of [['specialists/source-art/stand-1.webp'], ['specialists/source-art/walk-1.webp', '--grid', '16,3', '--frame', '14,1']]) {
      const out = join(dir, 'f.stl');
      execFileSync('python3', ['scripts/make-figure.py', args[0]!, out, ...args.slice(1)]);
      const f = readFileSync(out);
      const v = checkModel(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
      expect(v.ok, v.reason).toBe(true);
      expect(v.facts!.sizeMm[1]).toBe(80);
    }
  });
});
