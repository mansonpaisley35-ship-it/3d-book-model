/*
 * The open text block: two bendable page halves plus the leaf that is turning.
 *
 * Each part is a SkinnedMesh whose box geometry is bound to a chain of bones
 * running from the spine to the fore-edge, so a half can cup and a turning leaf
 * can curl, exactly the technique used by the reference book engine.
 *
 * Local space: the origin sits on the spine hinge, +x runs to the fore-edge,
 * +y is the head, +z is towards the front cover.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { BookMotion, TurnDir } from "./book-state";
import type { PdfBookSource } from "./pdf-source";

const SEGMENTS = 16;

/** Box geometry skinned to a bone chain that runs along +x. */
function buildSkinned(w: number, h: number, t: number) {
  const geo = new THREE.BoxGeometry(w, h, t, SEGMENTS, 1, 1);
  const segW = w / SEGMENTS;
  const pos = geo.attributes["position"] as THREE.BufferAttribute;
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + w / 2;
    const idx = Math.min(SEGMENTS - 1, Math.max(0, Math.floor(x / segW)));
    const wgt = Math.min(1, Math.max(0, (x - idx * segW) / segW));
    skinIndices.push(idx, idx + 1, 0, 0);
    skinWeights.push(1 - wgt, wgt, 0, 0);
  }
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));

  const bones: THREE.Bone[] = [];
  let prev = new THREE.Bone();
  prev.position.x = -w / 2;
  bones.push(prev);
  for (let i = 0; i < SEGMENTS; i++) {
    const bone = new THREE.Bone();
    bone.position.x = segW;
    prev.add(bone);
    bones.push(bone);
    prev = bone;
  }
  return { geo, bones, skeleton: new THREE.Skeleton(bones) };
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1e-6)));
  return t * t * (3 - 2 * t);
};

type LeafUpdate = (parts: { group: THREE.Group; bones: THREE.Bone[]; dt: number }) => void;

/** One bendable part, hinged at the spine. */
function FlexLeaf({
  name,
  w,
  h,
  t,
  materials,
  update,
  onPointerDown,
  onClick,
}: {
  name: string;
  w: number;
  h: number;
  t: number;
  materials: THREE.Material[];
  update: LeafUpdate;
  onPointerDown?: (e: { nativeEvent: PointerEvent; stopPropagation: () => void }) => void;
  onClick?: (e: { stopPropagation: () => void }) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const built = useMemo(() => buildSkinned(w, h, t), [w, h, t]);
  useEffect(() => {
    const { geo, skeleton } = built;
    return () => {
      geo.dispose();
      skeleton.dispose();
    };
  }, [built]);

  useFrame((_, dt) => {
    if (group.current) update({ group: group.current, bones: built.bones, dt });
  });

  return (
    <group ref={group}>
      {/* the mesh starts at the hinge and reaches out to the fore-edge */}
      <group position={[w / 2, 0, 0]}>
        <primitive object={built.bones[0]!} />
        <skinnedMesh
          name={name}
          geometry={built.geo}
          material={materials}
          skeleton={built.skeleton}
          castShadow
          receiveShadow
          onPointerDown={onPointerDown as never}
          onClick={onClick as never}
        />
      </group>
    </group>
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
  /** half the closed case thickness — the plane the covers fold about */
  caseHalf: number;
  /** board thickness, so a stack can rest on top of its cover */
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
  // bumped whenever a page finishes rendering, so its texture gets picked up
  const [rev, bump] = useState(0);
  const ready = () => bump((v) => v + 1);

  const page = (index: number) => source.getTexture(index, ready);

  const paper = useMemo(
    () => new THREE.MeshStandardMaterial({ color: paperColor, roughness: 0.95, metalness: 0 }),
    [paperColor],
  );
  useEffect(() => () => paper.dispose(), [paper]);

  /** Six box materials with a page on the +z and/or -z face. */
  const faces = (front: THREE.Texture | null, back: THREE.Texture | null) => {
    const face = (map: THREE.Texture | null) =>
      map
        ? new THREE.MeshStandardMaterial({ map, roughness: 0.94, metalness: 0 })
        : (paper as THREE.Material);
    return [paper, paper, paper, paper, face(front), face(back)];
  };

  const k = spread;
  const leftVisible = turnDir === -1 ? Math.max(1, 2 * k - 1) : 2 * k + 1;
  const rightVisible = turnDir === 1 ? 2 * k + 4 : 2 * k + 2;

  const leftMats = useMemo(
    () => faces(null, page(leftVisible)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leftVisible, paper, source, rev],
  );
  const rightMats = useMemo(
    () => faces(page(rightVisible), null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rightVisible, paper, source, rev],
  );
  const turnMats = useMemo(
    () =>
      turnDir === 1
        ? faces(page(2 * k + 2), page(2 * k + 3))
        : faces(page(2 * k), page(2 * k + 1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [turnDir, k, paper, source, rev],
  );

  // how much of the block sits on the left, from the spread we are showing
  const f = spreadCount > 0 ? (k + 1) / (spreadCount + 1) : 0.5;
  const minT = Math.max(0.004, thickness * 0.01);
  const leftT = Math.max(minT, thickness * f);
  const rightT = Math.max(minT, thickness * (1 - f));
  const leafT = minT;

  /** Gentle cup of a resting half, plus the curl of a leaf mid-turn. */
  const bend = (bones: THREE.Bone[], sign: number, open: number, curl: number) => {
    for (let i = 0; i < bones.length; i++) {
      const rise = smoothstep(6, 0, i); // strongest just off the spine
      const curlAmount = smoothstep(14, 2, Math.abs(i - 9));
      const bone = bones[i]!;
      bone.rotation.y = (sign * 0.05 * rise + curl * 0.09 * curlAmount) * open;
    }
  };

  /*
   * The swing and the lift live on the ROOT BONE, never on the group: a skinned
   * mesh keeps the world matrix it was bound with, so transforming a parent of
   * both mesh and skeleton applies the move twice and shears the skin. The root
   * bone sits exactly on the spine hinge, so rotating it hinges the whole half.
   */
  const half = (side: -1 | 1) => (parts: {
    group: THREE.Group;
    bones: THREE.Bone[];
    dt: number;
  }) => {
    const { open } = motion.current;
    bend(parts.bones, side, open, 0);
    const halfT = side < 0 ? leftT : rightT;
    const root = parts.bones[0]!;
    /* Each stack ends up resting on the inner face of its own cover: the front
     * board folds about z = caseHalf, so once open it lies just above it. */
    const rest =
      side < 0 ? caseHalf + board + halfT / 2 : -caseHalf + board + halfT / 2;
    root.position.z = rest * open;
    root.rotation.y += side < 0 ? -Math.PI * open : 0;
  };

  const turning = (parts: { group: THREE.Group; bones: THREE.Bone[]; dt: number }) => {
    const { open, turn } = motion.current;
    const tau = turnDir === 1 ? turn : 1 - turn;
    // the leaf bows most when it stands upright half way through the sweep
    const curl = Math.sin(Math.PI * turn) * (turnDir ?? 1);
    bend(parts.bones, 0, open, curl);
    const root = parts.bones[0]!;
    root.position.z = 0;
    root.rotation.y += -Math.PI * tau * open;
  };



  /* ---------------- hand-turning a page by dragging its edge --------------- */
  const drag = useRef<{ dir: TurnDir; x0: number; moved: boolean } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x0;
      if (Math.abs(dx) > 5) d.moved = true;
      const span = 260;
      setDrag(d.dir === 1 ? -dx / span : dx / span);
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (!d.moved) setDrag(1); // a tap turns the page outright
      releaseDrag();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [setDrag, releaseDrag]);

  const grab = (dir: TurnDir) => (e: { nativeEvent: PointerEvent; stopPropagation: () => void }) => {
    // only grab a leaf once the book is actually open, otherwise the very
    // click that opens the book would be spent turning a page
    if (motion.current.open < 0.6) return;
    e.stopPropagation();
    if (!onTurn(dir, true)) return;
    drag.current = { dir, x0: e.nativeEvent.clientX, moved: false };
  };

  return (
    <group>
      {/* left half — swings over onto the front cover */}
      <FlexLeaf
        name="leftHalf"
        w={width}
        h={height}
        t={leftT}
        materials={leftMats}
        update={half(-1)}
        onPointerDown={grab(-1)}
      />

      {/* right half — stays on the back cover */}
      <FlexLeaf
        name="rightHalf"
        w={width}
        h={height}
        t={rightT}
        materials={rightMats}
        update={half(1)}
        onPointerDown={grab(1)}
      />

      {/* the leaf in flight */}
      {turnDir && (
        <FlexLeaf name="turnLeaf" w={width} h={height} t={leafT} materials={turnMats} update={turning} />
      )}

    </group>
  );
}
