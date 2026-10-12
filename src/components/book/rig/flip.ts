import { clamp, spring } from "./math";

/**
 * Page-turn input model, ported from Gutenberg Press (refs/gutenberg__source_from_pdf.txt):
 *   turnSpeed = pageTurnImpulse;  pageTurnImpulse *= 0.95 every frame;  turnAmount += turnSpeed/6 (pages);  click: impulse += 0.5
 * One scalar `s` = leaves turned (a leaf = 2 pages), exactly like their continuous turnAmount, so the flying leaf is leaf floor(s)
 * at progress frac(s). Gutenberg never settles (a page can hover half-turned); here the page settles onto the next integer.
 */
export interface Flip { s: number; v: number; target: number | null; dirHint: 1 | -1; max: number; min: number; hold: boolean; drag: { sDown: number; side: 1 | -1; lastS: number; lastT: number } | null }
export const IMPULSE = 0.5, PER_FRAME = 0.95;
export const CLICK_V = (IMPULSE / 6 / 2) * 60;           // leaves per second right after a click (0.5 / 6 pages per frame, 2 pages per leaf, 60 fps)
export const makeFlip = (max: number, min = 0): Flip => ({ s: Math.max(0, min), v: 0, target: null, dirHint: 1, max, min, hold: false, drag: null });

export function click(f: Flip, side: 1 | -1): void { f.hold = false; f.v += side * CLICK_V; f.target = null; f.dirHint = side; }
export function step(f: Flip, dt: number): void {
  if (f.drag || f.hold) return;                       // hold: the scrub slider parks a leaf mid-air until the next click / drag / key
  if (f.target === null) {
    f.s += f.v * dt; f.v *= Math.pow(PER_FRAME, dt * 60);
    if (Math.abs(f.v) < 0.12) {                          // momentum spent: finish the turn instead of hovering
      const dir = f.v !== 0 ? Math.sign(f.v) : f.dirHint;
      const t = clamp(dir > 0 ? Math.ceil(f.s - 1e-6) : Math.floor(f.s + 1e-6), f.min, f.max);
      if (Math.abs(t - f.s) < 1e-3) { f.s = t; f.v = 0; } else f.target = t;       // already on a leaf: rest, don't re-arm
    }
  } else {
    const [s, v] = spring(f.s, f.v, f.target, 9, dt); f.s = s; f.v = v;
    if (Math.abs(f.s - f.target) < 0.002 && Math.abs(f.v) < 0.03) { f.s = f.target; f.v = 0; f.target = null; }
  }
  if (f.s <= f.min) { f.s = f.min; if (f.v < 0) f.v = 0; } else if (f.s >= f.max) { f.s = f.max; if (f.v > 0) f.v = 0; }
  if (Math.abs(f.v) > 1e-3) f.dirHint = f.v > 0 ? 1 : -1;
}
/** Travel to timeline position `target` (a critically damped spring through every leaf on the way): used to close the book from anywhere, or to jump to a page. */
export function goTo(f: Flip, target: number): void { f.hold = false; f.drag = null; f.target = clamp(Math.round(target), f.min, f.max); f.dirHint = f.target >= f.s ? 1 : -1; }
/** Grab a page: side +1 = right page (turning forward), -1 = left page (turning back). */
export function dragStart(f: Flip, side: 1 | -1, now: number): void {
  const sDown = side > 0 ? Math.floor(f.s + 1e-6) : Math.ceil(f.s - 1e-6);
  f.hold = false; f.drag = { sDown, side, lastS: f.s, lastT: now }; f.v = 0; f.target = null; f.dirHint = side;
}
/** dxNorm: pointer travel against the page's direction, as a fraction of the drag span (0..1). */
export function dragMove(f: Flip, dxNorm: number, now: number): void {
  const d = f.drag; if (!d) return;
  const pr = clamp(dxNorm, 0, 1), s = clamp(d.side > 0 ? d.sDown + pr : d.sDown - pr, f.min, f.max), dt = now - d.lastT;
  // velocity only from samples at least 4 ms apart: the first move arrives with the same timestamp as the grab, and dividing by ~0 reads a slow drag as a flick
  if (dt > 0.004) { f.v = f.v * 0.65 + 0.35 * ((s - d.lastS) / dt); d.lastS = s; d.lastT = now; }
  f.s = s;
}
export function dragEnd(f: Flip): void {
  const d = f.drag; if (!d) return; f.drag = null;
  const frac = Math.abs(f.s - d.sDown), forward = d.side > 0 ? f.v > 1.1 : f.v < -1.1, back = d.side > 0 ? f.v < -1.1 : f.v > 1.1;
  const complete = !back && (forward || frac > 0.38), dest = d.side > 0 ? d.sDown + 1 : d.sDown - 1;
  f.target = clamp(complete ? dest : d.sDown, f.min, f.max);
}
/** The flying leaf for a position s: [kFrom, kTo, dir, t] in the convention of kin.leafGeo, or null when every leaf is at rest. Only s in [0, lastSpread] has a leaf in the air (below 0 the cover opens, above it the back cover closes). */
export function flightOf(s: number, dirHint: 1 | -1, lastSpread = 35): { kFrom: number; kTo: number; dir: 1 | -1; t: number } | null {
  if (s < 0 || s >= lastSpread) return null;
  const f = Math.floor(s + 1e-6), frac = s - f;
  if (frac < 1e-4 || frac > 1 - 1e-4) return null;
  return dirHint > 0 ? { kFrom: f, kTo: f + 1, dir: 1, t: frac } : { kFrom: f + 1, kTo: f, dir: -1, t: 1 - frac };
}
