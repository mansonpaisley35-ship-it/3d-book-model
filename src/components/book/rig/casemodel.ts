import { DEFAULT_PROF, lerp, clamp, type Prof } from "./math";
import { makeLayout, casePose, timeline, stackGeo, leafGeo, contain, containPoly, liftAbove, liningAt, rootAt, spineW, progressOf, LEAVES, type Cfg, type Layout, type Pose, type V } from "./kin";
import { extrude, leafRibbon, boardOutline, spineOutline, circle, rect, flipZ, type Mesh } from "./geom";

export const CLOTH = "#212e3e", PAPER = "#e9dfc6", PASTE = "#e6dcc6", ENDPAPER = "#17142c";   // endpaper: dark ink, as in Shift Happens
const colorFor = (tex: string) => (tex.startsWith("endpaper") ? ENDPAPER : "#ffffff");
export interface Part { name: string; color: string; mesh: Mesh; holder: "back" | "spine" | "front" | "static" | "world"; roughness?: number; tex?: string }
/** Cloth border left around the pastedown (the cover is larger than the endpaper: Shift Happens' cover vs endpaper sizing). */
export interface Insets { hinge: number; fore: number; headTail: number }
export const INSETS: Insets = { hinge: 0.05, fore: 0.045, headTail: 0.045 };   // Shift Happens: cover only ~2.4% larger than the endpaper => the endpaper covers the inside of the cover almost edge to edge

export function buildCase(c: Cfg, ins: Insets = INSETS): Part[] {
  const L = makeLayout(c), H = c.height, y0 = -H / 2, y1 = H / 2, bd = L.bIn, jx = L.J.jointX;
  const x0 = jx + ins.hinge, x1 = L.m.W / 2 - ins.fore, py = H / 2 - ins.headTail;
  const pdX = Float64Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4), pdZ = (z: number) => new Float64Array(5).fill(z);   // the endpaper: a cover-sized sheet laid on the inside of the cover
  return [
    { name: "frontBoard", color: CLOTH, mesh: extrude(boardOutline(c), y0, y1), holder: "front" },
    { name: "backBoard", color: CLOTH, mesh: extrude(flipZ(boardOutline(c)), y0, y1), holder: "back" },
    { name: "spineBridge", color: CLOTH, mesh: extrude(spineOutline(c), y0, y1), holder: "spine" },
    { name: "hingePinBack", color: CLOTH, mesh: extrude(circle(L.pb[0], L.pb[1], (L.BOARD / 2) * 0.995), y0, y1), holder: "static" },
    { name: "hingePinFront", color: CLOTH, mesh: extrude(circle(L.pf[0], L.pf[1], (L.BOARD / 2) * 0.995), y0, y1), holder: "spine" },
    { name: "pastedownFront", color: ENDPAPER, mesh: leafRibbon(pdX, pdZ(bd - 0.0006), -py, py, { back: true, lift: 0, cols: 2 }), holder: "front", roughness: 0.95, tex: "endpaper:fl" },
    { name: "pastedownBack", color: ENDPAPER, mesh: leafRibbon(pdX, pdZ(-bd + 0.0006), -py, py, { lift: 0, cols: 2 }), holder: "back", roughness: 0.95, tex: "endpaper:br" },
  ];
}

/** Row-major 4x4 of  world = W + R(psi)(v - C)  in the (x,z) plane, y untouched. */
export function planar(psi: number, C: V, W: V): number[] {
  const c = Math.cos(psi), s = Math.sin(psi);
  return [c, 0, -s, W[0] - c * C[0] + s * C[1], 0, 1, 0, 0, s, 0, c, W[1] - s * C[0] - c * C[1], 0, 0, 0, 1];
}
export function holderMatrix(L: Layout, P: Pose, h: Part["holder"]): number[] {
  switch (h) {
    case "back": return planar(P.psiB, L.pb, L.pb);
    case "spine": return planar(P.theta, L.pb, L.pb);
    case "front": return planar(P.psiF, L.pf, P.pfw);
    default: return planar(0, [0, 0], [0, 0]);
  }
}
export const mul = (a: number[], b: number[]): number[] => { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[i * 4 + j] += (a[i * 4 + k] as number) * (b[k * 4 + j] as number); return o; };
/** rig = T(pos) * Rx(rotX) * S(sc), as in the page. */
export function rigMatrix(sc: number, rotX: number, posX: number, posZ = 0): number[] {
  const c = Math.cos(rotX), s = Math.sin(rotX);
  return [sc, 0, 0, posX, 0, c * sc, -s * sc, 0, 0, s * sc, c * sc, posZ, 0, 0, 0, 1];
}
/** Frame the book wherever the pose puts it (closed, open, flipped closed at the back): centre on the extent of the boards, scale to fit. */
export function rigFor(L: Layout, P: Pose, _u: number, aspect: number, fovDeg: number, camDist: number, tiltScale = 1, rotXOverride?: number) {
  const fb: V = [L.pb[0] + Math.cos(P.psiB) * L.Lb, L.pb[1] + Math.sin(P.psiB) * L.Lb], ff: V = [P.pfw[0] + Math.cos(P.psiF) * L.Lb, P.pfw[1] + Math.sin(P.psiF) * L.Lb];
  const xs = [fb[0], ff[0], L.pb[0], P.pfw[0]], zs = [fb[1], ff[1], L.pb[1], P.pfw[1]];
  const xc = (Math.min(...xs) + Math.max(...xs)) / 2, zc = (Math.min(...zs) + Math.max(...zs)) / 2, width = Math.max(0.5, Math.max(...xs) - Math.min(...xs)), o = P.es;
  const visH = 2 * camDist * Math.tan((fovDeg * Math.PI) / 360), visW = visH * aspect;
  const sc = Math.min(lerp(1, 0.62, o), (lerp(0.8, 0.9, o) * visW) / width), rotX = rotXOverride ?? -0.42 * o * tiltScale;
  return { sc, rotX, matrix: rigMatrix(sc, rotX, -xc * sc, -zc * sc * (1 - o)) };
}

/** Placeholder text block (the verified stack generator + containment) so the case can be judged with something inside it. */
/** Which sheet is printed on page n (1-based): the first and last leaves are the Shift Happens endpapers (dark, with the emblem on the page you see first), the rest are text pages. */
export const texFor = (n: number, N = LEAVES) => (n === 1 ? "endpaper:fr" : n === 2 ? "endpaper:fv" : n === 2 * N - 1 ? "endpaper:bv" : n === 2 * N ? "endpaper:bl" : `page:${n}`);
export interface FlipView { dir: 1 | -1; speed: number }
/**
 * s = leaves turned, CONTINUOUS (Gutenberg's turnAmount). When s is between two leaves, leaf floor(s) is in the air: the stacks hold
 * floor(s) leaves on the left and N-floor(s)-1 on the right, and the leaf is a ribbon swept along its flight curve.
 */
export function stacksAsParts(c: Cfg, L: Layout, P: Pose, s: number, prof: Prof = DEFAULT_PROF, fv: FlipView = { dir: 1, speed: 0 }): Part[] {
  const out: Part[] = [], m = L.m, y0 = m.pageCY - m.pageHeight / 2, y1 = m.pageCY + m.pageHeight / 2;
  const f = Math.floor(s + 1e-6), frac = s - f, flying = frac > 1e-4 && frac < 1 - 1e-4 && f < L.N - 1;
  const leftN = flying ? f : Math.round(s), rightN = L.N - (flying ? f + 1 : Math.round(s)), topRight = L.N - rightN, topLeft = leftN - 1;
  const fix = (xs: Float64Array, zs: Float64Array) => { const x = new Float64Array(xs.length), z = new Float64Array(zs.length); for (let j = 0; j < xs.length; j++) { const q = contain(L, P, [xs[j] as number, zs[j] as number]); x[j] = q[0]; z[j] = q[1]; } return { x, z }; };
  const tops: { x: Float64Array; z: Float64Array }[] = [];
  for (const side of [1, -1] as const) {
    const cnt = side > 0 ? rightN : leftN, g = stackGeo(L, P, prof, side, cnt); if (!g) continue;
    out.push({ name: side > 0 ? "textBlock" : "textBlockLeft", color: PAPER, mesh: extrude(containPoly(L, P, g.poly), y0, y1, 0.3), holder: "world", roughness: 0.92 });
    const top = fix(g.topX, g.topZ); tops.push(top);       // the visible page on top of each stack (right: recto, left: verso)
    { const tx = texFor(side > 0 ? 2 * topRight + 1 : 2 * topLeft + 2, L.N); out.push({ name: side > 0 ? "rightPage" : "leftPage", color: colorFor(tx), mesh: leafRibbon(top.x, top.z, y0, y1, { back: side < 0, lift: 0.0015 }), holder: "world", roughness: 0.94, tex: tx }); }
  }
  if (flying) {
    const t = fv.dir > 0 ? frac : 1 - frac, kFrom = fv.dir > 0 ? f : f + 1, kTo = fv.dir > 0 ? f + 1 : f;
    const tau = 0.18 + 0.42 * clamp(fv.speed / 2.4), cv = leafGeo(L, P, prof, kFrom, kTo, fv.dir, t, tau).cv, q0 = fix(cv.x, cv.z), lifted = liftAbove(Array.from(q0.x, (xx, j) => [xx, q0.z[j] as number] as V), tops).map((p) => contain(L, P, p)), q = { x: Float64Array.from(lifted, (v) => v[0]), z: Float64Array.from(lifted, (v) => v[1]) };
    const tw = 0.16 * Math.sin(Math.PI * clamp(t)) * (0.4 + 0.6 * clamp(fv.speed / 2.4)) * fv.dir;
    out.push({ name: "leafFront", color: colorFor(texFor(2 * f + 1, L.N)), mesh: leafRibbon(q.x, q.z, y0, y1, { lift: 0.0006, twist: tw }), holder: "world", roughness: 0.94, tex: texFor(2 * f + 1, L.N) });
    out.push({ name: "leafBack", color: colorFor(texFor(2 * f + 2, L.N)), mesh: leafRibbon(q.x, q.z, y0, y1, { back: true, lift: 0.0006, twist: tw }), holder: "world", roughness: 0.94, tex: texFor(2 * f + 2, L.N) });
  }
  // End caps (NO coloured headband). The text block stops short of the head and tail of the case by the cover overhang, which leaves the hollow behind
  // its spine edge open to the outside there. The opening is filled with caps in the PAGE-EDGE colour, so the head and tail edge of the book runs unbroken
  // into the crease and the cover / spine cloth is never visible through the pages.
  if (L.hollow * P.es > 0.01) {
    const NB = 28, gap: V[] = [];
    for (let i = 0; i <= NB; i++) gap.push(spineW(L, P, liningAt(L, L.S0 + ((L.S1 - L.S0) * i) / NB)));
    for (let i = NB; i >= 0; i--) gap.push(rootAt(L, P, L.S0 + ((L.S1 - L.S0) * i) / NB));
    const capHead = Math.max(0.01, m.H / 2 - y1), capTail = Math.max(0.01, y0 + m.H / 2);       // all the way to the end of the case
    out.push({ name: "blockCapHead", color: PAPER, mesh: extrude(gap, y1, y1 + capHead, 0.3), holder: "world", roughness: 0.9 });
    out.push({ name: "blockCapTail", color: PAPER, mesh: extrude(gap, y0 - capTail, y0, 0.3), holder: "world", roughness: 0.9 });
  }
  return out;
}
/** Turned pages can only exist when the cover is fully open (a closed or half-open book has none). */
export const effectiveK = (u: number, k: number) => (u < 0.995 ? 0 : k);
export function stateFor(c: Cfg, u: number, kIn: number, showPages = true, rock = 0.05, aspect = 1.77, tiltScale = 1, _coverTilt = 0, prof: Prof = DEFAULT_PROF, fv: FlipView = { dir: 1, speed: 0 }, after = 0, N = LEAVES) {
  const k = effectiveK(u, kIn), L = makeLayout(c, 0.1, N), P = casePose(L, u, progressOf(k, N), rock, after), parts = buildCase(c);
  const rig = rigFor(L, P, u, aspect, 30, Math.hypot(4, 2, 10.5), tiltScale);
  const list = parts.map((p) => ({ ...p, matrix: mul(rig.matrix, holderMatrix(L, P, p.holder)) }));
  if (showPages) for (const p of stacksAsParts(c, L, P, k, prof, fv)) list.push({ ...p, matrix: rig.matrix });
  return { L, P, list, rig };
}
export { clamp };

/** The whole book at timeline position s in [-1, 36] (see kin.timeline). */
export function stateForS(c: Cfg, s: number, showPages = true, rock = 0.05, aspect = 1.77, tiltScale = 1, prof: Prof = DEFAULT_PROF, fv: FlipView = { dir: 1, speed: 0 }, N = LEAVES) {
  const t = timeline(s, N); return stateFor(c, t.u, t.k, showPages, rock, aspect, tiltScale, 0, prof, fv, t.after, N);
}
