// Rules for a 3D model for printing, checked on the delivered STL file itself:
//  1. watertight: after joining equal vertices, every edge belongs to exactly two triangles,
//     and the triangles agree on orientation (each directed edge is used once);
//  2. fits the printer bed: the model's size fits the bed in some axis-aligned orientation.
// The bed is a parameter (default 256 × 256 × 256 mm); we do not guess anyone's printer.
// Not checked: thin walls, overhangs, whether it prints beautifully.

export type Mesh = { positions: Float32Array; triangles: number };
export type Bed = [number, number, number];
export const DEFAULT_BED: Bed = [256, 256, 256];

export type MeshFacts = {
  triangles: number;
  vertices: number;
  openEdges: number; // edges not shared by exactly two triangles
  misorientedEdges: number; // directed edges used more than once (faces flipped against neighbours)
  sizeMm: [number, number, number];
};

export type MeshVerdict = { ok: true; facts: MeshFacts; reason: string } | { ok: false; facts: MeshFacts | null; reason: string };

/** Binary or ASCII STL → triangle corner positions (9 floats per triangle). */
export function parseStl(buf: ArrayBuffer): Mesh {
  const dv = new DataView(buf);
  if (buf.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === buf.byteLength) {
      const pos = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12; // skip the stored normal
        for (let k = 0; k < 9; k++) pos[i * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
      return { positions: pos, triangles: n };
    }
  }
  const text = new TextDecoder().decode(buf);
  if (!/^\s*solid/.test(text)) throw new Error('not an STL file');
  const nums = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  if (!nums.length || nums.length % 9 || nums.some((v) => !Number.isFinite(v))) throw new Error('ASCII STL without whole triangles');
  return { positions: Float32Array.from(nums), triangles: nums.length / 9 };
}

export function meshFacts(m: Mesh): MeshFacts {
  const ids = new Map<string, number>();
  const idOf = (i: number) => {
    // equal vertices are written as equal floats; round lightly so 1e-5 noise does not split them
    const k = `${Math.round(m.positions[i]! * 1e4)},${Math.round(m.positions[i + 1]! * 1e4)},${Math.round(m.positions[i + 2]! * 1e4)}`;
    let id = ids.get(k);
    if (id === undefined) ids.set(k, (id = ids.size));
    return id;
  };
  const und = new Map<string, number>();
  const dir = new Map<string, number>();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < m.triangles; t++) {
    const v = [idOf(t * 9), idOf(t * 9 + 3), idOf(t * 9 + 6)];
    for (let c = 0; c < 3; c++) {
      for (let a = 0; a < 3; a++) {
        const x = m.positions[t * 9 + c * 3 + a]!;
        if (x < min[a]!) min[a] = x;
        if (x > max[a]!) max[a] = x;
      }
    }
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue; // degenerate triangle adds no edges
    for (let e = 0; e < 3; e++) {
      const a = v[e]!, b = v[(e + 1) % 3]!;
      const uk = a < b ? `${a}-${b}` : `${b}-${a}`;
      und.set(uk, (und.get(uk) ?? 0) + 1);
      const dk = `${a}>${b}`;
      dir.set(dk, (dir.get(dk) ?? 0) + 1);
    }
  }
  let openEdges = 0;
  for (const n of und.values()) if (n !== 2) openEdges++;
  let misorientedEdges = 0;
  for (const n of dir.values()) if (n > 1) misorientedEdges++;
  const size = [0, 1, 2].map((a) => (m.triangles ? Math.round((max[a]! - min[a]!) * 10) / 10 : 0)) as [number, number, number];
  return { triangles: m.triangles, vertices: ids.size, openEdges, misorientedEdges, sizeMm: size };
}

export function fitsBed(size: [number, number, number], bed: Bed): boolean {
  const s = [...size].sort((a, b) => a - b);
  const b = [...bed].sort((a, c) => a - c);
  return s.every((v, i) => v <= b[i]!);
}

const mm = (s: number[]) => s.map((v) => (Number.isInteger(v) ? v : v.toFixed(1))).join(' × ') + ' mm';

export function checkModel(buf: ArrayBuffer, bed: Bed = DEFAULT_BED): MeshVerdict {
  let m: Mesh;
  try {
    m = parseStl(buf);
  } catch (e) {
    return { ok: false, facts: null, reason: e instanceof Error ? e.message : String(e) };
  }
  if (!m.triangles) return { ok: false, facts: null, reason: 'the file has no triangles' };
  const f = meshFacts(m);
  if (f.openEdges) return { ok: false, facts: f, reason: `not watertight: ${f.openEdges} open edge${f.openEdges > 1 ? 's' : ''}` };
  if (f.misorientedEdges) return { ok: false, facts: f, reason: `faces flipped: ${f.misorientedEdges} edges` };
  if (!fitsBed(f.sizeMm, bed)) return { ok: false, facts: f, reason: `does not fit the ${mm(bed)} bed: ${mm(f.sizeMm)}` };
  return { ok: true, facts: f, reason: `watertight, ${mm(f.sizeMm)}, fits the ${mm(bed)} bed` };
}
