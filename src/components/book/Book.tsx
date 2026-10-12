import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  makeClothNormalMap,
  makeClothRoughnessMap,
  makePageEdgeMap,
  makeStampMap,
  drawQuill,
} from "./textures";
import { RigView, setMatrix } from "./RigView";
import { toRigCfg, leavesFor } from "./rig/adapter";
import { rigAt, type RigState } from "./rig/rig";
import { click, dragStart, dragMove, dragEnd } from "./rig/flip";
import { sideFor } from "./rig-interaction";
import type { useBookMotion } from "./book-state";
import type { PdfBookSource } from "./pdf-source";
import { DEFAULT_CONFIG, type BookConfig } from "./config";

export type Reading = ReturnType<typeof useBookMotion>;

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
  const W = c.bookWidth;
  const H = c.bookHeight;
  const T = c.pageBlockThickness + c.boardThickness * 2;
  const hingeX = -W / 2 + c.jointPosition;
  const hingeW = c.jointWidth / 2;
  const spineSurf = -W / 2 - c.spineExtension - 0.007;

  const panelX0 = hingeX + hingeW + 0.015;
  const panelX1 = W / 2 - c.coverCornerRadius;
  const panelW = Math.max(0.2, panelX1 - panelX0);
  const panelCX = (panelX0 + panelX1) / 2;
  const panelH = Math.max(0.2, H - c.headTailEdgeRadius * 2.4);

  // Page block. The boards project past it by `coverOverhang` at the head, tail
  // and fore-edge; the per-edge margins are a fine trim on top of that.
  // `hollowBack` slides the spine-side edge of the block between the inner face
  // of the spine shell (0, no cavity) and just past the joint (1, hollow back).
  const insetFore = c.coverOverhang + c.foreEdgeMargin;
  const insetHead = c.coverOverhang + c.headMargin;
  const insetTail = c.coverOverhang + c.tailMargin;

  const pageForeX = W / 2 - insetFore;
  const spineInnerX = -W / 2 - c.spineExtension + c.boardThickness * 1.15;
  const hollow = Math.min(1, Math.max(0, c.hollowBack));
  const pageSpineX = spineInnerX + (hingeX + hingeW * 0.5 - spineInnerX) * hollow;
  const pw = Math.max(0.3, pageForeX - pageSpineX);
  const ph = Math.max(0.3, H - insetHead - insetTail);
  const pt = Math.max(0.06, c.pageBlockThickness - 0.04);
  const pageCX = (pageForeX + pageSpineX) / 2;
  const pageCY = (insetTail - insetHead) / 2;

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
  const ER = Math.min(c.headTailEdgeRadius, c.boardThickness * 0.9, c.bookHeight / 20);
  const depth = c.bookHeight - ER * 2;
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
 * The page block: a slab in XY extruded through its thickness, with the fore-
 * edge corners rounded by `pageBlockCornerRadius` (0 = a crisp cut block).
 * Material groups keep the same slot order the box geometry used, so the
 * fore-edge / head / tail can still carry the page-edge map.
 */
function buildPageBlockGeometry(w: number, h: number, t: number, radius: number) {
  const R = Math.max(0, Math.min(radius, w / 2 - 0.01, h / 2 - 0.01));
  if (R <= 0.0005) return new THREE.BoxGeometry(w, h, t, 1, 1, 1);

  const s = new THREE.Shape();
  const x1 = w / 2;
  const y1 = h / 2;
  s.moveTo(-x1, -y1);
  s.lineTo(x1 - R, -y1);
  s.quadraticCurveTo(x1, -y1, x1, -y1 + R);
  s.lineTo(x1, y1 - R);
  s.quadraticCurveTo(x1, y1, x1 - R, y1);
  s.lineTo(-x1, y1);
  s.closePath();

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: t,
    curveSegments: 24,
    bevelEnabled: false,
  });
  geo.translate(0, 0, -t / 2);
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

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The single shared joint contract used by BOTH the boards and the spine, so
 * they always meet at the same point with the same (flat) tangent whatever the
 * configuration is: `jointX` is the outer rim of the groove valley, where the
 * cover surface is once again perfectly flat at y = ±T/2.
 */
function joint(c: BookConfig) {
  const { W, T, hingeX, hingeW } = metrics(c);
  const half = hingeW * (1 + clamp01(c.jointSoftness));
  const jointX = hingeX - half;
  // tiny overlap so no hairline can show through the tangent seam
  const overlap = Math.min(0.005, half * 0.3);
  return { W, T, half, jointX, overlap, hingeX };
}

function buildBoardGeometry(c: BookConfig) {
  const { W, T, half, jointX, overlap, hingeX } = joint(c);
  const BOARD = c.boardThickness;
  const D = Math.min(c.jointDepth, BOARD * 0.7);
  const R = Math.min(c.coverCornerRadius, BOARD * 0.45);
  const out = T / 2; // outer face
  const inn = T / 2 - BOARD; // inner face (against the text block)
  const tip = jointX - overlap; // spine-side end of the board, past the groove rim

  // Analytic groove: a C2 valley, so the flat cover flows into it and out of
  // it again with matching tangents instead of showing two faceted quads.
  const grooveY = (x: number) => out - D * bump((x - hingeX) / half);

  const s = new THREE.Shape();
  const x0 = W / 2 - R;
  const steps = 160;
  s.moveTo(x0, out);
  for (let i = 1; i <= steps; i++) {
    const x = x0 + ((tip - x0) * i) / steps;
    s.lineTo(x, grooveY(x));
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
 * The spine / edge bridge: a superellipse shell arcing from the front joint to
 * the back joint. The profile is written as X(Y) of a superellipse whose tips
 * land exactly on the board's outer plane with a HORIZONTAL tangent, and whose
 * crown is vertical — so the shell melts into both boards for any squareness,
 * buckle or groove setting.
 */
function buildSpineGeometry(c: BookConfig) {
  const { T, jointX } = joint(c);
  const BOARD = c.boardThickness;
  const buckle = c.spineExtension;
  const crown = -c.bookWidth / 2 - buckle;

  const q = clamp01(c.spineProfileFlatness);
  const m = 2 + q * q * 12; // 2 = round back, high = square back

  const b = T / 2;
  const a = Math.max(1e-4, jointX - crown);
  const bIn = Math.max(1e-4, b - BOARD);
  const aIn = Math.max(1e-4, jointX - (crown + BOARD));

  // X(Y) with (1 - X)^m + Y^m = 1: tangent is flat at the tip, vertical at the crown.
  const prof = (y: number, aa: number, bb: number, x0: number) => {
    const Y = Math.min(1, Math.abs(y) / bb);
    const X = 1 - Math.pow(Math.max(0, 1 - Math.pow(Y, m)), 1 / m);
    return x0 + aa * X;
  };

  const N = 192;
  const s = new THREE.Shape();
  s.moveTo(jointX, b);
  for (let i = 1; i <= N; i++) {
    const y = b - (2 * b * i) / N;
    s.lineTo(prof(y, a, b, crown), y);
  }
  s.lineTo(jointX, -bIn);
  for (let i = 1; i <= N; i++) {
    const y = -bIn + (2 * bIn * i) / N;
    s.lineTo(prof(y, aIn, bIn, crown + BOARD), y);
  }
  s.lineTo(jointX, b);

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
  source = null,
  reading,
  config = DEFAULT_CONFIG,
  onEdit,
  editable = false,
  onActivate,
  onPress,
}: {
  onPress?: (pressed: boolean) => void;
  editable?: boolean;
  /** double tap on the case */
  onActivate?: () => void;
  autoRotate?: boolean;
  images?: BookImages;
  adjusts?: BookAdjusts;
  /** an imported PDF, whose own pages become the pages of the book */
  source?: PdfBookSource | null;
  /** opening / page-turning state, owned by the scene */
  reading?: Reading;
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

  const rounded = c.pageBlockCornerRadius > 0.0005;
  const pageGeo = useMemo(
    () => buildPageBlockGeometry(m.pw, m.ph, m.pt, c.pageBlockCornerRadius),
    [m.pw, m.ph, m.pt, c.pageBlockCornerRadius],
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
    const quill = makeStampMap(512, 512, drawQuill);
    return { clothNormal, clothRough, quill };
  }, []);

  // striated page edges, re-cut whenever the edge style or variation changes
  const pageEdgeMap = useMemo(
    () => makePageEdgeMap(c.pageEdgeTexture, c.pageEdgeVariation),
    [c.pageEdgeTexture, c.pageEdgeVariation],
  );
  useEffect(() => () => pageEdgeMap.dispose(), [pageEdgeMap]);

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
    const base = edgeTex ?? pageEdgeMap;
    const v = Math.min(1, Math.max(0, c.pageEdgeVariation));

    const fore = new THREE.MeshStandardMaterial({
      color: edgeTex ? "#ffffff" : c.edgeColor,
      roughness: 0.92 + v * 0.06,
      metalness: 0,
      map: base,
      bumpMap: edgeTex ? null : base,
      bumpScale: edgeTex ? 0 : 0.02 + v * 0.12,
    });

    const topMap = base.clone();
    topMap.rotation = Math.PI / 2;
    topMap.center.set(0.5, 0.5);
    topMap.needsUpdate = true;
    const edgeTop = fore.clone();
    edgeTop.map = topMap;
    if (!edgeTex) edgeTop.bumpMap = topMap;

    // the rounded page block is an extrusion: group 0 = the two flat faces
    // against the boards, group 1 = every wall (fore-edge, head, tail)
    if (rounded) return [pageSideMaterial, fore];

    return [
      fore, // +x fore edge
      pageSideMaterial, // -x spine side
      edgeTop, // +y head
      edgeTop, // -y tail
      pageSideMaterial, // +z
      pageSideMaterial, // -z
    ];
  }, [pageSideMaterial, pageEdgeMap, edgeTex, c.edgeColor, c.pageEdgeVariation, rounded]);

  /* The outer pose/float remains untouched. Only this wrapper is rig-owned. */
  const rig = useRef<THREE.Group>(null);
  const frontHolder = useRef<THREE.Group>(null);
  const backHolder = useRef<THREE.Group>(null);
  const spineHolder = useRef<THREE.Group>(null);
  const closedBlock = useRef<THREE.Group>(null);
  const pageSet = useMemo(() => new THREE.Group(), []);
  const view = useRef<RigView | null>(null);
  const cached = useRef<{ state: RigState; s: number; speed: number; dir: number; cfg: typeof rigCfg; source: PdfBookSource; aspect: number; distance: number; fov: number } | null>(null);
  const rigCfg = useMemo(() => toRigCfg(c), [c]);
  const N = useMemo(() => source ? leavesFor(source.pageCount) : 0, [source]);
  const { controls } = useThree();
  const press = useRef<{ x: number; side: 1 | -1; started: boolean; moved: boolean; id: number } | null>(null);
  const pendingClicks = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const edges = (pageMaterials[rounded ? 1 : 0] ?? pageSideMaterial).clone();
    // Rig outlines have no UVs: preserve the closed block's edge colour/finish.
    edges.map = null;
    edges.bumpMap = null;
    const renderer = new RigView(pageSet, source, c.pageColor, boardMaterial, edges);
    view.current = renderer;
    cached.current = null;
    return () => {
      renderer.dispose();
      edges.dispose();
      if (view.current === renderer) view.current = null;
    };
  }, [pageSet, source, c.pageColor, boardMaterial, pageMaterials, pageSideMaterial, rounded]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.id || !reading) return;
      const dx = e.clientX - p.x;
      if (Math.abs(dx) > 7) p.moved = true;
      const now = performance.now() / 1000;
      if (!p.started && Math.abs(dx) > 7 && Math.sign(dx) === -p.side) {
        p.started = true;
        dragStart(reading.flip.current, p.side, now);
      }
      if (p.started) dragMove(reading.flip.current, (-dx * p.side) / (window.innerWidth * 0.32), now);
    };
    const release = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.id) return;
      press.current = null;
      onPress?.(false);
      if (controls && "enabled" in controls) controls.enabled = true;
      if (!reading || editable) return;
      if (p.started) dragEnd(reading.flip.current);
      else if (!p.moved && e.type !== "pointercancel") {
        // Defer a click just long enough to distinguish the existing double tap.
        const timer = setTimeout(() => {
          pendingClicks.current.delete(timer);
          click(reading.flip.current, p.side);
        }, 240);
        pendingClicks.current.add(timer);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      pendingClicks.current.forEach(clearTimeout);
      pendingClicks.current.clear();
      press.current = null;
      onPress?.(false);
    };
  }, [reading.flip, editable, source, controls, onPress]);

  const grab = (e: ThreeEvent<PointerEvent>) => {
    if (editable || !source || !reading || press.current) return;
    let object: THREE.Object3D | null = e.object;
    let side: 1 | -1 | 0 = 0;
    const f = reading.flip.current;
    while (object && object !== rig.current) {
      side = sideFor(object.name, f.s, N, f.dirHint);
      if (side) break;
      object = object.parent;
    }
    if (!side) return;
    e.stopPropagation();
    press.current = { x: e.nativeEvent.clientX, side, started: false, moved: false, id: e.nativeEvent.pointerId };
    if (controls && "enabled" in controls) controls.enabled = false;
    onPress?.(true);
  };

  useFrame((state, dt) => {
    if (!group.current || !rig.current) return;
    if (autoRotate) group.current.rotation.y += dt * 0.16;
    group.current.position.y = Math.sin(state.clock.elapsedTime * 0.6) * 0.035;
    reading?.step(dt);
    const f = reading?.flip.current;
    const active = !!source && !!f && f.s > -1 + 1e-3;
    pageSet.visible = active;
    if (closedBlock.current) closedBlock.current.visible = !active;
    if (!active || !source || !f) {
      rig.current.matrix.identity();
      frontHolder.current?.matrix.identity();
      backHolder.current?.matrix.identity();
      spineHolder.current?.matrix.identity();
      cached.current = null;
      return;
    }
    const speed = Math.round(Math.abs(f.v) * 10000) / 10000;
    let prev = cached.current;
    if (!prev || prev.cfg !== rigCfg || prev.source !== source || Math.abs(prev.s - f.s) > 1e-4 || prev.dir !== f.dirHint || Math.abs(prev.speed - speed) > 1e-4) {
      const next = rigAt(rigCfg, f.s, { leaves: N, flipDir: f.dirHint, flipSpeed: speed });
      for (const part of next.parts) {
        const holder = part.name === "frontBoard" ? frontHolder.current : part.name === "backBoard" ? backHolder.current : part.name === "spineBridge" ? spineHolder.current : null;
        if (holder) setMatrix(holder.matrix, part.local);
      }
      view.current?.update(next.parts);
      prev = { state: next, s: f.s, speed, dir: f.dirHint, cfg: rigCfg, source, aspect: -1, distance: -1, fov: -1 };
      cached.current = prev;
    }
    const aspect = state.size.width / state.size.height;
    const distance = state.camera.position.length();
    const fov = state.camera instanceof THREE.PerspectiveCamera ? state.camera.fov : 30;
    if (prev.aspect !== aspect || Math.abs(prev.distance - distance) > 1e-4 || prev.fov !== fov) {
      setMatrix(rig.current.matrix, prev.state.frame(aspect, fov, distance, 0).matrix);
      prev.aspect = aspect;
      prev.distance = distance;
      prev.fov = fov;
    }
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

  /** Clicking the case opens or closes an imported book. */
  const toggle = (e: { stopPropagation: () => void }) => {
    if (!source) return;
    if (editable) return;
    e.stopPropagation();
    pendingClicks.current.forEach(clearTimeout);
    pendingClicks.current.clear();
    onActivate?.();
  };

  return (
    <group ref={group}>
      <group ref={rig} name="rig" matrixAutoUpdate={false} onPointerDown={grab} onDoubleClick={toggle}>
        <group ref={frontHolder} name="frontBoard" matrixAutoUpdate={false}>
              <mesh
                name="frontBoard"
                geometry={boardGeo}
                material={boardMaterial}
                castShadow
                receiveShadow
              />
              {/* front cover artwork — stops short of the joint groove */}
              {frontTex && (
                <mesh position={[m.panelCX, 0, m.T / 2 + 0.004]}>
                  <planeGeometry args={[m.panelW, m.panelH]} />
                  <meshStandardMaterial map={frontTex} {...artProps} />
                </mesh>
              )}
              {/* quill = edit button, front cover, near the fore-edge corner */}
              {editable && <mesh
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
              </mesh>}
        </group>

        <group ref={backHolder} name="backBoard" matrixAutoUpdate={false}>
        {/* back board — same plate, flipped, so its joint groove matches the front */}
        <mesh
          name="backBoard"
          geometry={boardGeo}
          material={boardMaterial}
          rotation={[Math.PI, 0, 0]}
          castShadow
          receiveShadow
        />
      {/* back cover artwork */}
      {backTex && (
        <mesh position={[m.panelCX, 0, -m.T / 2 - 0.004]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[m.panelW, m.panelH]} />
          <meshStandardMaterial map={backTex} {...artProps} />
        </mesh>
      )}

      {/* quill = edit button, back cover, mirrored to its own fore-edge corner */}
      {editable && <mesh
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
      </mesh>}

      </group>
      <group ref={spineHolder} name="spineBridge" matrixAutoUpdate={false}>
        {/* spine / edge bridge */}
        <mesh
          name="spine"
          geometry={spineGeo}
          material={spineMaterial}
          castShadow
          receiveShadow
        />

      {/* spine artwork */}
      {spineTex && (
        <mesh position={[m.spineSurf, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[m.T * 0.86, m.ph]} />
          <meshStandardMaterial map={spineTex} {...artProps} />
        </mesh>
      )}


      {/* quill = edit button, spine foot */}
      {editable && <mesh
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
      </mesh>}
      </group>
      </group>
        {/* text block, inset by the page margins */}
        <group position={[m.pageCX, m.pageCY, 0]} ref={closedBlock}>
          <mesh name="closedBlock" geometry={pageGeo} material={pageMaterials} castShadow receiveShadow />
        </group>

        <primitive object={pageSet} />

    </group>
  );
}
