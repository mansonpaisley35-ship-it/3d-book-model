import { makeLayout, casePose, timeline, progressOf, type Cfg, type Layout, type Pose } from "./kin";
import { buildCase, stacksAsParts, holderMatrix, rigFor, mul, type Part } from "./casemodel";
import { DEFAULT_PROF, type Prof } from "./math";
import type { Mesh } from "./geom";

/**
 * THE entry point. One call = the whole book at timeline position `s`:
 *   s = -1 closed (front up) | 0 first spread (front cover standing) | 1 .. N-2 reading | N-1 last spread (back cover standing) | N closed at the back (flipped)
 * and s is CONTINUOUS: 12.4 means leaf 12 is 40% of the way through the air. Positions are in book units, in the CLOSED book's coordinates:
 * x spine -> fore-edge, y head -> tail, z thickness (front cover at +z), centre of the case at the origin.
 */
export type RigPart = {
  name: string;               // frontBoard | backBoard | spineBridge | hingePinBack | hingePinFront | pastedownFront | pastedownBack | textBlock | textBlockLeft | rightPage | leftPage | leafFront | leafBack | blockCapHead | blockCapTail
  mesh: Mesh;                 // positions / normals / indices (+ uv on the page and endpaper sheets). For frontBoard, backBoard and spineBridge IGNORE the mesh: use the app's own meshes.
  local: number[];            // row-major 4x4 for THREE.Matrix4.set(...): put it on the mesh (matrixAutoUpdate = false)
  color: string;
  roughness?: number;
  tex?: string;               // "page:n" | "endpaper:fl" | "endpaper:fr" | "endpaper:fv" | "endpaper:bv" | "endpaper:bl" | "endpaper:br"
};
export type RigOptions = {
  leaves: number;             // leavesFor(pageCount)
  flipDir?: 1 | -1;           // direction the flying leaf is going (sign of the velocity)
  flipSpeed?: number;         // |velocity| in leaves/second: makes the tip trail and the sheet twist more
  profile?: Partial<Prof>;    // crease profile; defaults are the approved ones
  rock?: number;              // spine rock, 0.05
  pages?: boolean;            // false = case only
};
export type RigState = { layout: Layout; pose: Pose; parts: RigPart[]; time: { u: number; k: number; after: number }; frame: (aspect: number, fovDeg: number, camDist: number, tilt?: number) => { sc: number; rotX: number; matrix: number[] } };

export function rigAt(cfg: Cfg, s: number, o: RigOptions): RigState {
  const N = o.leaves, L = makeLayout(cfg, 0.1, N), t = timeline(s, N), P = casePose(L, t.u, progressOf(t.k, N), o.rock ?? 0.05, t.after);
  const prof: Prof = { ...DEFAULT_PROF, ...(o.profile ?? {}) }, parts: RigPart[] = [];
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const p of buildCase(cfg)) parts.push({ name: p.name, mesh: p.mesh, local: holderMatrix(L, P, p.holder), color: p.color, ...(p.roughness !== undefined ? { roughness: p.roughness } : {}), ...(p.tex !== undefined ? { tex: p.tex } : {}) });
  if (o.pages !== false) for (const p of stacksAsParts(cfg, L, P, t.k, prof, { dir: o.flipDir ?? 1, speed: o.flipSpeed ?? 0 })) parts.push({ name: p.name, mesh: p.mesh, local: I, color: p.color, ...(p.roughness !== undefined ? { roughness: p.roughness } : {}), ...(p.tex !== undefined ? { tex: p.tex } : {}) });
  return { layout: L, pose: P, parts, time: t, frame: (aspect, fovDeg, camDist, tilt = 0) => rigFor(L, P, t.u, aspect, fovDeg, camDist, tilt) };
}
export { mul };
