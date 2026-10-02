/*
 * Spine-rooted, travelling-crease page deformation. The leaf is a subdivided
 * box bound to a bone chain running from the binding to the fore-edge. Rather
 * than scaling one fixed bend profile, the fold itself travels across the
 * sheet, leaving flat paper on both sides of the moving curl.
 */
import * as THREE from "three";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function smootherstep(edge0: number, edge1: number, value: number) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Deformation tuning. Every position/threshold is NORMALISED along the page
 * (0 = spine, 1 = fore-edge) so the same numbers work at any trim size.
 */
export const PAGE_TURN_CONFIG = {
  boneCount: 28,
  segmentsPerBone: 2,
  heightSegments: 2,
  curlWidth: 0.16,
  curlWidthMin: 0.075,
  curlDepth: 0.11,
  foreEdgeLift: 0.075,
  spineStiffness: 0.9,
  twist: 0.035,
  settleStart: 0.78,
  settleWidth: 0.22,
  asymmetry: 0.035,
};

export type SkinnedPage = {
  mesh: THREE.SkinnedMesh;
  /** drive the deformation; `progress` 0..1, `dir` +1 forward / -1 backward */
  update: (progress: number, dir: 1 | -1) => void;
  dispose: () => void;
};

/** Desired paper tangent at one normalized point along the sheet. */
function pageTangent(
  u: number,
  progress: number,
  dir: 1 | -1,
  cfg: typeof PAGE_TURN_CONFIG,
) {
  const p = clamp01(progress);
  const airborne = Math.sin(Math.PI * p);
  const width = cfg.curlWidthMin + (cfg.curlWidth - cfg.curlWidthMin) * airborne;

  /* Start with the fold just before the binding and finish just beyond the
   * fore-edge. This makes both endpoint poses exactly flat. Paper behind the
   * fold has reached the destination; paper ahead of it remains on its source. */
  const centre = -width * 0.5 + (1 + width) * p + 0.045 * airborne;
  const left = centre - width * 0.5;
  const right = centre + width * 0.5;
  let folded = 1 - smootherstep(left, right, u);

  const spineZone = Math.max(0.001, cfg.spineStiffness * 0.22);
  const spineWeight = 1 - smootherstep(0, spineZone, u);
  folded *= 1 - spineWeight * 0.22 * airborne;

  const lead = airborne * smootherstep(0.15, 0.85, u) * 0.045;
  const asymmetry = cfg.asymmetry * airborne * Math.sin(u * Math.PI);
  return -dir * Math.PI * clamp01(folded + lead + asymmetry);
}

/** Write local bone rotations as differences between neighbouring tangents. */
function writeBoneAngles(
  out: Float32Array,
  progress: number,
  dir: 1 | -1,
  cfg: typeof PAGE_TURN_CONFIG,
) {
  let previous = pageTangent(0, progress, dir, cfg);
  out[0] = -dir * 0.018 * Math.sin(Math.PI * progress);
  for (let i = 1; i < out.length; i += 1) {
    const current = pageTangent(i / (out.length - 1), progress, dir, cfg);
    out[i] = current - previous;
    previous = current;
  }
}

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
  const root = bones[0];
  if (!root) throw new Error("The page needs a binding bone");
  mesh.add(root);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // a skinned bounding box is computed in bind pose, so culling would pop the
  // leaf out of view halfway through a turn
  mesh.frustumCulled = false;

  const boneAngles = new Float32Array(N);

  const update = (progress: number, dir: 1 | -1) => {
    const p = clamp01(progress);
    const airborne = Math.sin(Math.PI * p);
    writeBoneAngles(boneAngles, p, dir, cfg);

    for (let i = 0; i < N; i += 1) {
      const bone = bones[i];
      if (!bone) continue;
      const u = i / (N - 1);
      const centreBow = Math.sin(u * Math.PI) * cfg.curlDepth * airborne * airborne * 0.055;
      const settling =
        smootherstep(0.18, 1, p) *
        (1 - smootherstep(cfg.settleStart, cfg.settleStart + cfg.settleWidth, p));
      const foreEdgeCurl =
        cfg.foreEdgeLift * settling * smootherstep(0.45, 1, u) * 0.08;

      bone.rotation.y = (boneAngles[i] ?? 0) - dir * (centreBow + foreEdgeCurl);
      bone.rotation.z = dir * cfg.twist * airborne * Math.sin(u * Math.PI) * 0.06;
      // Child-bone translation accumulates through the hierarchy and makes the
      // leaf drift away from its binding. Keep the chain purely on local X.
      bone.position.z = 0;
    }

    root.position.x = 0;
    root.position.z = 0;
    root.rotation.z = 0;
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
