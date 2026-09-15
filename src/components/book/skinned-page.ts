/*
 * Bone-driven bendable page, adapted from the Gutenberg Press technique.
 *
 * A leaf is a subdivided box bound to a chain of bones that runs from the
 * binding to the fore-edge. Every frame each bone receives its own small
 * rotation, and those rotations accumulate along the chain, so the leaf sweeps
 * across the book purely by bending: the ROOT BONE NEVER MOVES, which is what
 * keeps the page permanently attached to the spine.
 *
 * Local axes (matching OpenBook's frame):
 *   +X = spine -> fore-edge   (the bone chain runs along this axis)
 *   +Y = tail  -> head
 *   +Z = page thickness
 * Bones therefore bend about Y, sweeping the leaf through the XZ plane.
 */
import * as THREE from "three";

/** Classic Hermite ramp; `low`>`high` gives a falling ramp, as in the reference. */
export function smoothstep(low: number, high: number, value: number) {
  let f = (value - low) / (high - low);
  f = Math.min(1, Math.max(0, f));
  return f * f * (3 - 2 * f);
}

/**
 * Deformation tuning. Every position/threshold is NORMALISED along the page
 * (0 = spine, 1 = fore-edge) so the same numbers work at any trim size.
 */
export const PAGE_TURN_CONFIG = {
  /** bones in the chain: more = smoother curl, 20-32 is the useful range */
  boneCount: 26,
  /** geometry subdivisions per bone along the spine -> fore-edge axis */
  segmentsPerBone: 2,
  /** subdivisions across the head -> tail axis (kept low: the page only bends one way) */
  heightSegments: 2,

  /** the binding zone, where the sheet curves around the spine */
  spineZone: 0.18,
  spineCurveIntensity: 0.5,

  /** bend region just off the binding */
  earlyPivot: 0.26,
  earlyThreshold: 0.24,
  earlyIntensity: 1,

  /** the main body of the turn */
  curlPivot: 0.55,
  curlThreshold: 0.4,
  curlIntensity: 1.35,

  /** fore-edge, where the leaf settles flat onto the opposite stack */
  latePivot: 0.85,
  lateThreshold: 0.3,
  lateIntensity: 0.55,

  /** extra mid-turn curl amplitude (faded out at both ends of the turn) */
  bulge: 0.55,
  /** slight out-of-plane twist so the fore-edge corner lifts */
  lift: 0.1,
};

export type SkinnedPage = {
  mesh: THREE.SkinnedMesh;
  /** drive the deformation; `progress` 0..1, `dir` +1 forward / -1 backward */
  update: (progress: number, dir: 1 | -1) => void;
  dispose: () => void;
};

/**
 * Build a leaf of the given size whose root bone sits at local x = 0, i.e. on
 * the binding. The caller positions/orients that origin at the real spine.
 */
export function createSkinnedPage(
  width: number,
  height: number,
  thickness: number,
  materials: THREE.Material[],
  cfg = PAGE_TURN_CONFIG,
): SkinnedPage {
  const N = Math.max(4, cfg.boneCount);
  const seg = width / (N - 1);

  // --- geometry: a box subdivided along the bone axis, shifted so x = 0..width
  const geometry = new THREE.BoxGeometry(
    width,
    height,
    thickness,
    (N - 1) * cfg.segmentsPerBone,
    cfg.heightSegments,
    1,
  );
  geometry.translate(width / 2, 0, 0);

  // --- skin weights: every vertex is shared between the two bones it lies
  // between, so the deformation is continuous along the sheet.
  const position = geometry.getAttribute("position");
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  for (let i = 0; i < position.count; i += 1) {
    const x = Math.min(width, Math.max(0, position.getX(i)));
    const raw = x / seg;
    const index = Math.min(N - 2, Math.floor(raw));
    const w = raw - index;
    skinIndices.push(index, index + 1, 0, 0);
    skinWeights.push(1 - w, w, 0, 0);
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));

  // --- bone chain: root on the binding, each child one segment further out
  const bones: THREE.Bone[] = [];
  let prev = new THREE.Bone();
  bones.push(prev);
  for (let i = 1; i < N; i += 1) {
    const bone = new THREE.Bone();
    bone.position.x = seg;
    prev.add(bone);
    bones.push(bone);
    prev = bone;
  }

  const mesh = new THREE.SkinnedMesh(geometry, materials);
  mesh.add(bones[0]!);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // a skinned bounding box is computed in bind pose, so culling would pop the
  // leaf out of view halfway through a turn
  mesh.frustumCulled = false;

  // Per-bone shape weights are static: only their scale changes each frame.
  const shape = new Float32Array(N);
  const curl = new Float32Array(N);
  const spine = new Float32Array(N);
  let shapeSum = 0;
  for (let i = 0; i < N; i += 1) {
    const u = i / (N - 1);
    const early = smoothstep(cfg.earlyThreshold, 0, Math.abs(u - cfg.earlyPivot)) * cfg.earlyIntensity;
    const main = smoothstep(cfg.curlThreshold, 0, Math.abs(u - cfg.curlPivot)) * cfg.curlIntensity;
    const late = smoothstep(cfg.lateThreshold, 0, Math.abs(u - cfg.latePivot)) * cfg.lateIntensity;
    spine[i] = smoothstep(cfg.spineZone, 0, u);
    shape[i] = early + main + late + spine[i]! * 0.35;
    curl[i] = main;
    shapeSum += shape[i]!;
  }
  // normalise, so the accumulated rotation is exactly the requested turn angle
  // and the leaf always settles perfectly flat on the far stack
  for (let i = 0; i < N; i += 1) shape[i] = shape[i]! / (shapeSum || 1);

  const update = (progress: number, dir: 1 | -1) => {
    const p = Math.min(1, Math.max(0, progress));
    // total sweep: 0 -> pi across the spine. Forward turns bend negative about
    // Y (so the leaf rises through +Z), backward turns mirror the sign.
    const total = -dir * Math.PI * p;
    // both extra shapes fade to zero at rest, so a settled leaf is flat
    const env = Math.sin(Math.PI * p);
    for (let i = 0; i < N; i += 1) {
      const bone = bones[i]!;
      const angle =
        shape[i]! * total +
        -dir * cfg.bulge * env * curl[i]! * 0.12 +
        -dir * cfg.spineCurveIntensity * env * spine[i]! * 0.06;
      bone.rotation.y = angle;
      bone.rotation.z = dir * cfg.lift * env * curl[i]! * 0.05;
    }
  };

  update(0, 1);

  return {
    mesh,
    update,
    dispose: () => {
      geometry.dispose();
      mesh.skeleton.dispose();
    },
  };
}
