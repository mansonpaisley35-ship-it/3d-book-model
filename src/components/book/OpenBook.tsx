import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BookMotion, TurnDir } from "./book-state";
import type { PdfBookSource } from "./pdf-source";

const LEAF_SEGMENTS = 24;

function pageShape(width: number, height: number, radius: number) {
  const r = Math.min(radius, width * 0.08, height * 0.08);
  const shape = new THREE.Shape();
  shape.moveTo(0, -height / 2);
  shape.lineTo(width - r, -height / 2);
  shape.quadraticCurveTo(width, -height / 2, width, -height / 2 + r);
  shape.lineTo(width, height / 2 - r);
  shape.quadraticCurveTo(width, height / 2, width - r, height / 2);
  shape.lineTo(0, height / 2);
  shape.closePath();
  return shape;
}

function buildPageStack(width: number, height: number, thickness: number) {
  const geometry = new THREE.ExtrudeGeometry(pageShape(width, height, 0.035), {
    depth: thickness,
    curveSegments: 8,
    bevelEnabled: true,
    bevelSize: Math.min(0.012, thickness * 0.12),
    bevelThickness: Math.min(0.008, thickness * 0.1),
    bevelSegments: 2,
  });
  geometry.translate(0, 0, -thickness / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function buildPageFace(width: number, height: number) {
  const geometry = new THREE.ShapeGeometry(pageShape(width, height, 0.035), 8);
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < position.count; i += 1) {
    uv.setXY(i, position.getX(i) / width, position.getY(i) / height + 0.5);
  }
  uv.needsUpdate = true;
  return geometry;
}

function buildTurningLeaf(width: number, height: number, thickness: number) {
  const geometry = new THREE.BoxGeometry(width, height, thickness, LEAF_SEGMENTS, 1, 1);
  geometry.translate(width / 2, 0, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function PageStack({
  name,
  side,
  width,
  height,
  thickness,
  z,
  texture,
  paperColor,
  onPointerDown,
}: {
  name: string;
  side: -1 | 1;
  width: number;
  height: number;
  thickness: number;
  z: number;
  texture: THREE.Texture | null;
  paperColor: string;
  onPointerDown: (e: { nativeEvent: PointerEvent; stopPropagation: () => void }) => void;
}) {
  const stackGeometry = useMemo(() => buildPageStack(width, height, thickness), [width, height, thickness]);
  const faceGeometry = useMemo(() => buildPageFace(width, height), [width, height]);
  const displayTexture = useMemo(() => {
    if (!texture || side > 0) return texture;
    const clone = texture.clone();
    clone.wrapS = THREE.RepeatWrapping;
    clone.repeat.x = -1;
    clone.offset.x = 1;
    clone.needsUpdate = true;
    return clone;
  }, [texture, side]);
  const edgeMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: paperColor, roughness: 0.98, metalness: 0 }),
    [paperColor],
  );
  const faceMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: paperColor,
        map: displayTexture,
        roughness: 0.94,
        metalness: 0,
        side: side < 0 ? THREE.BackSide : THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    [paperColor, displayTexture],
  );

  useEffect(
    () => () => {
      stackGeometry.dispose();
      faceGeometry.dispose();
      if (displayTexture && displayTexture !== texture) displayTexture.dispose();
      edgeMaterial.dispose();
      faceMaterial.dispose();
    }, [stackGeometry, faceGeometry, displayTexture, texture, edgeMaterial, faceMaterial],
  );

  return (
    <group position={[0, 0, z]} rotation-y={side < 0 ? Math.PI : 0}>
      <mesh name={name} geometry={stackGeometry} material={edgeMaterial} castShadow receiveShadow />
      <mesh
        name={`${name}Page`}
        geometry={faceGeometry}
        material={faceMaterial}
        position-z={side < 0 ? -thickness / 2 - 0.002 : thickness / 2 + 0.002}
        onPointerDown={onPointerDown as never}
        castShadow
        receiveShadow
      />
    </group>
  );
}

function TurningPage({
  width,
  height,
  thickness,
  z,
  motion,
  direction,
  materials,
}: {
  width: number;
  height: number;
  thickness: number;
  z: number;
  motion: React.MutableRefObject<BookMotion>;
  direction: TurnDir;
  materials: THREE.Material[];
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => buildTurningLeaf(width, height, thickness), [width, height, thickness]);
  const base = useMemo(() => {
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    return new Float32Array(position.array);
  }, [geometry]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    const current = mesh.current;
    if (!current) return;
    const progress = motion.current.turn;
    const p = direction > 0 ? progress : 1 - progress;
    current.rotation.y = -Math.PI * p;
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const curl = Math.sin(Math.PI * progress) * width * 0.075 * direction;
    for (let i = 0; i < position.count; i += 1) {
      const x = base[i * 3] ?? 0;
      const y = base[i * 3 + 1] ?? 0;
      const originalZ = base[i * 3 + 2] ?? 0;
      const u = Math.min(1, Math.max(0, x / width));
      position.setXYZ(i, x, y, originalZ + Math.sin(Math.PI * u) * curl);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  });

  return (
    <mesh
      ref={mesh}
      name="turningPage"
      geometry={geometry}
      material={materials}
      position-z={z}
      castShadow
      receiveShadow
    />
  );
}

export function OpenBook({
  width,
  height,
  thickness,
  caseHalf,
  board,
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
  caseHalf: number;
  board: number;
  source: PdfBookSource;
  motion: React.MutableRefObject<BookMotion>;
  spread: number;
  spreadCount: number;
  turnDir: TurnDir | null;
  paperColor: string;
  onTurn: (dir: TurnDir, drag?: boolean) => boolean;
  setDrag: (progress: number) => void;
  releaseDrag: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const ready = () => setRevision((value) => value + 1);
  const page = (index: number) => source.getTexture(index, ready);
  const k = spread;
  const leftPage = turnDir === -1 ? Math.max(1, 2 * k - 1) : 2 * k + 1;
  const rightPage = turnDir === 1 ? 2 * k + 4 : 2 * k + 2;
  const fraction = spreadCount > 0 ? (k + 1) / (spreadCount + 1) : 0.5;
  const minThickness = Math.max(0.012, thickness * 0.018);
  const leftThickness = Math.max(minThickness, thickness * fraction);
  const rightThickness = Math.max(minThickness, thickness * (1 - fraction));
  const leafThickness = Math.max(0.004, thickness * 0.006);
  const leftBase = caseHalf + board;
  const rightBase = -caseHalf + board;
  const leftZ = leftBase + leftThickness / 2;
  const rightZ = rightBase + rightThickness / 2;
  const turnZ = turnDir === 1 ? rightBase + rightThickness + leafThickness : leftBase + leftThickness + leafThickness;

  const turnMaterials = useMemo(() => {
    const frontIndex = turnDir === 1 ? 2 * k + 2 : 2 * k;
    const backIndex = turnDir === 1 ? 2 * k + 3 : 2 * k + 1;
    const edge = new THREE.MeshStandardMaterial({ color: paperColor, roughness: 0.98 });
    const front = new THREE.MeshStandardMaterial({ color: paperColor, map: page(frontIndex), roughness: 0.94 });
    const back = new THREE.MeshStandardMaterial({ color: paperColor, map: page(backIndex), roughness: 0.94 });
    return [edge, edge, edge, edge, front, back];
    // revision intentionally refreshes the materials when a PDF page finishes rendering
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnDir, k, source, paperColor, revision]);

  useEffect(
    () => () => {
      new Set(turnMaterials).forEach((material) => material.dispose());
    },
    [turnMaterials],
  );

  const drag = useRef<{ dir: TurnDir; x0: number; moved: boolean } | null>(null);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = drag.current;
      if (!active) return;
      const dx = event.clientX - active.x0;
      if (Math.abs(dx) > 5) active.moved = true;
      setDrag(active.dir === 1 ? -dx / 260 : dx / 260);
    };
    const up = () => {
      const active = drag.current;
      drag.current = null;
      if (!active) return;
      if (!active.moved) setDrag(1);
      releaseDrag();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [setDrag, releaseDrag]);

  const grab = (dir: TurnDir) => (event: { nativeEvent: PointerEvent; stopPropagation: () => void }) => {
    event.stopPropagation();
    if (motion.current.open < 0.85 || !onTurn(dir, true)) return;
    drag.current = { dir, x0: event.nativeEvent.clientX, moved: false };
  };

  return (
    <group>
      <PageStack
        name="leftPageBlock"
        side={-1}
        width={width}
        height={height}
        thickness={leftThickness}
        z={leftZ}
        texture={page(leftPage)}
        paperColor={paperColor}
        onPointerDown={grab(-1)}
      />
      <PageStack
        name="rightPageBlock"
        side={1}
        width={width}
        height={height}
        thickness={rightThickness}
        z={rightZ}
        texture={page(rightPage)}
        paperColor={paperColor}
        onPointerDown={grab(1)}
      />
      {turnDir && (
        <TurningPage
          width={width}
          height={height}
          thickness={leafThickness}
          z={turnZ}
          motion={motion}
          direction={turnDir}
          materials={turnMaterials}
        />
      )}
    </group>
  );
}