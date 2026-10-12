import { joint, spineExp, type Cfg, type V } from "./kin";
/** Pure mesh builders (no three.js). The page and the software renderer consume the SAME buffers. */
export interface Mesh { pos: number[]; nor: number[]; idx: number[]; uv?: number[] }
const bump = (u: number) => { const a = 1 - Math.min(1, Math.abs(u)); return a * a * a * (a * (a * 6 - 15) + 10); };
const area = (p: V[]) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length] as V, r = p[i] as V; a += r[0] * q[1] - q[0] * r[1]; } return a / 2; };

/** Ear clipping for a simple polygon (x,z). Returns triangles as index triples into `p`. */
export function earClip(p0: V[]): number[] {
  const n = p0.length; if (n < 3) return [];
  const ccw = area(p0) > 0, ix = Array.from({ length: n }, (_, i) => (ccw ? i : n - 1 - i)), out: number[] = [];
  const P = (i: number) => p0[i] as V;
  const cross = (a: V, b: V, c: V) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (a: V, b: V, c: V, q: V) => cross(a, b, q) >= -1e-14 && cross(b, c, q) >= -1e-14 && cross(c, a, q) >= -1e-14;
  let guard = 0;
  while (ix.length > 3 && guard++ < 20000) {
    let clipped = false;
    for (let k = 0; k < ix.length; k++) {
      const a = ix[(k + ix.length - 1) % ix.length] as number, b = ix[k] as number, c = ix[(k + 1) % ix.length] as number;
      if (cross(P(a), P(b), P(c)) <= 1e-15) continue;
      let ok = true;
      for (const j of ix) { if (j === a || j === b || j === c) continue; if (inside(P(a), P(b), P(c), P(j))) { ok = false; break; } }
      if (ok) { out.push(a, b, c); ix.splice(k, 1); clipped = true; break; }
    }
    if (!clipped) { const a = ix[ix.length - 1] as number, b = ix[0] as number, c = ix[1] as number; out.push(a, b, c); ix.splice(0, 1); }   // degenerate fallback
  }
  if (ix.length === 3) out.push(ix[0] as number, ix[1] as number, ix[2] as number);
  return out;
}

/** Extrude an (x,z) polygon along y in [y0,y1]. Every triangle is wound so its geometric normal points OUT (checked per face). */
export function extrude(poly: V[], y0: number, y1: number, smooth = 0.6): Mesh {
  const pts = poly.filter((p, i) => { const q = poly[(i + 1) % poly.length] as V; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9; });
  const m: Mesh = { pos: [], nor: [], idx: [] }, ccw = area(pts) > 0, n = pts.length;
  const push = (a: number[], b: number[], c: number[], nn: number[][]) => {
    const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const g = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const want = nn[0]!, flip = g[0]! * want[0]! + g[1]! * want[1]! + g[2]! * want[2]! < 0, base = m.pos.length / 3;
    const vs = flip ? [a, c, b] : [a, b, c], ns = flip ? [nn[0]!, nn[2]!, nn[1]!] : nn;
    for (let k = 0; k < 3; k++) { m.pos.push(...(vs[k] as number[])); m.nor.push(...(ns[k] as number[])); }
    m.idx.push(base, base + 1, base + 2);
  };
  const tri = earClip(pts);
  for (let t = 0; t < tri.length; t += 3) {
    const a = pts[tri[t] as number] as V, b = pts[tri[t + 1] as number] as V, c = pts[tri[t + 2] as number] as V;
    push([a[0], y1, a[1]], [b[0], y1, b[1]], [c[0], y1, c[1]], [[0, 1, 0], [0, 1, 0], [0, 1, 0]]);
    push([a[0], y0, a[1]], [b[0], y0, b[1]], [c[0], y0, c[1]], [[0, -1, 0], [0, -1, 0], [0, -1, 0]]);
  }
  const en = (i: number): V => { const a = pts[i] as V, b = pts[(i + 1) % n] as V, dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return ccw ? [dz / l, -dx / l] : [-dz / l, dx / l]; };
  const vn = (i: number, e: V, ePrev: V): V => { const d = e[0] * ePrev[0] + e[1] * ePrev[1]; if (d < smooth) return e; const s: V = [e[0] + ePrev[0], e[1] + ePrev[1]], l = Math.hypot(s[0], s[1]) || 1; return [s[0] / l, s[1] / l]; };
  for (let i = 0; i < n; i++) {
    const a = pts[i] as V, b = pts[(i + 1) % n] as V, e = en(i), eP = en((i + n - 1) % n), eN = en((i + 1) % n), na = vn(i, e, eP), nb = vn(i + 1, e, eN);
    const A0 = [a[0], y0, a[1]], A1 = [a[0], y1, a[1]], B0 = [b[0], y0, b[1]], B1 = [b[0], y1, b[1]];
    push(A0, B0, B1, [[na[0], 0, na[1]], [nb[0], 0, nb[1]], [nb[0], 0, nb[1]]]);
    push(A0, B1, A1, [[na[0], 0, na[1]], [nb[0], 0, nb[1]], [na[0], 0, na[1]]]);
  }
  return m;
}

/** The user's board outline, exactly as in the design file (front board, outer face at +T/2). */
export function boardOutline(c: Cfg): V[] {
  const { half, jointX } = joint(c), W = c.width, T = c.pageDepth + c.boardThickness * 2, hingeX = -W / 2 + c.grooveOffset, overlap = Math.min(0.005, half * 0.3);
  const BOARD = c.boardThickness, D = Math.min(c.grooveDepth, BOARD * 0.7), R = Math.min(c.cornerRadius, BOARD * 0.45), out = T / 2, inn = T / 2 - BOARD, tip = jointX - overlap;
  const grooveY = (x: number) => out - D * bump((x - hingeX) / half), x0 = W / 2 - R, s: V[] = [[x0, out]];
  for (let i = 1; i <= 160; i++) { const x = x0 + ((tip - x0) * i) / 160; s.push([x, grooveY(x)]); }
  s.push([tip, inn], [W / 2, inn], [W / 2, out - R]);
  for (let i = 1; i <= 16; i++) { const a = (i / 16) * (Math.PI / 2); s.push([W / 2 - R * (1 - Math.cos(a)), out - R + R * Math.sin(a)]); }
  return s;
}
/** The user's spine bridge outline (outer curve, cap, inner curve, cap). */
export function spineOutline(c: Cfg): V[] {
  const { jointX } = joint(c), BOARD = c.boardThickness, crown = -c.width / 2 - c.spineBuckle, m = spineExp(c), T = c.pageDepth + BOARD * 2;
  const b = T / 2, a = Math.max(1e-4, jointX - crown), bIn = Math.max(1e-4, b - BOARD), aIn = Math.max(1e-4, jointX - (crown + BOARD));
  const prof = (y: number, aa: number, bb: number, x0: number) => { const Y = Math.min(1, Math.abs(y) / bb); return x0 + aa * (1 - Math.pow(Math.max(0, 1 - Math.pow(Y, m)), 1 / m)); };
  const N = 192, s: V[] = [[jointX, b]];
  for (let i = 1; i <= N; i++) { const y = b - (2 * b * i) / N; s.push([prof(y, a, b, crown), y]); }
  s.push([jointX, -bIn]);
  for (let i = 1; i <= N; i++) { const y = -bIn + (2 * bIn * i) / N; s.push([prof(y, aIn, bIn, crown + BOARD), y]); }
  return s;
}
export const circle = (cx: number, cz: number, r: number, n = 28): V[] => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cz + r * Math.sin((2 * Math.PI * i) / n)] as V);
export const rect = (x0: number, z0: number, x1: number, z1: number): V[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
export const flipZ = (p: V[]): V[] => p.map(([x, z]) => [x, -z] as V);

/**
 * A page surface swept along a curve (x,z per row) across the book height. `back` = the verso: opposite normal, mirrored u, lifted the other way,
 * so a turning leaf has two faces that never z-fight. Front normal = left of the direction of travel (up while the leaf rests on the right).
 */
export function leafRibbon(x: ArrayLike<number>, z: ArrayLike<number>, y0: number, y1: number, o: { back?: boolean; lift?: number; twist?: number; cols?: number } = {}): Mesh {
  const rows = x.length, cols = o.cols ?? 8, back = !!o.back, lift = o.lift ?? 0.0006, tw = o.twist ?? 0, sg = back ? -1 : 1;
  const m: Mesh = { pos: [], nor: [], idx: [], uv: [] }, nx: number[] = [], nz: number[] = [];
  for (let j = 0; j < rows; j++) { const a = Math.max(0, j - 1), b = Math.min(rows - 1, j + 1); let tx = (x[b] as number) - (x[a] as number), tz = (z[b] as number) - (z[a] as number); const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; nx.push(-tz); nz.push(tx); }
  for (let j = 0; j < rows; j++) for (let i = 0; i <= cols; i++) {
    const yn = i / cols, u = j / (rows - 1);
    m.pos.push((x[j] as number) + sg * (nx[j] as number) * lift, y0 + (y1 - y0) * yn, (z[j] as number) + sg * (nz[j] as number) * lift + tw * (yn - 0.5) * u * u);
    m.nor.push(sg * (nx[j] as number), 0, sg * (nz[j] as number)); m.uv!.push(back ? 1 - u : u, yn);
  }
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + cols + 1, c = a + 1, d = b + 1;
    for (const t of [[a, b, c], [b, d, c]] as number[][]) {
      const P = t.map((q) => [m.pos[q * 3] as number, m.pos[q * 3 + 1] as number, m.pos[q * 3 + 2] as number]), N = [m.nor[t[0]! * 3] as number, 0, m.nor[t[0]! * 3 + 2] as number];
      const e1 = [P[1]![0]! - P[0]![0]!, P[1]![1]! - P[0]![1]!, P[1]![2]! - P[0]![2]!], e2 = [P[2]![0]! - P[0]![0]!, P[2]![1]! - P[0]![1]!, P[2]![2]! - P[0]![2]!];
      const gx = e1[1]! * e2[2]! - e1[2]! * e2[1]!, gy = e1[2]! * e2[0]! - e1[0]! * e2[2]!, gz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
      if (gx * N[0]! + gy * N[1]! + gz * N[2]! >= 0) m.idx.push(t[0]!, t[1]!, t[2]!); else m.idx.push(t[0]!, t[2]!, t[1]!);
    }
  }
  return m;
}
