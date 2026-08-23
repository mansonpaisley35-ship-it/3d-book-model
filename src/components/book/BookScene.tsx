import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Suspense, useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { Book, type BookImages } from "./Book";

const VIEWS = {
  cover: new THREE.Vector3(4.2, 1.9, 10.6),
  spine: new THREE.Vector3(-9.6, 1.6, 4.0),
  head: new THREE.Vector3(2.4, 9.4, 5.2),
  edge: new THREE.Vector3(10.4, 1.2, 1.6),
} as const;

export type ViewKey = keyof typeof VIEWS;

const SLOTS: { key: keyof BookImages; label: string; hint: string }[] = [
  { key: "front", label: "Front cover", hint: "Portrait artwork" },
  { key: "back", label: "Back cover", hint: "Portrait artwork" },
  { key: "spine", label: "Spine", hint: "Tall, narrow artwork" },
  { key: "edges", label: "Page edges", hint: "Wraps fore-edge, head & tail" },
];

function CameraRig({ view, active }: { view: ViewKey; active: boolean }) {
  const { camera } = useThree();
  const target = useRef(VIEWS.cover.clone());

  useEffect(() => {
    target.current.copy(VIEWS[view]);
  }, [view]);

  useFrame((_, dt) => {
    if (!active) return;
    camera.position.lerp(target.current, Math.min(1, dt * 2.4));
    camera.lookAt(0, 0, 0);
  });
  return null;
}

export default function BookScene() {
  const [free, setFree] = useState(false);
  const [view, setView] = useState<ViewKey>("cover");
  const [images, setImages] = useState<BookImages>({});
  const [editing, setEditing] = useState(false);

  const pick = (v: ViewKey) => {
    setView(v);
    setFree(false);
  };

  const setImage = (key: keyof BookImages, file?: File | null) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImages((prev) => {
      if (prev[key]) URL.revokeObjectURL(prev[key]!);
      return { ...prev, [key]: url };
    });
  };

  const clearImage = (key: keyof BookImages) => {
    setImages((prev) => {
      if (prev[key]) URL.revokeObjectURL(prev[key]!);
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [4.2, 1.9, 10.6], fov: 30 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        onPointerDown={() => setFree(true)}
      >
        <color attach="background" args={["#0e1319"]} />
        <fog attach="fog" args={["#0e1319", 16, 30]} />

        <Suspense fallback={null}>
          <group position={[0, 0.15, 0]} scale={0.76}>
            <Book autoRotate={false} images={images} onEdit={() => setEditing(true)} />
          </group>

          {/* soft studio setup: broad key from above-left, cool rim from behind */}
          <ambientLight intensity={0.32} />
          <directionalLight
            position={[5, 8, 6]}
            intensity={2.4}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0006}
          />
          <directionalLight position={[-6, 3, -5]} intensity={1.1} color="#7fa6d6" />
          <spotLight position={[0, 7, -6]} angle={0.6} penumbra={1} intensity={0.8} color="#cfe0f5" />

          {/* hand-built studio environment (no remote HDRI): large soft box lights */}
          <Environment resolution={256} environmentIntensity={0.6} frames={1}>
            <color attach="background" args={["#111820"]} />
            <Lightformer
              form="rect"
              intensity={4}
              position={[3, 5, 4]}
              scale={[8, 8, 1]}
              target={[0, 0, 0]}
              color="#ffffff"
            />
            <Lightformer
              form="rect"
              intensity={1.6}
              position={[-5, 2, -3]}
              scale={[6, 8, 1]}
              target={[0, 0, 0]}
              color="#8fb2e0"
            />
            <Lightformer
              form="ring"
              intensity={1.2}
              position={[0, -4, 3]}
              scale={5}
              target={[0, 0, 0]}
              color="#dfe8f2"
            />
          </Environment>

          <ContactShadows
            position={[0, -2.05, 0]}
            opacity={0.5}
            scale={10}
            blur={2.6}
            far={4}
            resolution={1024}
            color="#000000"
          />
        </Suspense>

        <CameraRig view={view} active={!free} />
        <OrbitControls
          enabled={free}
          enablePan={false}
          minDistance={5}
          maxDistance={18}
          minPolarAngle={0.15}
          maxPolarAngle={Math.PI / 1.9}
          enableDamping
          dampingFactor={0.06}
        />
      </Canvas>

      <div className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-1 rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-md">
        {(
          [
            ["cover", "Cover"],
            ["spine", "Spine"],
            ["head", "Head"],
            ["edge", "Fore-edge"],
          ] as [ViewKey, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => pick(key)}
            className={`rounded-full px-4 py-1.5 text-[11px] tracking-[0.14em] uppercase transition-colors ${
              view === key && !free
                ? "bg-[#e8eef5] text-[#101720]"
                : "text-[#9db0c6] hover:text-[#e8eef5]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        onClick={() => setEditing(true)}
        className="pointer-events-auto absolute top-6 right-6 flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] tracking-[0.16em] text-[#cfdcea] uppercase backdrop-blur-md transition-colors hover:bg-white/10"
      >
        <Pencil size={13} /> Edit
      </button>

      {editing && (
        <div className="pointer-events-auto absolute inset-y-0 right-0 z-20 w-full max-w-sm overflow-y-auto border-l border-white/10 bg-[#0e1319]/95 p-6 backdrop-blur-xl">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] tracking-[0.3em] text-[#7f93aa] uppercase">Artwork</p>
              <h2 className="mt-2 font-serif text-xl text-[#e8eef5]">Dress the book</h2>
            </div>
            <button
              onClick={() => setEditing(false)}
              aria-label="Close editor"
              className="rounded-full border border-white/10 p-2 text-[#9db0c6] hover:text-[#e8eef5]"
            >
              <X size={14} />
            </button>
          </div>

          <div className="mt-6 space-y-4">
            {SLOTS.map(({ key, label, hint }) => (
              <div key={key} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-[#e8eef5]">{label}</p>
                    <p className="mt-0.5 text-[11px] text-[#7f93aa]">{hint}</p>
                  </div>
                  {images[key] && (
                    <img
                      src={images[key]}
                      alt={`${label} preview`}
                      className="h-12 w-9 rounded object-cover"
                    />
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <label className="cursor-pointer rounded-full bg-[#e8eef5] px-3 py-1.5 text-[11px] tracking-[0.12em] text-[#101720] uppercase">
                    {images[key] ? "Replace" : "Upload"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => setImage(key, e.target.files?.[0])}
                    />
                  </label>
                  {images[key] && (
                    <button
                      onClick={() => clearImage(key)}
                      className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] tracking-[0.12em] text-[#9db0c6] uppercase hover:text-[#e8eef5]"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
