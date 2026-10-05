import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { BookMotion, TurnDir } from "./book-state";
import type { PdfBookSource } from "./pdf-source";
import {
  PAGE_SEGMENTS,
  clamp01,
  leafCurve,
  restingCurve,
  smoothstep,
  type Point2,
} from "./page-rig-math";

const HEIGHT_ROWS = 8;
const FACE_OFFSET = 0.0015;

function buildPrism(bottomZ: number, height: number, pageHeight: number, points: readonly Point2[]) {
  const top = points;
  const bottom = points.map((point) => ({ x: point.x, z: bottomZ }));
  const polygon = [...bottom, ...top.slice().reverse()];
  const positions: number[] = [];
  const indices: number[] = [];
  const halfHeight = pageHeight / 2;

  for (const y of [-halfHeight, halfHeight]) {
    for (const point of polygon) positions.push(point.x, y, point.z);
  }
  const ring = polygon.length;
  for (let i = 0; i < ring; i += 1) {
    const next = (i + 1) % ring;
    indices.push(i, next, ring + i, next, ring + next, ring + i);
  }
  for (let i = 1; i < ring - 1; i += 1) {
    indices.push(0, ring + i, i, ring, ring + i + 1, ring + i);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.height = height;
  return geometry;
}

function surfaceNormal(points: readonly Point2[], index: number) {
  const before = points[Math.max(0, index - 1)] ?? points[0] ?? { x: 0, z: 0 };
  const after = points[Math.min(points.length - 1, index + 1)] ?? before;
  const dx = after.x - before.x;
  const dz = after.z - before.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: -dz / length, z: dx / length };
}

function buildRibbon(points: readonly Point2[], height: number, mirrored: boolean, offset: number) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= HEIGHT_ROWS; row += 1) {
    const v = row / HEIGHT_ROWS;
    const y = (v - 0.5) * height;
    for (let j = 0; j < points.length; j += 1) {
      const point = points[j] ?? { x: 0, z: 0 };
      const normal = surfaceNormal(points, j);
      positions.push(point.x + normal.x * offset, y, point.z + normal.z * offset);
      uvs.push(mirrored ? 1 - j / (points.length - 1) : j / (points.length - 1), v);
    }
  }
  const columns = points.length;
  for (let row = 0; row < HEIGHT_ROWS; row += 1) {
    for (let j = 0; j < columns - 1; j += 1) {
      const a = row * columns + j;
      const b = a + columns;
      if (mirrored) indices.push(a, a + 1, b, a + 1, b + 1, b);
      else indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function writeRibbon(
  geometry: THREE.BufferGeometry,
  points: readonly Point2[],
  height: number,
  offset: number,
  twist: number,
) {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let row = 0; row <= HEIGHT_ROWS; row += 1) {
    const v = row / HEIGHT_ROWS;
    const y = (v - 0.5) * height;
    for (let j = 0; j < points.length; j += 1) {
      const point = points[j] ?? { x: 0, z: 0 };
      const normal = surfaceNormal(points, j);
      const u = j / (points.length - 1);
      const corner = twist * (v - 0.5) * u * u;
      position.setXYZ(
        row * points.length + j,
        point.x + normal.x * offset,
        y,
        point.z + normal.z * offset + corner,
      );
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

type StackProps = {
  name: string;
  points: Point2[];
  baseZ: number;
  thickness: number;
  height: number;
  texture: THREE.Texture | null;
  mirrored: boolean;
  paperColor: string;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
};

function PageStack({
  name,
  points,
  baseZ,
  thickness,
  height,
  texture,
  mirrored,
  paperColor,
  onPointerDown,
}: StackProps) {
  const prism = useMemo(
    () => buildPrism(baseZ, thickness, height, points),
    [baseZ, thickness, height, points],
  );
  const face = useMemo(() => buildRibbon(points, height, mirrored, FACE_OFFSET), [points, height, mirrored]);
  const edgeMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: paperColor, roughness: 0.98, metalness: 0 }),
    [paperColor],
  );
  const faceMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: paperColor,
        map: texture,
        roughness: 0.94,
        metalness: 0,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    [paperColor, texture],
  );

  useEffect(
    () => () => {
      prism.dispose();
      face.dispose();
      edgeMaterial.dispose();
      faceMaterial.dispose();
    },
    [prism, face, edgeMaterial, faceMaterial],
  );

  return (
    <group visible={thickness > 0.0001}>
      <mesh name={name} geometry={prism} material={edgeMaterial} castShadow receiveShadow onPointerDown={onPointerDown} />
      <mesh
        name={`${name}Page`}
        geometry={face}
        material={faceMaterial}
        castShadow
        receiveShadow
        onPointerDown={onPointerDown}
      />
    </group>
  );
}

function TurningLeaf({
  width,
  height,
  baseZ,
  leftBefore,
  rightBefore,
  leftAfter,
  rightAfter,
  motion,
  direction,
  frontTexture,
  backTexture,
  paperColor,
  onPointerDown,
}: {
  width: number;
  height: number;
  baseZ: number;
  leftBefore: number;
  rightBefore: number;
  leftAfter: number;
  rightAfter: number;
  motion: React.MutableRefObject<BookMotion>;
  direction: TurnDir;
  frontTexture: THREE.Texture | null;
  backTexture: THREE.Texture | null;
  paperColor: string;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const startLeft = useMemo(() => restingCurve(0, baseZ, width, leftBefore, 1, -1).points, [baseZ, width, leftBefore]);
  const startRight = useMemo(() => restingCurve(0, baseZ, width, rightBefore, 1, 1).points, [baseZ, width, rightBefore]);
  const endLeft = useMemo(() => restingCurve(0, baseZ, width, leftAfter, 1, -1).points, [baseZ, width, leftAfter]);
  const endRight = useMemo(() => restingCurve(0, baseZ, width, rightAfter, 1, 1).points, [baseZ, width, rightAfter]);
  const source = direction > 0 ? startRight : startLeft;
  const initial = useMemo(() => source.map((point) => ({ ...point })), [source]);
  const frontGeometry = useMemo(() => buildRibbon(initial, height, false, 0.0006), [initial, height]);
  const backGeometry = useMemo(() => buildRibbon(initial, height, true, -0.0006), [initial, height]);
  const frontMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: paperColor, map: frontTexture, roughness: 0.94, side: THREE.FrontSide }),
    [paperColor, frontTexture],
  );
  const backMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: paperColor, map: backTexture, roughness: 0.94, side: THREE.BackSide }),
    [paperColor, backTexture],
  );

  useEffect(
    () => () => {
      frontGeometry.dispose();
      backGeometry.dispose();
      frontMaterial.dispose();
      backMaterial.dispose();
    },
    [frontGeometry, backGeometry, frontMaterial, backMaterial],
  );

  useFrame(() => {
    const t = clamp01(motion.current.turn);
    const speedNorm = clamp01(Math.abs(motion.current.turnVelocity) / 2.4);
    const lag = 0.18 + 0.42 * speedNorm;
    const right = direction > 0 ? startRight : endRight;
    const left = direction > 0 ? endLeft : startLeft;
    const points = leafCurve(right, left, t, lag, direction);
    const twist = 0.16 * Math.sin(Math.PI * t) * (0.4 + 0.6 * speedNorm) * direction;
    writeRibbon(frontGeometry, points, height, 0.0006, twist);
    writeRibbon(backGeometry, points, height, -0.0006, twist);
  });

  return (
    <group>
      <mesh geometry={frontGeometry} material={frontMaterial} frustumCulled={false} castShadow receiveShadow onPointerDown={onPointerDown} />
      <mesh geometry={backGeometry} material={backMaterial} frustumCulled={false} castShadow receiveShadow onPointerDown={onPointerDown} />
    </group>
  );
}

export function OpenBook({
  width,
  height,
  thickness,
  source,
  motion,
  spread,
  spreadCount,
  turnDir,
  paperColor,
  onTurn,
  setDrag,
  releaseDrag,
}: {
  width: number;
  height: number;
  thickness: number;
  source: PdfBookSource;
  motion: React.MutableRefObject<BookMotion>;
  spread: number;
  spreadCount: number;
  turnDir: TurnDir | null;
  paperColor: string;
  onTurn: (dir: TurnDir, drag?: boolean) => boolean;
  setDrag: (progress: number, velocity?: number) => void;
  releaseDrag: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [, setFrameRevision] = useState(0);
  const ready = useCallback(() => setRevision((value) => value + 1), []);
  const page = (index: number) => source.getTexture(index, ready);
  const totalLeaves = Math.max(1, spreadCount - 1);
  const progress = turnDir ? smoothstep(motion.current.turn) : 0;
  const transfer = turnDir ? turnDir * progress : 0;
  const leafThickness = thickness / totalLeaves;
  const leftLeaves = Math.max(0.3, spread + transfer);
  const rightLeaves = Math.max(0.3, totalLeaves - spread - transfer);
  const leftThickness = Math.min(thickness, leftLeaves * leafThickness);
  const rightThickness = Math.min(thickness, rightLeaves * leafThickness);
  const baseZ = -thickness / 2;
  const quantizedOpen = Math.round(motion.current.open * 80) / 80;
  const leftCurve = useMemo(
    () => restingCurve(0, baseZ, width, leftThickness, quantizedOpen, -1).points,
    [baseZ, width, leftThickness, quantizedOpen],
  );
  const rightCurve = useMemo(
    () => restingCurve(0, baseZ, width, rightThickness, quantizedOpen, 1).points,
    [baseZ, width, rightThickness, quantizedOpen],
  );

  useFrame(() => {
    const next = Math.round(motion.current.open * 80) / 80;
    if (Math.abs(next - quantizedOpen) > 1e-6 || turnDir) setFrameRevision((value) => value + 1);
  });

  const drag = useRef<{
    dir: TurnDir;
    x0: number;
    lastX: number;
    lastTime: number;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    const finish = (cancelled: boolean) => {
      const active = drag.current;
      drag.current = null;
      if (!active) return;
      if (!active.moved && !cancelled) setDrag(1, 0);
      releaseDrag();
    };
    const move = (event: PointerEvent) => {
      const active = drag.current;
      if (!active) return;
      const dx = event.clientX - active.x0;
      if (Math.abs(dx) > 7) active.moved = true;
      const now = event.timeStamp;
      const dt = Math.max(1, now - active.lastTime) / 1000;
      const signedDelta = active.dir > 0 ? -(event.clientX - active.lastX) : event.clientX - active.lastX;
      const span = Math.max(160, window.innerWidth * 0.32);
      setDrag((active.dir > 0 ? -dx : dx) / span, signedDelta / span / dt);
      active.lastX = event.clientX;
      active.lastTime = now;
    };
    const up = () => finish(false);
    const cancel = () => finish(true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [releaseDrag, setDrag]);

  const grab =
    (direction: TurnDir) => (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      if (motion.current.open < 0.985 || !onTurn(direction, true)) return;
      drag.current = {
        dir: direction,
        x0: event.nativeEvent.clientX,
        lastX: event.nativeEvent.clientX,
        lastTime: event.nativeEvent.timeStamp,
        moved: false,
      };
    };

  const leftPage = 2 * spread;
  const rightPage = 2 * spread + 1;
  const frontIndex = turnDir === 1 ? rightPage : leftPage;
  const backIndex = turnDir === 1 ? rightPage + 1 : leftPage - 1;

  return (
    <group>
      <PageStack
        name="leftPageBlock"
        points={leftCurve}
        baseZ={baseZ}
        thickness={leftThickness}
        height={height}
        texture={page(leftPage)}
        mirrored
        paperColor={paperColor}
        onPointerDown={grab(-1)}
      />
      <PageStack
        name="rightPageBlock"
        points={rightCurve}
        baseZ={baseZ}
        thickness={rightThickness}
        height={height}
        texture={page(rightPage)}
        mirrored={false}
        paperColor={paperColor}
        onPointerDown={grab(1)}
      />
      {turnDir && (
        <TurningLeaf
          width={width}
          height={height}
          baseZ={baseZ}
          leftBefore={Math.max(0.3, spread) * leafThickness}
          rightBefore={Math.max(0.3, totalLeaves - spread) * leafThickness}
          leftAfter={Math.max(0.3, spread + turnDir) * leafThickness}
          rightAfter={Math.max(0.3, totalLeaves - spread - turnDir) * leafThickness}
          motion={motion}
          direction={turnDir}
          frontTexture={page(frontIndex)}
          backTexture={page(backIndex)}
          paperColor={paperColor}
          onPointerDown={grab(turnDir)}
        />
      )}
    </group>
  );
}