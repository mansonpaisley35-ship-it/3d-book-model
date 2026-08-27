import { useMemo } from "react";
import * as THREE from "three";
import type { PdfPage } from "./pdf";

export const LEAF_THICKNESS = 0.006;

/**
 * A single leaf (one sheet = recto + verso), hinged at the spine so a future
 * page-flip animation only has to drive `flip` (radians, 0 = closed).
 */
function Leaf({
  width,
  height,
  thickness,
  z,
  recto,
  verso,
  paper,
  flip = 0,
}: {
  width: number;
  height: number;
  thickness: number;
  z: number;
  recto?: THREE.Texture | undefined;
  verso?: THREE.Texture | undefined;
  paper: THREE.Material;
  flip?: number | undefined;
}) {
  const geo = useMemo(
    () => new THREE.BoxGeometry(width, height, thickness),
    [width, height, thickness],
  );

  const materials = useMemo(() => {
    const face = (map?: THREE.Texture) =>
      map
        ? new THREE.MeshStandardMaterial({ map, roughness: 0.94, metalness: 0 })
        : (paper as THREE.Material);
    return [paper, paper, paper, paper, face(recto), face(verso)];
  }, [recto, verso, paper]);

  // pivot at the spine edge so rotation.y sweeps the leaf open
  return (
    <group position={[-width / 2, 0, z]} rotation={[0, flip, 0]}>
      <mesh geometry={geo} material={materials} position={[width / 2, 0, 0]} castShadow receiveShadow />
    </group>
  );
}

/**
 * The text block. When PDF pages are supplied every visible leaf carries a
 * rendered page (recto/verso), and the remaining thickness is filled by a
 * solid block so the case still looks full.
 */
export function PageBlock({
  width,
  height,
  thickness,
  pages,
  paperColor = "#f6f1e4",
  fillGeometry,
  fillMaterials,
}: {
  width: number;
  height: number;
  thickness: number;
  pages: PdfPage[];
  paperColor?: string;
  fillGeometry: THREE.BufferGeometry;
  fillMaterials: THREE.Material[];
}) {
  const paper = useMemo(
    () => new THREE.MeshStandardMaterial({ color: paperColor, roughness: 0.95, metalness: 0 }),
    [paperColor],
  );

  const leafCount = Math.max(1, Math.ceil(pages.length / 2));
  const leafT = Math.min(LEAF_THICKNESS, (thickness * 0.85) / leafCount);
  const stack = leafCount * leafT;

  if (!pages.length) {
    return <mesh geometry={fillGeometry} material={fillMaterials} castShadow receiveShadow />;
  }

  return (
    <group>
      {/* bulk of the text block, pushed behind the rendered leaves */}
      <group position={[0, 0, -stack / 2]} scale={[1, 1, (thickness - stack) / thickness]}>
        <mesh geometry={fillGeometry} material={fillMaterials} castShadow receiveShadow />
      </group>

      {Array.from({ length: leafCount }, (_, i) => (
        <Leaf
          key={i}
          width={width}
          height={height}
          thickness={leafT * 0.9}
          z={thickness / 2 - leafT * (i + 0.5)}
          recto={pages[i * 2]?.texture}
          verso={pages[i * 2 + 1]?.texture}
          paper={paper}
        />
      ))}
    </group>
  );
}
