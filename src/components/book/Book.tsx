import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  makeClothNormalMap,
  makeClothRoughnessMap,
  makePageEdgeMap,
  makeStampMap,
  drawColophon,
  drawSpineText,
} from "./textures";

/* ---------------------------------------------------------------------------
 * Dimensions of a Stripe Press hardcover (in scene units, 1 unit ~= 2.5 cm)
 * ------------------------------------------------------------------------- */
const W = 3.35; // cover width, spine -> fore-edge
const H = 5.0; // cover height
const T = 1.05; // total thickness across the closed case
const BOARD = 0.085; // board + cloth thickness
const R_CORNER = 0.05; // rounded fore-edge corner of the boards
const HINGE_X = -W / 2 + 0.19; // centre of the joint groove
const HINGE_W = 0.075; // half-width of the groove
const HINGE_D = 0.05; // groove depth
const EDGE_ROUND = 0.035; // head/tail edge rounding of the case
const SPINE_SURF = -W / 2 - 0.062; // just outside the spine crown, for stamped artwork

/**
 * The case (both boards + spine) is one continuous cross-section extruded
 * along the book's height. Modelling it as a profile means the joint groove
 * exists symmetrically on the front AND the back, and the spine, boards and
 * grooves share perfectly smooth normals — the two things the AI-generated
 * mesh got wrong.
 */
function buildCaseGeometry() {
  const s = new THREE.Shape();
  const half = T / 2;

  // ---- outer surface, front board: fore-edge -> hinge -------------------
  s.moveTo(W / 2 - R_CORNER, -half);
  s.lineTo(HINGE_X + HINGE_W, -half);
  // joint groove (front)
  s.quadraticCurveTo(HINGE_X + HINGE_W * 0.45, -half, HINGE_X, -half + HINGE_D);
  s.quadraticCurveTo(HINGE_X - HINGE_W * 0.45, -half + HINGE_D * 0.9, HINGE_X - HINGE_W, -half + 0.012);

  // ---- rounded spine ----------------------------------------------------
  s.bezierCurveTo(
    -W / 2 - 0.055, -half * 0.82,
    -W / 2 - 0.055, half * 0.82,
    HINGE_X - HINGE_W, half - 0.012,
  );

  // ---- joint groove (back) — the mirror the source mesh was missing -----
  s.quadraticCurveTo(HINGE_X - HINGE_W * 0.45, half - HINGE_D * 0.9, HINGE_X, half - HINGE_D);
  s.quadraticCurveTo(HINGE_X + HINGE_W * 0.45, half, HINGE_X + HINGE_W, half);
  s.lineTo(W / 2 - R_CORNER, half);
  s.quadraticCurveTo(W / 2, half, W / 2, half - R_CORNER);

  // ---- inner surfaces: back board -> spine lining -> front board --------
  s.lineTo(W / 2, half - BOARD);
  s.lineTo(HINGE_X + 0.02, half - BOARD);
  s.bezierCurveTo(
    -W / 2 + 0.1, half * 0.7,
    -W / 2 + 0.1, -half * 0.7,
    HINGE_X + 0.02, -half + BOARD,
  );
  s.lineTo(W / 2, -half + BOARD);
  s.lineTo(W / 2, -half + R_CORNER);
  s.quadraticCurveTo(W / 2, -half, W / 2 - R_CORNER, -half);

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: H - EDGE_ROUND * 2,
    curveSegments: 48,
    bevelEnabled: true,
    bevelThickness: EDGE_ROUND,
    bevelSize: EDGE_ROUND * 0.85,
    bevelOffset: -EDGE_ROUND * 0.85,
    bevelSegments: 5,
  });
  geo.rotateX(-Math.PI / 2); // extrusion axis becomes the book's height
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

function buildPageGeometry() {
  const pw = W - 0.14;
  const ph = H - 0.16;
  const pt = T - BOARD * 2 - 0.05;
  const geo = new THREE.BoxGeometry(pw, ph, pt, 1, 1, 1);
  return { geo, pw, ph, pt };
}

export function Book({ autoRotate = true }: { autoRotate?: boolean }) {
  const group = useRef<THREE.Group>(null);

  const caseGeo = useMemo(buildCaseGeometry, []);
  const page = useMemo(buildPageGeometry, []);

  const maps = useMemo(() => {
    const clothNormal = makeClothNormalMap();
    const clothRough = makeClothRoughnessMap();
    const pageEdge = makePageEdgeMap();
    const colophon = makeStampMap(256, 256, drawColophon);
    const spine = makeStampMap(1024, 128, (ctx, w, h) =>
      drawSpineText(ctx, w, h, { text: "The Origins of Efficiency" }),
    );
    const spineAuthor = makeStampMap(512, 128, (ctx, w, h) =>
      drawSpineText(ctx, w, h, { text: "Brian Potter" }),
    );
    const front = makeStampMap(1024, 256, (ctx, w, h) =>
      drawSpineText(ctx, w, h, { text: "The Origins of Efficiency" }),
    );
    return { clothNormal, clothRough, pageEdge, colophon, spine, spineAuthor, front };
  }, []);

  const clothMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#212e3e"),
        roughness: 0.74,
        roughnessMap: maps.clothRough,
        metalness: 0,
        normalMap: maps.clothNormal,
        normalScale: new THREE.Vector2(0.5, 0.5),
        sheen: 0.45,
        sheenRoughness: 0.85,
        sheenColor: new THREE.Color("#7d93ad"),
        clearcoat: 0.04,
        clearcoatRoughness: 0.7,
      }),
    [maps],
  );

  const pageEdgeMaterial = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#efe7d8"),
      roughness: 0.92,
      metalness: 0,
      map: maps.pageEdge,
    });
    return m;
  }, [maps]);

  const pageSideMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#e8e0d0", roughness: 0.95 }),
    [],
  );

  // fore-edge / head / tail get the striated map; the inner faces stay plain
  const pageMaterials = useMemo(() => {
    const edgeTop = pageEdgeMaterial.clone();
    edgeTop.map = maps.pageEdge.clone();
    edgeTop.map.rotation = Math.PI / 2;
    edgeTop.map.center.set(0.5, 0.5);
    edgeTop.map.repeat.set(1, 1);
    edgeTop.map.needsUpdate = true;
    return [
      pageEdgeMaterial, // +x fore edge
      pageSideMaterial, // -x spine side
      edgeTop, // +y head
      edgeTop, // -y tail
      pageSideMaterial, // +z
      pageSideMaterial, // -z
    ];
  }, [pageEdgeMaterial, pageSideMaterial, maps]);

  useFrame((state, dt) => {
    if (!group.current) return;
    if (autoRotate) group.current.rotation.y += dt * 0.16;
    // gentle float so the highlights travel across the cloth
    group.current.position.y = Math.sin(state.clock.elapsedTime * 0.6) * 0.035;
  });

  const stampProps = {
    transparent: true,
    depthWrite: false,
    roughness: 0.5,
    metalness: 0,
    color: "#e6edf5",
  } as const;

  return (
    <group ref={group}>
      <mesh geometry={caseGeo} material={clothMaterial} castShadow receiveShadow />

      {/* text block, seated toward the fore-edge like a real case-bound book */}
      <mesh
        geometry={page.geo}
        material={pageMaterials}
        position={[0.055, 0, 0]}
        castShadow
        receiveShadow
      />

      {/* printed head-edge hairline */}
      <mesh position={[0.055, page.ph / 2 + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[page.pw * 0.99, page.pt * 0.028]} />
        <meshStandardMaterial color="#8f3a34" roughness={0.85} />
      </mesh>

      {/* front cover: white-ink title + colophon */}
      <mesh position={[0.18, -H * 0.3, T / 2 + 0.004]}>
        <planeGeometry args={[1.5, 0.375]} />
        <meshPhysicalMaterial {...stampProps} alphaMap={maps.front} />
      </mesh>
      <mesh position={[W / 2 - 0.34, H / 2 - 0.34, T / 2 + 0.004]}>
        <planeGeometry args={[0.3, 0.3]} />
        <meshPhysicalMaterial {...stampProps} alphaMap={maps.colophon} />
      </mesh>

      {/* back cover: debossed colophon only */}
      <mesh position={[0, 0, -T / 2 - 0.004]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.34, 0.34]} />
        <meshPhysicalMaterial {...stampProps} alphaMap={maps.colophon} opacity={0.75} />
      </mesh>

      {/* spine: title running head-to-tail, author + colophon */}
      <mesh position={[SPINE_SURF, 0.35, 0]} rotation={[0, -Math.PI / 2, -Math.PI / 2]}>
        <planeGeometry args={[2.6, 0.325]} />
        <meshPhysicalMaterial {...stampProps} alphaMap={maps.spine} />
      </mesh>
      <mesh position={[SPINE_SURF, -1.4, 0]} rotation={[0, -Math.PI / 2, -Math.PI / 2]}>
        <planeGeometry args={[0.95, 0.24]} />
        <meshPhysicalMaterial {...stampProps} alphaMap={maps.spineAuthor} opacity={0.9} />
      </mesh>
      <mesh position={[SPINE_SURF, H / 2 - 0.35, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[0.24, 0.24]} />
        <meshPhysicalMaterial {...stampProps} alphaMap={maps.colophon} />
      </mesh>
    </group>
  );
}
