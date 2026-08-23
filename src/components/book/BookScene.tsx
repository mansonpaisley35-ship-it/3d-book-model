import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Suspense, useEffect, useRef, useState } from "react";
import { Book } from "./Book";

const VIEWS = {
  cover: new THREE.Vector3(4.2, 1.9, 10.6),
  spine: new THREE.Vector3(-9.6, 1.6, 4.0),
  head: new THREE.Vector3(2.4, 9.4, 5.2),
  edge: new THREE.Vector3(10.4, 1.2, 1.6),
} as const;

export type ViewKey = keyof typeof VIEWS;

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

  const pick = (v: ViewKey) => {
    setView(v);
    setFree(false);
  };

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [4.2, 1.9, 10.6], fov: 30 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        onPointerDown={() => setFree(true)}
        onCreated={({ scene }) => {
          (window as any).__scene = scene;
        }}
      >
        <color attach="background" args={["#0e1319"]} />
        <fog attach="fog" args={["#0e1319", 16, 30]} />

        <Suspense fallback={null}>
          <group position={[0, 0.15, 0]} scale={0.76}>
            <Book autoRotate={false} />
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
    </div>
  );
}
