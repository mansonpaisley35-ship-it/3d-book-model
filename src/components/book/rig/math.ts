/** Pure kinematics for the open book. No three.js here, so it is unit-testable in Node. */
export const clamp = (v: number, a = 0, b = 1): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sstep = (x: number): number => { const t = clamp(x); return t * t * (3 - 2 * t); };
export const sstep5 = (x: number): number => { const t = clamp(x); return t * t * t * (t * (t * 6 - 15) + 10); };

export interface Curve { x: Float64Array; z: Float64Array } // n+1 points, z relative to the stack base

export interface Prof { steep: number; crest0: number; crest1: number; fillet: number; hold: number; flat: number; drape: number }
/** hold: how long the wall stays vertical before bending (tight shoulders = small gutter). flat: 0..1, how much the crest flattens toward mid-book (Shift Happens spine-curve idea). */
export const DEFAULT_PROF: Prof = { steep: 1.57, crest0: 0.02, crest1: 0.04, fillet: 0.01, hold: 0.0, flat: 1, drape: 0.6 };

/**
 * Tangent angle (radians from +x towards +z) of each of n equal segments of a leaf surface, measured from its root.
 * The page leaves the binding steeply (steep0), bends over a rounded gutter (fillet), crests `C` above where it
 * finally lands, then falls long and smooth, landing FLAT on the plane at relative height `rise` and parallel to it (`tilt`).
 *   - bend length ub is solved so the crest stands C above the landing height
 *   - droop Ad is solved so the free end lands at exactly `rise`
 */
export function profileAnglesTo(n: number, PW: number, rise: number, C: number, steep0: number, fillet: number, tilt: number, hold = 0, drape = 1): Float64Array {
  const seg = PW / n, uf = Math.max(0.01, fillet);
  const SUB = 4;   // average each segment over sub-samples so bends shorter than one segment stay continuous (no aliasing)
  const build = (steep: number, ub: number, Ad: number): Float64Array => {
    const a = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      let acc = 0;
      for (let q = 0; q < SUB; q++) {
        const u = (j + (q + 0.5) / SUB) / n;
        const uh = uf + hold * (ub - uf), ramp = sstep(u / uf), bend = u < uh ? 1 : u < ub ? 1 - sstep((u - uh) / (ub - uh)) : 0;
        // the page DRAPES onto the cover within a short window after the shoulder, then follows the cover's slope (no hovering arch over a sloping board)
        const wd = Math.max(1e-3, Math.min(1 - ub, drape)), v = u > ub ? Math.min(1, (u - ub) / wd) : 0, droop = Ad * Math.sin(Math.PI * v) ** 2, late = u > ub ? sstep(v) : 0;
        acc += steep * ramp * bend - droop + tilt * late;    // droop has zero slope at both ends: lands flat
      }
      a[j] = acc / SUB;
    }
    return a;
  };
  const zEnd = (a: Float64Array): number => { let z = 0; for (let j = 0; j < n; j++) z += seg * Math.sin(a[j] as number); return z; };
  let steep = steep0;
  if (steep < 1e-4) { if (Math.abs(rise) < 1e-3) return build(0, 0.5, 0); steep = 0.05; }
  const target = rise + C;
  let lo = uf + 0.004, hi = 0.95, ub = hi;
  const z0 = (st: number, u: number) => zEnd(build(st, u, 0));
  if (target <= z0(steep, lo)) steep = target <= 0 ? 0 : steep * (target / z0(steep, lo));
  else {
    for (let i = 0; i < 10 && z0(steep, hi) < target && steep < 1.6; i++) steep *= 1.08;
    if (z0(steep, hi) >= target) { for (let i = 0; i < 26; i++) { const mid = (lo + hi) / 2; if (z0(steep, mid) < target) lo = mid; else hi = mid; } ub = (lo + hi) / 2; }
  }
  if (steep < 1e-4) { steep = 0; ub = 0.5; }
  let Ad = 0;
  if (zEnd(build(steep, ub, 0)) > rise + 1e-6) {
    let a0 = 0, a1 = 3.2;
    for (let i = 0; i < 26; i++) { const mid = (a0 + a1) / 2; if (zEnd(build(steep, ub, mid)) > rise) a0 = mid; else a1 = mid; }
    Ad = (a0 + a1) / 2;
  }
  return build(steep, ub, Ad);
}

/** Integrate a chain of equal segments from (x0,0). dir = +1 right of the root, -1 mirrored to the left. */
export function chain(x0: number, seg: number, ang: ArrayLike<number>, dir: 1 | -1): Curve {
  const n = ang.length;
  const x = new Float64Array(n + 1), z = new Float64Array(n + 1);
  x[0] = x0;
  for (let j = 0; j < n; j++) {
    const a = ang[j] as number;
    x[j + 1] = (x[j] as number) + dir * seg * Math.cos(a);
    z[j + 1] = (z[j] as number) + seg * Math.sin(a);
  }
  return { x, z };
}

/** Distance along the spine (from the back joint) at which leaf-slot boundary k sits: roots of leaves < k are left of it. */
export const rootX = (base: number, flat: number, leaves: number, k: number): number => base + (flat * k) / leaves;

/**
 * Geometric progress w (0 = leaf lies on the right stack, 1 = on the left) of the point at
 * fraction u along the leaf, given motion progress t (0..1) and a lag tau. The tip starts and
 * finishes later than the root, so the leaf trails through the air and settles last.
 */
export function wAt(u: number, t: number, tau: number, dir: 1 | -1): number {
  const a = sstep5(t * (1 + tau) - tau * u);
  return dir > 0 ? a : 1 - a;
}

/** Leaf centreline: blends the right-stack top leaf into the mirrored left-stack top leaf; root slides along the spine. */
export function leafCurve(
  root: (w: number) => [number, number], seg: number, angR: ArrayLike<number>, angL: ArrayLike<number>,
  t: number, tau: number, dir: 1 | -1,
): Curve {
  const n = angR.length;
  const x = new Float64Array(n + 1), z = new Float64Array(n + 1);
  const r0 = root(wAt(0, t, tau, dir)); x[0] = r0[0]; z[0] = r0[1];
  for (let j = 0; j < n; j++) {
    const w = wAt((j + 0.5) / n, t, tau, dir);
    const a = lerp(angR[j] as number, angL[j] as number, w);   // both are WORLD headings: root heading is shared, tip heading swings from one board to the other
    x[j + 1] = (x[j] as number) + seg * Math.cos(a);
    z[j + 1] = (z[j] as number) + seg * Math.sin(a);
  }
  return { x, z };
}

/** Height of a polyline top surface at x (x may be ascending or descending). */
export function heightAt(cv: Curve, x: number): number {
  const n = cv.x.length - 1;
  for (let j = 0; j < n; j++) {
    const a = cv.x[j] as number, b = cv.x[j + 1] as number;
    if ((x >= Math.min(a, b) - 1e-12) && (x <= Math.max(a, b) + 1e-12)) {
      const f = b === a ? 0 : (x - a) / (b - a);
      return lerp(cv.z[j] as number, cv.z[j + 1] as number, f);
    }
  }
  return -Infinity;
}

/** Critically damped spring step: no overshoot, natural settle. Returns [value, velocity]. */
export function spring(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const h = Math.min(dt, 1 / 30);
  const acc = omega * omega * (target - x) - 2 * omega * v;
  const nv = v + acc * h;
  return [x + nv * h, nv];
}
