import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  makeClothNormalMap,
  makeClothRoughnessMap,
  makePageEdgeMap,
  makeStampMap,
  drawQuill,
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
const SPINE_SURF = -W / 2 - 0.062; // just outside the spine crown, for artwork

/* Artwork panel: starts just past the joint groove so the hinge stays bare,
 * exactly like the printed paper wrap on a real case-bound book. */
const PANEL_X0 = HINGE_X + HINGE_W + 0.015;
const PANEL_X1 = W / 2 - 0.05;
const PANEL_W = PANEL_X1 - PANEL_X0;
const PANEL_CX = (PANEL_X0 + PANEL_X1) / 2;
const PANEL_H = H - 0.13;

export type BookImages = {
  front?: string;
  back?: string;
  spine?: string;
  edges?: string;
};

export type ImageAdjust = {
  /** zoom, 1 = fitted */
  scale: number;
  /** pan in UV units, -0.5..0.5 */
  offsetX: number;
  offsetY: number;
  /** degrees */
  rotation: number;
  fit: "cover" | "contain";
};

export const DEFAULT_ADJUST: ImageAdjust = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  fit: "cover",
};

export type BookAdjusts = Partial<Record<keyof BookImages, ImageAdjust>>;

/**
 * The case (both boards + spine) is one continuous cross-section extruded
 * along the book's height, so the joint groove exists symmetrically on the
 * front AND the back, with smooth shared normals.
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

  // ---- joint groove (back) ---------------------------------------------
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

/**
 * Fit + crop an image into a surface of the given aspect via the texture's
 * UV transform: repeat = visible slice of the image, offset = pan.
 */
function fitTexture(tex: THREE.Texture, planeAspect: number, adj: ImageAdjust) {
  const img = tex.image as { width?: number; height?: number } | undefined;
  const ia = img?.width && img?.height ? img.width / img.height : planeAspect;

  let rx = 1;
  let ry = 1;
  if (adj.fit === "cover") {
    if (ia > planeAspect) rx = planeAspect / ia;
    else ry = ia / planeAspect;
  } else {
    if (ia > planeAspect) ry = ia / planeAspect;
    else rx = planeAspect / ia;
  }
  const z = Math.max(0.05, adj.scale);
  rx /= z;
  ry /= z;

  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.center.set(0.5, 0.5);
  tex.rotation = (adj.rotation * Math.PI) / 180;
  tex.repeat.set(rx, ry);
  tex.offset.set(0.5 - rx / 2 - adj.offsetX * (1 - rx), 0.5 - ry / 2 + adj.offsetY * (1 - ry));
  tex.needsUpdate = true;
}

/** Load a user-supplied image (data URL or http URL) into a texture. */
function useImageTexture(url: string | undefined, planeAspect: number, adj: ImageAdjust) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) {
      setTex(null);
      return;
    }
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.load(url, (t) => {
      if (cancelled) {
        t.dispose();
        return;
      }
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      setTex(t);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  useEffect(() => () => tex?.dispose(), [tex]);
  useEffect(() => {
    if (tex) fitTexture(tex, planeAspect, adj);
  }, [tex, planeAspect, adj]);
  return tex;
}

export function Book({
  autoRotate = true,
  images = {},
  adjusts = {},
  onEdit,
}: {
  autoRotate?: boolean;
  images?: BookImages;
  adjusts?: BookAdjusts;
  onEdit?: (slot: keyof BookImages) => void;
}) {
  const group = useRef<THREE.Group>(null);

  const caseGeo = useMemo(buildCaseGeometry, []);
  const page = useMemo(buildPageGeometry, []);

  const aFront = adjusts.front ?? DEFAULT_ADJUST;
  const aBack = adjusts.back ?? DEFAULT_ADJUST;
  const aSpine = adjusts.spine ?? DEFAULT_ADJUST;
  const aEdges = adjusts.edges ?? DEFAULT_ADJUST;

  const frontTex = useImageTexture(images.front, PANEL_W / PANEL_H, aFront);
  const backTex = useImageTexture(images.back, PANEL_W / PANEL_H, aBack);
  const spineTex = useImageTexture(images.spine, (T * 0.86) / (H - 0.16), aSpine);
  const edgeTex = useImageTexture(images.edges, (H - 0.16) / (T * 0.6), aEdges);

  const maps = useMemo(() => {
    const clothNormal = makeClothNormalMap();
    const clothRough = makeClothRoughnessMap();
    const pageEdge = makePageEdgeMap();
    const quill = makeStampMap(512, 512, drawQuill);
    return { clothNormal, clothRough, pageEdge, quill };
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

  const pageSideMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#e8e0d0", roughness: 0.95 }),
    [],
  );

  // fore-edge / head / tail get the striated (or user-supplied) map
  const pageMaterials = useMemo(() => {
    const base = edgeTex ?? maps.pageEdge;

    const fore = new THREE.MeshStandardMaterial({
      color: edgeTex ? "#ffffff" : "#efe7d8",
      roughness: 0.92,
      metalness: 0,
      map: base,
    });

    const topMap = base.clone();
    topMap.rotation = Math.PI / 2;
    topMap.center.set(0.5, 0.5);
    topMap.needsUpdate = true;
    const edgeTop = fore.clone();
    edgeTop.map = topMap;

    return [
      fore, // +x fore edge
      pageSideMaterial, // -x spine side
      edgeTop, // +y head
      edgeTop, // -y tail
      pageSideMaterial, // +z
      pageSideMaterial, // -z
    ];
  }, [pageSideMaterial, maps, edgeTex]);

  useFrame((state, dt) => {
    if (!group.current) return;
    if (autoRotate) group.current.rotation.y += dt * 0.16;
    // gentle float so the highlights travel across the cloth
    group.current.position.y = Math.sin(state.clock.elapsedTime * 0.6) * 0.035;
  });

  const quillProps = {
    transparent: true,
    depthWrite: false,
    roughness: 0.5,
    metalness: 0,
    color: "#e6edf5",
  } as const;

  const artProps = { roughness: 0.7, metalness: 0 } as const;

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

      {/* head-edge hairline (hidden once a custom edge image is supplied) */}
      {!edgeTex && (
        <mesh position={[0.055, page.ph / 2 + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[page.pw * 0.99, page.pt * 0.028]} />
          <meshStandardMaterial color="#8a3b35" roughness={0.85} />
        </mesh>
      )}

      {/* front cover artwork — stops short of the joint groove */}
      {frontTex && (
        <mesh position={[PANEL_CX, 0, T / 2 + 0.004]}>
          <planeGeometry args={[PANEL_W, PANEL_H]} />
          <meshStandardMaterial map={frontTex} {...artProps} />
        </mesh>
      )}

      {/* back cover artwork */}
      {backTex && (
        <mesh position={[PANEL_CX, 0, -T / 2 - 0.004]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[PANEL_W, PANEL_H]} />
          <meshStandardMaterial map={backTex} {...artProps} />
        </mesh>
      )}

      {/* spine artwork */}
      {spineTex && (
        <mesh position={[SPINE_SURF, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[T * 0.86, H - 0.16]} />
          <meshStandardMaterial map={spineTex} {...artProps} />
        </mesh>
      )}

      {/* quill = edit button, front cover, near the fore-edge corner */}
      <mesh
        position={[W / 2 - 0.36, -H / 2 + 0.42, T / 2 + 0.012]}
        onClick={(e) => {
          e.stopPropagation();
          onEdit?.("front");
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "auto")}
      >
        <planeGeometry args={[0.4, 0.4]} />
        <meshPhysicalMaterial {...quillProps} alphaMap={maps.quill} />
      </mesh>

      {/* quill = edit button, back cover, mirrored to its own fore-edge corner */}
      <mesh
        position={[W / 2 - 0.36, -H / 2 + 0.42, -T / 2 - 0.012]}
        rotation={[0, Math.PI, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onEdit?.("back");
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "auto")}
      >
        <planeGeometry args={[0.4, 0.4]} />
        <meshPhysicalMaterial {...quillProps} alphaMap={maps.quill} opacity={0.9} />
      </mesh>

      {/* quill = edit button, spine foot */}
      <mesh
        position={[SPINE_SURF - 0.004, -H / 2 + 0.45, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onEdit?.("spine");
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "auto")}
      >
        <planeGeometry args={[0.3, 0.3]} />
        <meshPhysicalMaterial {...quillProps} alphaMap={maps.quill} opacity={0.9} />
      </mesh>
    </group>
  );
}
