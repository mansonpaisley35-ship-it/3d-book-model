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

  // text block, inset by the page margins. `spineHollow` slides the spine-side
  // edge of the block between the inner face of the spine shell (0, no cavity)
  // and just past the joint groove (1, a classic hollow back).
  const pageForeX = W / 2 - c.marginFore;
  const spineInnerX = -W / 2 - c.spineBuckle + c.boardThickness * 1.15;
  const hollow = Math.min(1, Math.max(0, c.spineHollow));
  const pageSpineX = spineInnerX + (hingeX + hingeW * 0.5 - spineInnerX) * hollow;
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
    spineInnerX,
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
    curveSegments: 96,
    bevelEnabled: true,
    bevelThickness: ER,
    bevelSize: ER * 0.85,
    bevelOffset: -ER * 0.85,
    bevelSegments: 12,
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
 * mesh rotated 180 degrees about X, so both sides carry the groove.
 */
/** Quintic smootherstep valley: 1 at the centre, 0 with zero slope at the rim. */
function bump(u: number) {
  const a = 1 - Math.min(1, Math.abs(u));
  return a * a * a * (a * (a * 6 - 15) + 10);
}

function buildBoardGeometry(c: BookConfig) {
  const { W, T, hingeX, hingeW } = metrics(c);
  const BOARD = c.boardThickness;
  const D = Math.min(c.grooveDepth, BOARD * 0.7);
  const R = Math.min(c.cornerRadius, BOARD * 0.45);
  const out = T / 2; // outer face
  const inn = T / 2 - BOARD; // inner face (against the text block)
  const tip = hingeX - hingeW; // spine-side end of the board
  const lip = out - D * 0.2; // where the board meets the spine cloth

  // Analytic groove: a C2 valley, so the flat cover flows into it and out of
  // it again with matching tangents instead of showing two faceted quads.
  const half = hingeW * (1 + Math.min(1, Math.max(0, c.grooveBlend)));
  const grooveY = (x: number) => out - D * bump((x - hingeX) / half);

  const s = new THREE.Shape();
  const x0 = W / 2 - R;
  const steps = 96;
  s.moveTo(x0, out);
  for (let i = 1; i <= steps; i++) {
    const x = x0 + ((tip - x0) * i) / steps;
    let y = grooveY(x);
    if (x < hingeX) {
      // ease the spine-side end up into the lip, tangent to the spine shell
      const t = Math.min(1, (hingeX - x) / Math.max(1e-5, hingeX - tip));
      const e = t * t * (3 - 2 * t);
      y = y * (1 - e) + lip * e;
    }
    s.lineTo(x, y);
  }
  // spine-side end cap
  s.lineTo(tip, inn);
  // inner face back to the fore-edge, with the rounded corner
  s.lineTo(W / 2, inn);
  s.lineTo(W / 2, out - R);
  for (let i = 1; i <= 16; i++) {
    const a = (i / 16) * (Math.PI / 2);
    s.lineTo(W / 2 - R * (1 - Math.cos(a)), out - R + R * Math.sin(a));
  }

  return extrude(s, c);
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

  // Superellipse profile: the exponent goes from a soft round back to a flat,
  // square back with tight corners as `spineSquareness` rises.
  const q = Math.min(1, Math.max(0, c.spineSquareness));
  const p = 2 + q * q * 12;
  const outerX = (y: number) => crown + (tipX - crown) * Math.pow(Math.abs(y) / tipY, p);
  const innerTip = tipY - BOARD;
  const innerCrown = crown + BOARD * 1.15;
  const innerX = (y: number) =>
    innerCrown + (tipX - innerCrown) * Math.pow(Math.abs(y) / Math.max(1e-5, innerTip), p);

  const N = 128;
  const s = new THREE.Shape();
  s.moveTo(tipX, tipY);
  for (let i = 1; i <= N; i++) {
    const y = tipY - (2 * tipY * i) / N;
    s.lineTo(outerX(y), y);
  }
  s.lineTo(tipX, -innerTip);
  for (let i = 1; i <= N; i++) {
    const y = -innerTip + (2 * innerTip * i) / N;
    s.lineTo(innerX(y), y);
  }
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

  const boardGeo = useMemo(() => buildBoardGeometry(c), [c]);
  const spineGeo = useMemo(() => buildSpineGeometry(c), [c]);
  useEffect(
    () => () => {
      boardGeo.dispose();
      spineGeo.dispose();
    },
    [boardGeo, spineGeo],
  );


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

  const makeCloth = (color: string) =>
    new THREE.MeshPhysicalMaterial({
      color,
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
    });

  const boardMaterial = useMemo(
    () => makeCloth(c.clothColor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maps, c.clothRoughness, c.clothSheen, c.clothColor],
  );
  const spineMaterial = useMemo(
    () => makeCloth(c.spineColor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maps, c.clothRoughness, c.clothSheen, c.spineColor],
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
      {/* front board */}
      <mesh geometry={boardGeo} material={boardMaterial} castShadow receiveShadow />
      {/* back board — same plate, flipped, so its joint groove matches the front */}
      <mesh
        geometry={boardGeo}
        material={boardMaterial}
        rotation={[Math.PI, 0, 0]}
        castShadow
        receiveShadow
      />
      {/* spine / edge bridge */}
      <mesh geometry={spineGeo} material={spineMaterial} castShadow receiveShadow />

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
