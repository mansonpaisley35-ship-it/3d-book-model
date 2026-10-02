import * as THREE from "three";

/**
 * Spine-rooted paper deformation. The host in OpenBook performs the rigid
 * 180-degree sweep; this rig only adds a temporary travelling crease and curl.
 * Local +X runs from the binding to the fore-edge.
 */
export const PAGE_TURN_CONFIG = {
  boneCount: 32,
  segmentsPerBone: 2,
  heightSegments: 4,
  creaseWidth: 0.075,
  creaseCurl: 0.62,
  spineCurl: 0.16,
  spineWidth: 0.12,
  cornerTwist: 0.035,
  creaseStart: 0.06,
  creaseEnd: 0.92,
};

export type SkinnedPage = {
  mesh: THREE.SkinnedMesh;
  update: (progress: number, dir: 1 | -1) => void;
  dispose: () => void;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function smooth01(value: number) {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
}

/** A smooth tangent reversal centred on the moving crease. */
function creaseStep(u: number, centre: number, width: number) {
  const t = clamp01((u - (centre - width)) / (2 * width));
  return 1 - 2 * smooth01(t);
}

export function createSkinnedPage(
  width: number,
  height: number,
  thickness: number,
  materials: THREE.Material[],
  cfg = PAGE_TURN_CONFIG,
): SkinnedPage {
  const boneCount = Math.max(8, cfg.boneCount);
  const segmentLength = width / (boneCount - 1);
  const geometry = new THREE.BoxGeometry(
    width,
    height,
    thickness,
    (boneCount - 1) * cfg.segmentsPerBone,
    cfg.heightSegments,
    1,
  );
  geometry.translate(width / 2, 0, 0);

  const position = geometry.getAttribute("position");
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  for (let i = 0; i < position.count; i += 1) {
    const alongChain = clamp01(position.getX(i) / width) * (boneCount - 1);
    const index = Math.min(boneCount - 2, Math.floor(alongChain));
    const weight = alongChain - index;
    skinIndices.push(index, index + 1, 0, 0);
    skinWeights.push(1 - weight, weight, 0, 0);
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));

  const bones: THREE.Bone[] = [];
  for (let i = 0; i < boneCount; i += 1) {
    const bone = new THREE.Bone();
    bone.position.x = i === 0 ? 0 : segmentLength;
    const parent = bones[i - 1];
    if (parent) parent.add(bone);
    bones.push(bone);
  }

  const root = bones[0];
  if (!root) throw new Error("The page needs a binding bone");
  const mesh = new THREE.SkinnedMesh(geometry, materials);
  mesh.add(root);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const tangentTargets = new Float32Array(boneCount);

  const update = (progress: number, dir: 1 | -1) => {
    const p = clamp01(progress);
    const crease = cfg.creaseStart + (cfg.creaseEnd - cfg.creaseStart) * smooth01(p);
    const envelope = Math.sin(Math.PI * p);

    for (let i = 0; i < boneCount; i += 1) {
      const u = i / (boneCount - 1);
      const fold = creaseStep(u, crease, cfg.creaseWidth);
      const curl = dir * cfg.creaseCurl * envelope * fold;
      const gutter = dir * cfg.spineCurl * envelope * Math.exp(-u / cfg.spineWidth);
      const twist =
        dir * cfg.cornerTwist * envelope * smooth01((u - crease + 0.18) / 0.35);
      tangentTargets[i] = curl + gutter + twist;
    }

    let previous = 0;
    for (let i = 0; i < boneCount; i += 1) {
      const bone = bones[i];
      if (!bone) continue;
      const target = tangentTargets[i] ?? 0;
      bone.rotation.y = target - previous;
      bone.rotation.z = i === boneCount - 1 ? dir * cfg.cornerTwist * envelope * 0.35 : 0;
      bone.position.z = 0;
      previous = target;
    }

    root.position.x = 0;
    root.position.z = 0;
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