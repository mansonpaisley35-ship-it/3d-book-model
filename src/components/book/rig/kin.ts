import { clamp, lerp, sstep5, profileAnglesTo, chain, leafCurve, type Prof, type Curve } from "./math";

/** Pure planar mechanism of the open book (no three.js). x = across the book, z = through its thickness, y = height. */
export const LEAVES = 36, SEGS = 26, NA = 256;   // LEAVES is only the DEFAULT leaf count: every function takes the real one from the layout (L.N)
export type V = [number, number];
export interface Cfg {
  width: number; height: number; pageDepth: number; boardThickness: number; grooveWidth: number; grooveOffset: number;
  spineBuckle: number; spineSquareness: number; spineHollow: number; grooveBlend: number; marginTop: number; marginBottom: number; marginFore: number;
  grooveDepth: number; cornerRadius: number; edgeRound: number;
}
export const spineExp = (c: Cfg) => 2 + clamp(c.spineSquareness) ** 2 * 12;
export function metrics(c: Cfg) {
  const W = c.width, H = c.height, T = c.pageDepth + c.boardThickness * 2;
  const hingeX = -W / 2 + c.grooveOffset, hingeW = c.grooveWidth / 2;
  const pageForeX = W / 2 - c.marginFore, spineInnerX = -W / 2 - c.spineBuckle + c.boardThickness * 1.15;
  return { W, H, T, hingeX, hingeW, spineInnerX, pageForeX, pageWidth: Math.max(0.3, pageForeX - spineInnerX),
    pageHeight: Math.max(0.3, H - c.marginTop - c.marginBottom), pageDepth: Math.max(0.06, c.pageDepth - 0.04), pageCY: (c.marginBottom - c.marginTop) / 2 };
}
export function joint(c: Cfg) {
  const m = metrics(c), half = m.hingeW * (1 + clamp(c.grooveBlend));
  return { half, jointX: m.hingeX - half };
}

/** Everything that depends only on the construction (rebuilt when the config changes). */
export function makeLayout(c: Cfg, crease = 0.1, N = LEAVES) {
  const m = metrics(c), J = joint(c), BOARD = c.boardThickness, T = m.T, b = T / 2, bIn = b - BOARD, zt = m.pageDepth / 2, gap = Math.max(0, bIn - zt);
  const mx = spineExp(c), crown = -c.width / 2 - c.spineBuckle, aIn = Math.max(1e-4, J.jointX - (crown + BOARD)), aOut = Math.max(1e-4, J.jointX - crown);
  const sx = (y: number, x0: number, a: number, bb: number) => x0 + a * (1 - Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(y) / bb), mx)), 1 / mx));
  const innerX = (y: number) => sx(y, crown + BOARD, aIn, bIn), outerX = (y: number) => sx(y, crown, aOut, b);
  const lx = new Float64Array(NA + 1), lz = new Float64Array(NA + 1), ls = new Float64Array(NA + 1);
  for (let i = 0; i <= NA; i++) {
    const y = -bIn + (2 * bIn * i) / NA; lx[i] = innerX(y); lz[i] = y;
    ls[i] = i ? (ls[i - 1] as number) + Math.hypot((lx[i] as number) - (lx[i - 1] as number), y - (lz[i - 1] as number)) : 0;
  }
  const FLAT = ls[NA] as number;
  const sOfY = (y: number) => { const f = clamp((y + bIn) / (2 * bIn)) * NA, i = Math.min(NA - 1, Math.floor(f)); return lerp(ls[i] as number, ls[i + 1] as number, f - i); };
  const S0 = sOfY(-zt), S1 = sOfY(zt);
  const ox: number[] = [], oz: number[] = [];
  for (let i = 0; i <= 64; i++) { const y = -b + (2 * b * i) / 64; ox.push(outerX(y)); oz.push(y); }
  const pb: V = [J.jointX, -(b - BOARD / 2)], pf: V = [J.jointX, b - BOARD / 2];
  const PW = Math.max(0.3, m.pageForeX - innerX(zt));   // equal-length leaves: the block's ends reach the fore-edge, the rounded middle falls short (concave fore-edge)
  return { N, crease, m, J, BOARD, T, b, bIn, zt, gap, PW, SEG: PW / SEGS, LEAF_T: m.pageDepth / N, hollow: clamp(c.spineHollow),
    innerX, outerX, lx, lz, ls, FLAT, S0, S1, ox, oz, pb, pf, Lb: m.W / 2 - J.jointX, chordP: pf[1] - pb[1] };
}
export type Layout = ReturnType<typeof makeLayout>;

export function liningAt(L: Layout, s: number): V {
  const ss = clamp(s, 0, L.FLAT); let lo = 0, hi = NA;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((L.ls[mid] as number) <= ss) lo = mid; else hi = mid; }
  const d = (L.ls[hi] as number) - (L.ls[lo] as number), f = d > 1e-12 ? (ss - (L.ls[lo] as number)) / d : 0;
  return [lerp(L.lx[lo] as number, L.lx[hi] as number, f), lerp(L.lz[lo] as number, L.lz[hi] as number, f)];
}

/* ---------- pose: ported from Shift Happens (cover table + whole-book rotation) ---------- */
export interface Pose { u: number; es: number; ef: number; theta: number; psiB: number; psiF: number; pfw: V; chi: number; aL: number; aR: number; betaB: number; betaF: number }
export const rot = (a: number, p: V, c: V): V => { const ca = Math.cos(a), sa = Math.sin(a), dx = p[0] - c[0], dz = p[1] - c[1]; return [c[0] + dx * ca - dz * sa, c[1] + dx * sa + dz * ca]; };
const easeOut = (x: number) => 1 - Math.pow(1 - x, 1.15);

/** Reading progress of spread k (k leaves turned): Shift Happens bookProgress = curPage/(pageCount-2), curPage = 2k. */
export const progressOf = (k: number, N = LEAVES) => clamp(k / (N - 1), 0, 1);
/**
 * Shift Happens' relative cover angles [left(front), right(back)] for book progress p (scripts.js onBeforeRender).
 * closed 0/0; opening left 0->-0.9, right 0->0.86; first spread -0.9/0.86; first->second spread left -> -2.46; reading
 * left -2.46->-0.86, right 0.86->2.46 (easeOut 1.15); last spread -0.86/0.9; closing back to 0.
 */
export function coverAngles(p: number, pageCount: number): [number, number] {
  const os = 2 / pageCount;
  if (p <= -os) return [0, 0];
  if (p < 0) { const pos = 1 - Math.abs(p) / os; return [lerp(0, -0.9, pos), lerp(0, 0.86, pos)]; }
  if (p === 0) return [-0.9, 0.86];
  if (p < os) { const pos = p / os; return [lerp(-0.9, -2.46, pos), 0.86]; }
  if (p > 1 - os && p < 1) { const pos = (p - (1 - os)) / os; return [-0.86, lerp(2.46, 0.9, pos)]; }
  if (p === 1) return [-0.86, 0.9];
  if (p >= 1 + os) return [0, 0];
  if (p > 1) { const pos = (p - 1) / os; return [lerp(-0.86, 0, pos), lerp(0.9, 0, pos)]; }
  const a = (p - os) / (1 - 2 * os);
  return [lerp(-2.46, -0.86, 1 - easeOut(1 - a)), lerp(0.86, 2.46, easeOut(a))];
}
/**
 * u: 0 closed .. 1 first spread (the cover opens and STANDS, the spine becomes a 45deg diagonal). p: reading progress 0..1.
 * Whole-book rotation chi = PI/4 - (PI/2)p (PI/2 closed). Absolute cover angle = relative + chi. The spine slab rides on the book:
 * theta = PI/2 - chi (+ the slab's own +-rock). In my frame the closed book is the identity pose (chi = PI/2).
 */
export function casePose(L: Layout, u: number, p: number, rock: number, after = 0): Pose {
  const es = sstep5(clamp(u)) * (1 - sstep5(clamp(after)));      // openness: 0 closed (front up) .. 1 open .. 0 closed again (flipped, back up)
  let chi: number, left: number, right: number, rk = 0;
  if (u < 0.999999) { chi = Math.PI / 2 - (Math.PI / 4) * u; left = -0.9 * u; right = 0.86 * u; }
  else if (after > 1e-9) {          // closing at the BACK (Shift Happens progress > 1): the back cover swings shut and the whole book ends up flipped over
    const a = clamp(after); chi = -Math.PI / 4 - (Math.PI / 4) * a; left = lerp(-0.86, 0, a); right = lerp(0.9, 0, a); rk = rock * (1 - a);
  } else { const pp = clamp(p, 0, 1); chi = Math.PI / 4 - (Math.PI / 2) * pp; [left, right] = coverAngles(pp, 2 * L.N); rk = rock * (2 * pp - 1); }
  const aL = left + chi, aR = right + chi, theta = Math.PI / 2 - chi - rk, pfw = rot(theta, L.pf, L.pb);
  const psiB = Math.PI / 2 - aR, psiF = Math.PI / 2 - aL;
  return { u, es, ef: es, theta, psiB, psiF, pfw, chi, aL, aR, betaB: Math.max(0, -psiB), betaF: Math.max(0, psiF - Math.PI) };
}
/** One timeline for the whole life of the book, like Gutenberg's turnAmount / Shift Happens' bookProgress.
 *  s = -1 closed (front up) .. 0 first spread (cover standing) .. 35 last spread (back cover standing) .. 36 closed at the back (flipped). */
export function timeline(s: number, N = LEAVES): { u: number; k: number; after: number } {
  if (s < 0) return { u: clamp(s + 1, 0, 1), k: 0, after: 0 };
  if (s <= N - 1) return { u: 1, k: s, after: 0 };
  return { u: 1, k: N - 1, after: clamp(s - (N - 1), 0, 1) };
}
export const spineW = (L: Layout, P: Pose, p: V): V => rot(P.theta, p, L.pb);
export const frontInv = (L: Layout, P: Pose, p: V): V => rot(-P.psiF, [p[0] - (P.pfw[0] - L.pf[0]), p[1] - (P.pfw[1] - L.pf[1])], L.pf);

/** Block spine edge: follows the lining (tight back) or bridges the arch on a chord (hollow back), always ABOVE the lining. */
export function rootAt(L: Layout, P: Pose, s: number): V {
  const a = liningAt(L, s), e0 = liningAt(L, L.S0), e1 = liningAt(L, L.S1), f = clamp((s - L.S0) / Math.max(1e-9, L.S1 - L.S0));
  const h = L.hollow * P.es, w = spineW(L, P, [lerp(a[0], lerp(e0[0], e1[0], f), h), lerp(a[1], lerp(e0[1], e1[1], f), h)]);
  // CREASE: in the references the two pages meet in ONE V line, not a channel. The reading surfaces meet near the stack tops, so the block's
  // spine edge is raised (hollow-back style) by how much the thinner side's stack exceeds the target crease depth. Zero at the ends of the
  // spine and when closed; peaks where both sides are equally thick (mid-book), exactly where the gutter used to be deepest.
  const hMin = L.LEAF_T * L.N * Math.min(f, 1 - f), lift = Math.max(0, hMin - L.crease) * P.es;
  return [w[0] + lift * Math.cos(P.theta), w[1] + lift * Math.sin(P.theta)];
}

/* ---------- cavity floors: the real inner faces of the boards (+ the clearance the block keeps) ---------- */
export interface Plane { A: V; es: V; en: V; base: number }
/** The inner face of a board (plus the clearance the block keeps), as a frame: A on the plane at the joint, es along the board, en toward the cavity. */
export function floorPlane(L: Layout, P: Pose, side: 1 | -1): Plane {
  const off = L.BOARD / 2 + L.gap;
  if (side > 0) { const en: V = [-Math.sin(P.psiB), Math.cos(P.psiB)]; return { A: [L.pb[0] + en[0] * off, L.pb[1] + en[1] * off], es: [Math.cos(P.psiB), Math.sin(P.psiB)], en, base: P.psiB }; }
  const en: V = [Math.sin(P.psiF), -Math.cos(P.psiF)];
  return { A: [P.pfw[0] + en[0] * off, P.pfw[1] + en[1] * off], es: [Math.cos(P.psiF), Math.sin(P.psiF)], en, base: P.psiF };
}
export interface Surface { x: Float64Array; z: Float64Array; head: Float64Array; ang: Float64Array; crest: number }
/**
 * A leaf surface rooted at lining position s, landing `hAbove` above the board plane of its side. Solved in the BOARD'S OWN FRAME
 * (so it also works while a cover stands upright): it leaves the spine along the rotated page direction, bends over, drapes onto
 * the board and lands flat and parallel to it. `head` = world heading of every segment.
 */
export function leafSurface(L: Layout, P: Pose, prof: Prof, side: 1 | -1, s: number, hAbove: number, C: number, fillet = prof.fillet, minC = 0): Surface {
  const root = rootAt(L, P, s), fp = floorPlane(L, P, side);
  { // a rounded crease floor only where the lining is horizontal; on a steep part of the lining the page hugs it
    const a1 = liningAt(L, s - 0.01), a2 = liningAt(L, s + 0.01), tang = Math.atan2(a2[1] - a1[1], a2[0] - a1[0]) + P.theta;
    fillet = Math.max(0.01, fillet * Math.cos(tang) ** 2);
  }
  const dx = root[0] - fp.A[0], dz = root[1] - fp.A[1], sR = dx * fp.es[0] + dz * fp.es[1], nR = dx * fp.en[0] + dz * fp.en[1];
  // Heading leaving the spine, measured from the board toward the cavity. Near the hinge (root under/next to the board's end) the leaf must
  // leave along the spine's real page direction and curl OVER the pin; clamping it there turns the leaf into the board's underside.
  // Far from the hinge (the crease) it is clamped to prof.steep, which gives the gentle V crease instead of a slot.
  const raw = side > 0 ? P.theta - fp.base : fp.base - P.theta, nearHinge = sstep5(clamp((sR + 0.3) / 0.25));
  const phi0 = clamp(lerp(clamp(raw, 0, prof.steep), clamp(raw, 0, 2.6), nearHinge), 0, 2.6);
  const rise = hAbove - nR, crest = Math.max(C * P.es, P.es > 0.05 ? 0.012 : 0, minC * P.es);
  const ang = profileAnglesTo(SEGS, L.PW, rise, crest, phi0, fillet, 0, prof.hold, prof.drape), ch = chain(sR, L.SEG, ang, 1);
  const x = new Float64Array(SEGS + 1), z = new Float64Array(SEGS + 1), head = new Float64Array(SEGS);
  for (let j = 0; j <= SEGS; j++) { const ss = ch.x[j] as number, nn = nR + (ch.z[j] as number); x[j] = fp.A[0] + ss * fp.es[0] + nn * fp.en[0]; z[j] = fp.A[1] + ss * fp.es[1] + nn * fp.en[1]; }
  for (let j = 0; j < SEGS; j++) head[j] = fp.base + side * (ang[j] as number);
  return { x, z, head, ang, crest };
}
export const crestOf = (prof: Prof, hR: number) => prof.crest0 + prof.crest1 * hR;
const sAt = (L: Layout, f: number) => L.S0 + (L.S1 - L.S0) * f;
/** Leaf-slot fractions along the spine: right stack = last cnt slots, left stack = first cnt slots (leaf 0 at the front, f=1). */
export const topFrac = (side: 1 | -1, cnt: number, N = LEAVES) => (side > 0 ? cnt / N : 1 - cnt / N);
export const botFrac = (side: 1 | -1) => (side > 0 ? 0 : 1);

/** Top + bottom leaf surfaces of a stack of `cnt` leaves. ONE helper for the stack and the flying leaf, so they can never disagree.
 *  - the bottom leaf is built first (it may have to rise to clear the board at the hinge); the top leaf must then stand above it;
 *  - each leaf's gutter roundness is capped by the real spacing to its outer neighbour (a horizontal run longer than that
 *    cuts through the leaf below it and crumples thin stacks). */
export function stackLeaves(L: Layout, P: Pose, prof: Prof, side: 1 | -1, cnt: number) {
  const hR = cnt * L.LEAF_T, fT = topFrac(side, cnt, L.N), fB = botFrac(side), rT = rootAt(L, P, sAt(L, fT)), rB = rootAt(L, P, sAt(L, fB));
  const spacing = Math.hypot(rT[0] - rB[0], rT[1] - rB[1]) / L.PW;
  const bot = leafSurface(L, P, prof, side, sAt(L, fB), 0, 0, 0.01);
  // Option A / Shift Happens: curvature follows how thick this side is. A side holding half the leaves (mid-book) is flat; the thick side shows the full crest.
  const f = clamp((cnt / L.N - 0.5) / 0.5), amp = 1 - prof.flat + prof.flat * f;
  const top = leafSurface(L, P, prof, side, sAt(L, fT), hR, crestOf(prof, hR) * amp, Math.min(prof.fillet, Math.max(0.01, spacing)), bot.crest - hR + 0.015);
  return { top, bot, rT, rB, fT, fB };
}
/** A page can never be under the board it lies on: keep a surface on the cavity side of the board plane once it is past the hinge (a vertex that tunnelled through is "outside", so containment alone never sees it). */
function abovePlane(s: Surface, fp: Plane): Surface {
  const n = s.x.length, x = new Float64Array(n), z = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const dx = (s.x[j] as number) - fp.A[0], dz = (s.z[j] as number) - fp.A[1], ss = dx * fp.es[0] + dz * fp.es[1]; let nn = dx * fp.en[0] + dz * fp.en[1];
    if (ss > 0 && nn < 0.002) nn = 0.002;
    x[j] = fp.A[0] + ss * fp.es[0] + nn * fp.en[0]; z[j] = fp.A[1] + ss * fp.es[1] + nn * fp.en[1];
  }
  return { x, z, head: s.head, ang: s.ang, crest: s.crest };
}
export interface StackGeo { poly: V[]; topX: Float64Array; topZ: Float64Array }
const NS = 24, NF = 6;
const segX = (a: V, b: V, c: V, d: V) => { const o = (p: V, q: V, r: V) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); return o(a, b, c) * o(a, b, d) < -1e-12 && o(c, d, a) * o(c, d, b) < -1e-12; };
/** True if the outline crosses itself (a crumpled block). */
export function selfIntersects(p: V[], root?: V, rad = 0.45): boolean {
  const q: V[] = []; for (const v of p) { const l = q[q.length - 1]; if (!l || Math.hypot(v[0] - l[0], v[1] - l[1]) > 5e-4) q.push(v); }
  // Crossings where BOTH edges lie within `rad` of the shared root are a hair-thin sliver in the hinge/hollow (several polylines converge there), not a crumple.
  const n = q.length, near = (i: number) => !!root && Math.hypot(((q[i] as V)[0] + (q[(i + 1) % n] as V)[0]) / 2 - root[0], ((q[i] as V)[1] + (q[(i + 1) % n] as V)[1]) / 2 - root[1]) < rad;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (segX(q[i] as V, q[(i + 1) % n] as V, q[j] as V, q[(j + 1) % n] as V) && !(near(i) && near(j))) return true; } return false;
}
/** Bottom boundary of a THIN stack: the top surface offset inward by the stack thickness (a band of paper hugging the hinge). Cannot cross the top by construction. */
function bandBottom(top: Surface, bot: Surface, hR: number, en: V): Surface {
  const n = top.x.length, x = new Float64Array(n), z = new Float64Array(n), t = Math.max(hR, 0.004);
  // ONE offset side for the whole curve: toward the board (-en) where the page lies flat on it. Deciding per vertex zigzags where the two original curves cross.
  const e = n - 1, a0 = Math.max(0, e - 2); let tx = (top.x[e] as number) - (top.x[a0] as number), tz = (top.z[e] as number) - (top.z[a0] as number); const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
  const sgn = (-tz) * -en[0] + tx * -en[1] > 0 ? 1 : -1;
  for (let j = 0; j < n; j++) {
    const a = Math.max(0, j - 1), b = Math.min(n - 1, j + 1); let nx = -((top.z[b] as number) - (top.z[a] as number)), nz = (top.x[b] as number) - (top.x[a] as number); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    x[j] = (top.x[j] as number) + sgn * nx * t; z[j] = (top.z[j] as number) + sgn * nz * t;
  }
  return { x, z, head: bot.head, ang: bot.ang, crest: bot.crest };
}
export function stackGeo(L: Layout, P: Pose, prof: Prof, side: 1 | -1, cnt: number, noFallback = false): StackGeo | null {
  if (cnt < 0.3) return null;
  const sl = stackLeaves(L, P, prof, side, cnt), { rT, rB, fT, fB } = sl, hR = cnt * L.LEAF_T, fpl = floorPlane(L, P, side), bot = abovePlane(sl.bot, fpl), top = sl.top;
  const build = (b: Surface, straight = false): V[] => {
    const poly: V[] = [];
    // densify the first segments (near the hinge) so every edge there is short enough for containment to catch it
    const dense = (xs: Float64Array, zs: Float64Array): V[] => { const o: V[] = []; for (let j = 0; j <= SEGS; j++) { o.push([xs[j] as number, zs[j] as number]); if (j < SEGS && j < 10) for (let q = 1; q < 4; q++) { const t = q / 4; o.push([lerp(xs[j] as number, xs[j + 1] as number, t), lerp(zs[j] as number, zs[j + 1] as number, t)]); } } return o; };
    poly.push(...dense(top.x, top.z));
    for (let i = 1; i <= NF; i++) {      // fan: lower leaves reach further out; closed, the equal-length leaves of a rounded back make the fore-edge concave
      const f = i / (NF + 1), r = rootAt(L, P, sAt(L, lerp(fT, fB, f))), w = 1 - P.es;
      poly.push([lerp(top.x[SEGS] as number, b.x[SEGS] as number, f) + w * (r[0] - lerp(rT[0], rB[0], f)), lerp(top.z[SEGS] as number, b.z[SEGS] as number, f) + w * (r[1] - lerp(rT[1], rB[1], f))]);
    }
    poly.push(...dense(b.x, b.z).reverse());
    // the block's spine edge (glued to the spine); in band mode it is a straight link from the band's own start to the top root
    for (let i = 1; i < NS; i++) poly.push(straight ? [lerp(b.x[0] as number, top.x[0] as number, i / NS), lerp(b.z[0] as number, top.z[0] as number, i / NS)] as V : rootAt(L, P, lerp(sAt(L, fB), sAt(L, fT), i / NS)));
    return poly;
  };
  let poly = build(bot);
  if (!noFallback && selfIntersects(poly, [top.x[0] as number, top.z[0] as number])) poly = build(bandBottom(top, bot, hR, floorPlane(L, P, side).en), true);     // crumple guard: thin stacks become a band of constant thickness
  return { poly, topX: top.x, topZ: top.z };
}

/** The turning leaf: rooted on the spine (the root slides along it), lagging tip. */
export function leafGeo(L: Layout, P: Pose, prof: Prof, kFrom: number, kTo: number, dir: 1 | -1, t: number, tau: number) {
  const kR = Math.min(kFrom, kTo), kL = Math.max(kFrom, kTo), cR = L.N - kR, cL = kL;
  const sR = sAt(L, topFrac(1, cR, L.N)), sL = sAt(L, topFrac(-1, cL, L.N));
  const R = stackLeaves(L, P, prof, 1, cR).top, Lf = stackLeaves(L, P, prof, -1, cL).top;
  return { cv: leafCurve((w) => rootAt(L, P, lerp(sR, sL, w)), L.SEG, R.head, Lf.head, t, tau, dir), R, Lf };
}

/* ---------- containment: nothing of the text block may ever be inside a board, the spine shell, or poke past them ---------- */
export function penetration(L: Layout, P: Pose, p: V): number {
  let d = 0;
  const qb = rot(-P.psiB, p, L.pb);                                    // back board slab, in its own frame
  if (qb[0] > L.J.jointX - 0.004 && qb[0] < L.m.W / 2 && qb[1] < -L.bIn && qb[1] > -L.b) d = Math.max(d, -L.bIn - qb[1]);
  const qf = frontInv(L, P, p);                                        // front board slab
  if (qf[0] > L.J.jointX - 0.004 && qf[0] < L.m.W / 2 && qf[1] > L.bIn && qf[1] < L.b) d = Math.max(d, qf[1] - L.bIn);
  const qs = rot(-P.theta, p, L.pb);                                   // spine shell
  if (Math.abs(qs[1]) <= L.bIn && qs[0] < L.innerX(qs[1]) && qs[0] > L.outerX(qs[1])) d = Math.max(d, L.innerX(qs[1]) - qs[0]);
  for (const c of [L.pb, P.pfw]) { const r = L.BOARD / 2, dd = Math.hypot(p[0] - c[0], p[1] - c[1]); if (dd < r) d = Math.max(d, r - dd); }   // the hinge pins
  return d;
}
/** Hard guarantee: push any point that ended up inside the case back out through the nearest inner face. */
function containOnce(L: Layout, P: Pose, p: V, eps: number): V {
  let q = p;
  const qb = rot(-P.psiB, q, L.pb);
  if (qb[0] > L.J.jointX - 0.004 && qb[0] < L.m.W / 2 && qb[1] < -L.bIn && qb[1] > -L.b) q = rot(P.psiB, [qb[0], -L.bIn + eps], L.pb);
  const qf = frontInv(L, P, q);
  if (qf[0] > L.J.jointX - 0.004 && qf[0] < L.m.W / 2 && qf[1] > L.bIn && qf[1] < L.b) { const w = rot(P.psiF, [qf[0], L.bIn - eps], L.pf); q = [w[0] + P.pfw[0] - L.pf[0], w[1] + P.pfw[1] - L.pf[1]]; }
  const qs = rot(-P.theta, q, L.pb);
  if (Math.abs(qs[1]) <= L.bIn && qs[0] < L.innerX(qs[1]) && qs[0] > L.outerX(qs[1])) q = rot(P.theta, [L.innerX(qs[1]) + eps, qs[1]], L.pb);
  for (const c of [L.pb, P.pfw]) { const r = L.BOARD / 2, dx = q[0] - c[0], dz = q[1] - c[1], dd = Math.hypot(dx, dz); if (dd < r) { const k = (r + eps) / Math.max(dd, 1e-9); q = dd < 1e-9 ? [c[0], c[1] + r + eps] : [c[0] + dx * k, c[1] + dz * k]; } }
  return q;
}
/** Push a point out of every solid. Iterates: leaving one solid (a board) can land inside the next (the hinge pin). */
export function contain(L: Layout, P: Pose, p: V, eps = 0.0004): V {
  let q = p;
  for (let i = 0; i < 5; i++) { q = containOnce(L, P, q, eps); if (penetration(L, P, q) <= 1e-6) break; }
  return q;
}

/** Contain a whole outline, not just its vertices: wherever an edge's midpoint is inside the case, insert the corrected point (repeat), so edges follow the surface instead of cutting across a corner. */
export function containPoly(L: Layout, P: Pose, poly: V[]): V[] {
  let q = poly.map((p) => contain(L, P, p));
  for (let pass = 0; pass < 5; pass++) {
    const out: V[] = []; let added = false;
    for (let i = 0; i < q.length; i++) {
      const a = q[i] as V, b = q[(i + 1) % q.length] as V; out.push(a);
      let worst = 1e-3, wm: V | null = null;                      // test quarter points too: a corner can hide between the midpoint and an end
      for (const t of [0.25, 0.5, 0.75]) { const m: V = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d = penetration(L, P, m); if (d > worst) { worst = d; wm = m; } }
      if (wm) { out.push(contain(L, P, wm)); added = true; }
    }
    q = out; if (!added) break;
  }
  return q;
}

/** Keep a flying leaf ABOVE the page surfaces it flies over (a sheet cannot pass through the pages): lift any point that dips below a surface polyline. */
export function liftAbove(pts: V[], surfaces: { x: ArrayLike<number>; z: ArrayLike<number> }[], margin = 0.004): V[] {
  return pts.map((p, j) => {
    if (j < 2) return p; let z = p[1];
    for (const s of surfaces) { const n = s.x.length; for (let i = 0; i < n - 1; i++) { const a = s.x[i] as number, b = s.x[i + 1] as number; if ((p[0] - a) * (p[0] - b) <= 0 && a !== b) { const zs = (s.z[i] as number) + ((p[0] - a) / (b - a)) * ((s.z[i + 1] as number) - (s.z[i] as number)); if (z < zs + margin && z > zs - 0.18) z = zs + margin; } } }
    return [p[0], z] as V;
  });
}
