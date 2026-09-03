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
import { PageBlock } from "./PageBlock";
import type { PdfPage } from "./pdf";
import { DEFAULT_CONFIG, type BookConfig } from "./config";

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

/** All derived measurements of the case, computed from the config. */
function metrics(c: BookConfig) {
  const W = c.width;
  const H = c.height;
  const T = c.pageDepth + c.boardThickness * 2;
  const hingeX = -W / 2 + c.grooveOffset;
  const hingeW = c.grooveWidth / 2;
  const spineSurf = -W / 2 - c.spineBuckle - 0.007;

  const panelX0 = hingeX + hingeW + 0.015;
  const panelX1 = W / 2 - c.cornerRadius;
  const panelW = Math.max(0.2, panelX1 - panelX0);
  const panelCX = (panelX0 + panelX1) / 2;
  const panelH = Math.max(0.2, H - c.edgeRound * 2.4);

  // text block, inset by the page margins
  const pageForeX = W / 2 - c.marginFore;
  const pageSpineX = hingeX + hingeW * 0.5;
  const pw = Math.max(0.3, pageForeX - pageSpineX);
  const ph = Math.max(0.3, H - c.marginTop - c.marginBottom);
  const pt = Math.max(0.06, c.pageDepth - 0.04);
  const pageCX = (pageForeX + pageSpineX) / 2;
  const pageCY = (c.marginBottom - c.marginTop) / 2;

  return {
    W,
    H,
    T,
    hingeX,
    hingeW,
    spineSurf,
    panelW,
    panelCX,
    panelH,
    pw,
    ph,
    pt,
    pageCX,
    pageCY,
  };
}

/**
 * Shared extrude settings: the cross-section lives in XY and is pushed along
 * the book's height, with a bevel that rounds the head and the tail.
 */
function extrude(shape: THREE.Shape, c: BookConfig) {
  const ER = Math.min(c.edgeRound, c.boardThickness * 0.9, c.height / 20);
  const depth = c.height - ER * 2;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: 64,
    bevelEnabled: true,
    bevelThickness: ER,
    bevelSize: ER * 0.85,
    bevelOffset: -ER * 0.85,
    bevelSegments: 5,
  });
  geo.rotateX(Math.PI / 2); // extrusion axis becomes the book's height
  geo.translate(0, depth / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * One board (front or back) as its own mesh, like the reference model: a flat
 * plate with a rounded fore-edge and a single narrow, shallow joint groove
 * pressed into its outer face just past the spine. The back board is the same
 * geometry mirrored, so both sides carry the groove.
 */
function buildBoardGeometry(c: BookConfig, side: 1 | -1) {
  const { W, T, hingeX, hingeW } = metrics(c);
  const BOARD = c.boardThickness;
  const D = Math.min(c.grooveDepth, BOARD * 0.7);
  const R = Math.min(c.cornerRadius, BOARD * 0.45);
  const out = T / 2; // outer face
  const inn = T / 2 - BOARD; // inner face (against the text block)
  const tip = hingeX - hingeW; // spine-side end of the board
  const lip = out - D * 0.2; // where the board meets the spine cloth

  const s = new THREE.Shape();
  // outer face: fore-edge -> groove -> spine-side tip
  s.moveTo(W / 2 - R, out);
  s.lineTo(hingeX + hingeW, out);
  s.quadraticCurveTo(hingeX + hingeW * 0.4, out, hingeX, out - D);
  s.quadraticCurveTo(hingeX - hingeW * 0.4, out - D, tip, lip);
  // spine-side end cap
  s.lineTo(tip, inn);
  // inner face back to the fore-edge, with the rounded corner
  s.lineTo(W / 2, inn);
  s.lineTo(W / 2, out - R);
  s.quadraticCurveTo(W / 2, out, W / 2 - R, out);

  const geo = extrude(s, c);
  if (side === -1) {
    geo.scale(1, 1, -1);
    geo.scale(-1, 1, 1); // two reflections keep the winding intact
    geo.translate(0, 0, 0);
    geo.rotateY(Math.PI); // net effect: mirrored across z, faces still outward
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * The spine / edge bridge: a rounded cloth shell arcing from the front joint
 * to the back joint, with its own inner lining offset by the board thickness.
 * It is a separate mesh, so it can carry its own colour and artwork.
 */
function buildSpineGeometry(c: BookConfig) {
  const { W, T, hingeX, hingeW } = metrics(c);
  const BOARD = c.boardThickness;
  const D = Math.min(c.grooveDepth, BOARD * 0.7);
  const buckle = c.spineBuckle;
  const tipX = hingeX - hingeW * 0.2; // tucks slightly under the groove
  const tipY = T / 2 - D * 0.35;
  const crown = -W / 2 - buckle;

  const s = new THREE.Shape();
  s.moveTo(tipX, tipY);
  s.bezierCurveTo(crown, T * 0.42, crown, -T * 0.42, tipX, -tipY);
  s.lineTo(tipX, -tipY + BOARD);
  s.bezierCurveTo(
    crown + BOARD * 1.15,
    -T * 0.36,
    crown + BOARD * 1.15,
    T * 0.36,
    tipX,
    tipY - BOARD,
  );
  s.lineTo(tipX, tipY);

  return extrude(s, c);
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
  pages = [],
  config = DEFAULT_CONFIG,
  onEdit,
}: {
  autoRotate?: boolean;
  images?: BookImages;
  adjusts?: BookAdjusts;
  pages?: PdfPage[];
  config?: BookConfig;
  onEdit?: (slot: keyof BookImages) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const c = config;
  const m = useMemo(() => metrics(c), [c]);

  const caseGeo = useMemo(() => buildCaseGeometry(c), [c]);
  useEffect(() => () => caseGeo.dispose(), [caseGeo]);

  const pageGeo = useMemo(
    () => new THREE.BoxGeometry(m.pw, m.ph, m.pt, 1, 1, 1),
    [m.pw, m.ph, m.pt],
  );
  useEffect(() => () => pageGeo.dispose(), [pageGeo]);

  const aFront = adjusts.front ?? DEFAULT_ADJUST;
  const aBack = adjusts.back ?? DEFAULT_ADJUST;
  const aSpine = adjusts.spine ?? DEFAULT_ADJUST;
  const aEdges = adjusts.edges ?? DEFAULT_ADJUST;

  const frontTex = useImageTexture(images.front, m.panelW / m.panelH, aFront);
  const backTex = useImageTexture(images.back, m.panelW / m.panelH, aBack);
  const spineTex = useImageTexture(images.spine, (m.T * 0.86) / m.ph, aSpine);
  const edgeTex = useImageTexture(images.edges, m.ph / Math.max(0.001, m.pt), aEdges);

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
        vertexColors: true,
        roughness: c.clothRoughness,
        roughnessMap: maps.clothRough,
        metalness: 0,
        normalMap: maps.clothNormal,
        normalScale: new THREE.Vector2(0.5, 0.5),
        sheen: c.clothSheen,
        sheenRoughness: 0.85,
        sheenColor: new THREE.Color("#7d93ad"),
        clearcoat: 0.04,
        clearcoatRoughness: 0.7,
      }),
    [maps, c.clothRoughness, c.clothSheen],
  );

  const pageSideMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: c.pageColor, roughness: 0.95 }),
    [c.pageColor],
  );

  // fore-edge / head / tail get the striated (or user-supplied) map
  const pageMaterials = useMemo(() => {
    const base = edgeTex ?? maps.pageEdge;

    const fore = new THREE.MeshStandardMaterial({
      color: edgeTex ? "#ffffff" : c.edgeColor,
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
  }, [pageSideMaterial, maps, edgeTex, c.edgeColor]);

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
  const quillSize = Math.min(0.4, m.W * 0.12);

  return (
    <group ref={group}>
      <mesh geometry={caseGeo} material={clothMaterial} castShadow receiveShadow />

      {/* text block, inset by the page margins. With a PDF imported it becomes
       * a stack of real leaves, each hinged at the spine. */}
      <group position={[m.pageCX, m.pageCY, 0]}>
        <PageBlock
          width={m.pw}
          height={m.ph}
          thickness={m.pt}
          pages={pages}
          paperColor={c.pageColor}
          fillGeometry={pageGeo}
          fillMaterials={pageMaterials}
        />
      </group>

      {/* head-edge hairline (hidden once a custom edge image is supplied) */}
      {c.headband && !edgeTex && (
        <mesh
          position={[m.pageCX, m.pageCY + m.ph / 2 + 0.001, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[m.pw * 0.99, m.pt * 0.028]} />
          <meshStandardMaterial color={c.headbandColor} roughness={0.85} />
        </mesh>
      )}

      {/* front cover artwork — stops short of the joint groove */}
      {frontTex && (
        <mesh position={[m.panelCX, 0, m.T / 2 + 0.004]}>
          <planeGeometry args={[m.panelW, m.panelH]} />
          <meshStandardMaterial map={frontTex} {...artProps} />
        </mesh>
      )}

      {/* back cover artwork */}
      {backTex && (
        <mesh position={[m.panelCX, 0, -m.T / 2 - 0.004]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[m.panelW, m.panelH]} />
          <meshStandardMaterial map={backTex} {...artProps} />
        </mesh>
      )}

      {/* spine artwork */}
      {spineTex && (
        <mesh position={[m.spineSurf, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[m.T * 0.86, m.ph]} />
          <meshStandardMaterial map={spineTex} {...artProps} />
        </mesh>
      )}

      {/* quill = edit button, front cover, near the fore-edge corner */}
      <mesh
        position={[m.W / 2 - quillSize * 0.9, -m.H / 2 + quillSize * 1.05, m.T / 2 + 0.012]}
        onClick={(e) => {
          e.stopPropagation();
          onEdit?.("front");
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "auto")}
      >
        <planeGeometry args={[quillSize, quillSize]} />
        <meshPhysicalMaterial {...quillProps} alphaMap={maps.quill} />
      </mesh>

      {/* quill = edit button, back cover, mirrored to its own fore-edge corner */}
      <mesh
        position={[m.W / 2 - quillSize * 0.9, -m.H / 2 + quillSize * 1.05, -m.T / 2 - 0.012]}
        rotation={[0, Math.PI, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onEdit?.("back");
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "auto")}
      >
        <planeGeometry args={[quillSize, quillSize]} />
        <meshPhysicalMaterial {...quillProps} alphaMap={maps.quill} opacity={0.9} />
      </mesh>

      {/* quill = edit button, spine foot */}
      <mesh
        position={[m.spineSurf - 0.004, -m.H / 2 + quillSize * 1.15, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onEdit?.("spine");
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "auto")}
      >
        <planeGeometry args={[Math.min(0.3, m.T * 0.7), Math.min(0.3, m.T * 0.7)]} />
        <meshPhysicalMaterial {...quillProps} alphaMap={maps.quill} opacity={0.9} />
      </mesh>
    </group>
  );
}
