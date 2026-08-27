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
 * The case (both boards + spine) is one continuous cross-section extruded
 * along the book's height, so the joint groove exists symmetrically on the
 * front AND the back, with smooth shared normals.
 */
function buildCaseGeometry(c: BookConfig) {
  const { W, H, T, hingeX, hingeW } = metrics(c);
  const BOARD = c.boardThickness;
  const R = Math.min(c.cornerRadius, T / 2 - 0.005);
  const D = Math.min(c.grooveDepth, BOARD * 0.85);
  const buckle = c.spineBuckle;
  const ER = Math.min(c.edgeRound, T / 3, H / 20);

  const s = new THREE.Shape();
  const half = T / 2;

  // ---- outer surface, front board: fore-edge -> hinge -------------------
  s.moveTo(W / 2 - R, -half);
  s.lineTo(hingeX + hingeW, -half);
  // joint groove (front)
  s.quadraticCurveTo(hingeX + hingeW * 0.45, -half, hingeX, -half + D);
  s.quadraticCurveTo(hingeX - hingeW * 0.45, -half + D * 0.9, hingeX - hingeW, -half + 0.012);

  // ---- rounded spine ----------------------------------------------------
  s.bezierCurveTo(
    -W / 2 - buckle, -half * 0.82,
    -W / 2 - buckle, half * 0.82,
    hingeX - hingeW, half - 0.012,
  );

  // ---- joint groove (back) ---------------------------------------------
  s.quadraticCurveTo(hingeX - hingeW * 0.45, half - D * 0.9, hingeX, half - D);
  s.quadraticCurveTo(hingeX + hingeW * 0.45, half, hingeX + hingeW, half);
  s.lineTo(W / 2 - R, half);
  s.quadraticCurveTo(W / 2, half, W / 2, half - R);

  // ---- inner surfaces: back board -> spine lining -> front board --------
  s.lineTo(W / 2, half - BOARD);
  s.lineTo(hingeX + 0.02, half - BOARD);
  s.bezierCurveTo(
    -W / 2 + 0.1, half * 0.7,
    -W / 2 + 0.1, -half * 0.7,
    hingeX + 0.02, -half + BOARD,
  );
  s.lineTo(W / 2, -half + BOARD);
  s.lineTo(W / 2, -half + R);
  s.quadraticCurveTo(W / 2, -half, W / 2 - R, -half);

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: H - ER * 2,
    curveSegments: 48,
    bevelEnabled: true,
    bevelThickness: ER,
    bevelSize: ER * 0.85,
    bevelOffset: -ER * 0.85,
    bevelSegments: 5,
  });
  geo.rotateX(-Math.PI / 2); // extrusion axis becomes the book's height
  geo.center();
  geo.computeVertexNormals();

  // per-vertex tint so the spine can carry its own cloth colour
  const pos = geo.attributes["position"]!;
  const board = new THREE.Color(c.clothColor).convertSRGBToLinear();
  const spine = new THREE.Color(c.spineColor).convertSRGBToLinear();
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const t = THREE.MathUtils.smoothstep(x, hingeX - hingeW, hingeX + hingeW);
    const col = spine.clone().lerp(board, t);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
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
