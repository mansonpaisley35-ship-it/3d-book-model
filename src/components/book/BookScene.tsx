import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Feather,
  FileText,
  Loader2,
  RotateCcw,
  Ruler,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { designFiles, designJson, downloadFile } from "./export";
import {
  Book,
  DEFAULT_ADJUST,
  type BookAdjusts,
  type BookImages,
  type ImageAdjust,
} from "./Book";
import {
  CLOTH_SWATCHES,
  DEFAULT_ASPECTS,
  PAPERS,
  TRIMS,
  suggestConfig,
  type Aspects,
  type BookConfig,
  type PaperKey,
  type TrimKey,
} from "./config";
import { disposePdfPages, type PdfPage } from "./pdf";

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

type NumField = [keyof BookConfig, string, number, number, number, number?];

const GROUPS: { title: string; fields: NumField[] }[] = [
  {
    title: "Dimensions",
    fields: [
      ["width", "Width", 2, 6, 0.01],
      ["height", "Height", 3, 8, 0.01],
      ["pageDepth", "Depth of text block", 0.2, 2.6, 0.01],
      ["boardThickness", "Cover thickness", 0.03, 0.2, 0.005, 3],
      ["cornerRadius", "Corner radius", 0, 0.14, 0.005, 3],
      ["edgeRound", "Head/tail rounding", 0.005, 0.09, 0.005, 3],
    ],
  },
  {
    title: "Joint & spine",
    fields: [
      ["grooveOffset", "Groove position", 0.04, 0.55, 0.002, 3],
      ["grooveWidth", "Groove width", 0.006, 0.2, 0.002, 3],
      ["grooveDepth", "Groove depth", 0.002, 0.1, 0.001, 3],

      ["grooveBlend", "Groove softness", 0, 1, 0.02],
      ["spineBuckle", "Spine buckle", 0, 0.2, 0.005, 3],
      ["spineSquareness", "Square spine", 0, 1, 0.02],
      ["spineHollow", "Space behind pages", 0, 1, 0.02],
    ],
  },
  {
    title: "Page margins",
    fields: [
      ["marginTop", "Top", 0, 0.3, 0.005, 3],
      ["marginBottom", "Bottom", 0, 0.3, 0.005, 3],
      ["marginFore", "Fore-edge", 0, 0.3, 0.005, 3],
    ],
  },
  {
    title: "Material",
    fields: [
      ["clothRoughness", "Cloth roughness", 0.2, 1, 0.01],
      ["clothSheen", "Cloth sheen", 0, 1, 0.01],
    ],
  },
  {
    title: "Light & shadow",
    fields: [
      ["ambient", "Ambient", 0, 1.5, 0.01],
      ["keyIntensity", "Key light", 0, 6, 0.05],
      ["keyAzimuth", "Key rotation", -180, 180, 1, 0],
      ["keyElevation", "Key height", 5, 85, 1, 0],
      ["rimIntensity", "Rim light", 0, 4, 0.05],
      ["envIntensity", "Studio bounce", 0, 2, 0.02],
      ["shadowOpacity", "Shadow strength", 0, 1, 0.01],
      ["shadowBlur", "Shadow softness", 0.5, 6, 0.1],
    ],
  },
];

const COLOR_FIELDS: [keyof BookConfig, string][] = [
  ["clothColor", "Boards"],
  ["spineColor", "Spine"],
  ["pageColor", "Paper"],
  ["edgeColor", "Page edges"],
];

function CameraRig({ view, active, dist }: { view: ViewKey; active: boolean; dist: number }) {
  const { camera } = useThree();
  const target = useRef(VIEWS.cover.clone());

  useEffect(() => {
    target.current.copy(VIEWS[view]).multiplyScalar(dist);
  }, [view, dist]);

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
  const [adjusts, setAdjusts] = useState<BookAdjusts>({});
  const [editing, setEditing] = useState(false);
  const [building, setBuilding] = useState(false);
  const [openSlot, setOpenSlot] = useState<keyof BookImages>("front");
  const [pages, setPages] = useState<PdfPage[]>([]);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<{ done: number; total: number } | null>(null);

  const [aspects, setAspects] = useState<Aspects>(DEFAULT_ASPECTS);
  const [config, setConfig] = useState<BookConfig>(() => suggestConfig(DEFAULT_ASPECTS));
  const [copied, setCopied] = useState(false);

  /** Re-open a previously saved design file. */
  const loadDesign = async (file?: File | null) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as { aspects?: Aspects; config?: BookConfig };
      if (data.aspects) setAspects(data.aspects);
      if (data.config) setConfig((prev) => ({ ...prev, ...data.config }));
    } catch (err) {
      console.error("Could not read that design file", err);
    }
  };



  /** Change one of the high-level aspects and re-derive the suggested build. */
  const applyAspects = (patch: Partial<Aspects>) => {
    const next = { ...aspects, ...patch };
    setAspects(next);
    setConfig(suggestConfig(next));
  };

  const patchConfig = (patch: Partial<BookConfig>) =>
    setConfig((prev) => ({ ...prev, ...patch }));

  const importPdf = async (file?: File | null) => {
    if (!file) return;
    setPdfBusy({ done: 0, total: 0 });
    try {
      const { renderPdfPages } = await import("./pdf");
      const rendered = await renderPdfPages(file, {
        onProgress: (done, total) => setPdfBusy({ done, total }),
      });
      setPages((prev) => {
        disposePdfPages(prev);
        return rendered;
      });
      setPdfName(file.name);
    } catch (err) {
      console.error("PDF import failed", err);
    } finally {
      setPdfBusy(null);
    }
  };

  const clearPdf = () => {
    setPages((prev) => {
      disposePdfPages(prev);
      return [];
    });
    setPdfName(null);
  };

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
    setAdjusts((prev) => ({ ...prev, [key]: { ...DEFAULT_ADJUST } }));
  };

  const clearImage = (key: keyof BookImages) => {
    setImages((prev) => {
      if (prev[key]) URL.revokeObjectURL(prev[key]!);
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setAdjusts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const patchAdjust = (key: keyof BookImages, patch: Partial<ImageAdjust>) =>
    setAdjusts((prev) => ({ ...prev, [key]: { ...DEFAULT_ADJUST, ...prev[key], ...patch } }));

  const openEditor = (slot: keyof BookImages) => {
    setOpenSlot(slot);
    setBuilding(false);
    setEditing(true);
  };

  // keep the book comfortably framed whatever size it is built at
  const fit = useMemo(() => {
    const span = Math.max(config.height, config.width * 1.25);
    return { scale: (0.76 * 5.0) / span, dist: Math.max(0.85, span / 5.0) };
  }, [config.height, config.width]);

  const key = useMemo(() => {
    const az = (config.keyAzimuth * Math.PI) / 180;
    const el = (config.keyElevation * Math.PI) / 180;
    const r = 11;
    return [
      Math.sin(az) * Math.cos(el) * r,
      Math.sin(el) * r,
      Math.cos(az) * Math.cos(el) * r,
    ] as [number, number, number];
  }, [config.keyAzimuth, config.keyElevation]);

  const panelClass =
    "pointer-events-auto absolute inset-y-0 right-0 z-20 w-full max-w-sm overflow-y-auto border-l border-white/10 bg-[#0e1319]/95 p-6 backdrop-blur-xl";
  const chipClass =
    "rounded-full border border-white/10 px-3 py-1.5 text-[11px] tracking-[0.12em] text-[#9db0c6] uppercase hover:text-[#e8eef5]";

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows={config.shadows}
        dpr={[1, 2]}
        camera={{ position: [4.2, 1.9, 10.6], fov: 30 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        onPointerDown={() => setFree(true)}
      >
        <color attach="background" args={["#0e1319"]} />
        <fog attach="fog" args={["#0e1319", 16, 30]} />

        <Suspense fallback={null}>
          <group position={[0, 0.15, 0]} scale={fit.scale}>
            <Book
              autoRotate={false}
              images={images}
              adjusts={adjusts}
              pages={pages}
              config={config}
              onEdit={(slot) => openEditor(slot)}
            />
          </group>

          {/* soft studio setup: broad key light, cool rim from behind */}
          <ambientLight intensity={config.ambient} />
          <directionalLight
            position={key}
            intensity={config.keyIntensity}
            castShadow={config.shadows}
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0006}
          />
          <directionalLight position={[-6, 3, -5]} intensity={config.rimIntensity} color="#7fa6d6" />
          <spotLight position={[0, 7, -6]} angle={0.6} penumbra={1} intensity={0.8} color="#cfe0f5" />

          {/* hand-built studio environment (no remote HDRI): large soft box lights */}
          <Environment resolution={256} environmentIntensity={config.envIntensity} frames={1}>
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

          {config.shadows && (
            <ContactShadows
              position={[0, -2.05, 0]}
              opacity={config.shadowOpacity}
              scale={10}
              blur={config.shadowBlur}
              far={4}
              resolution={1024}
              color="#000000"
            />
          )}
        </Suspense>

        <CameraRig view={view} active={!free} dist={fit.dist} />
        <OrbitControls
          enabled={free}
          enablePan={false}
          minDistance={5}
          maxDistance={22}
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
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => pick(k)}
            className={`rounded-full px-4 py-1.5 text-[11px] tracking-[0.14em] uppercase transition-colors ${
              view === k && !free
                ? "bg-[#e8eef5] text-[#101720]"
                : "text-[#9db0c6] hover:text-[#e8eef5]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="pointer-events-auto absolute top-6 right-6 flex gap-2">
        <button
          onClick={() => {
            setEditing(false);
            setBuilding((v) => !v);
          }}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] tracking-[0.16em] text-[#cfdcea] uppercase backdrop-blur-md transition-colors hover:bg-white/10"
        >
          <Ruler size={13} /> Build
        </button>
        <button
          onClick={() => openEditor(openSlot)}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] tracking-[0.16em] text-[#cfdcea] uppercase backdrop-blur-md transition-colors hover:bg-white/10"
        >
          <Feather size={13} /> Artwork
        </button>
      </div>

      {building && (
        <div className={panelClass}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] tracking-[0.3em] text-[#7f93aa] uppercase">Construction</p>
              <h2 className="mt-2 font-serif text-xl text-[#e8eef5]">Build the book</h2>
            </div>
            <button
              onClick={() => setBuilding(false)}
              aria-label="Close build panel"
              className="rounded-full border border-white/10 p-2 text-[#9db0c6] hover:text-[#e8eef5]"
            >
              <X size={14} />
            </button>
          </div>

          {/* -------- suggested build from a few high-level aspects -------- */}
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-[#e8eef5]">Suggested build</p>
                <p className="mt-0.5 text-[11px] text-[#7f93aa]">
                  Pick the basics and every groove, board and margin is proportioned for you
                </p>
              </div>
              <Sparkles size={15} className="mt-1 shrink-0 text-[#7f93aa]" />
            </div>

            <label className="mt-4 block">
              <span className="text-[11px] text-[#9db0c6]">Trim size</span>
              <select
                value={aspects.trim}
                onChange={(e) => applyAspects({ trim: e.target.value as TrimKey })}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#131a22] px-3 py-2 text-[12px] text-[#e8eef5]"
              >
                {Object.entries(TRIMS).map(([k, t]) => (
                  <option key={k} value={k}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block">
              <span className="text-[11px] text-[#9db0c6]">Paper stock</span>
              <select
                value={aspects.paper}
                onChange={(e) => applyAspects({ paper: e.target.value as PaperKey })}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#131a22] px-3 py-2 text-[12px] text-[#e8eef5]"
              >
                {Object.entries(PAPERS).map(([k, p]) => (
                  <option key={k} value={k}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block">
              <span className="flex items-center justify-between text-[11px] text-[#9db0c6]">
                Page count
                <span className="tabular-nums text-[#7f93aa]">{aspects.pageCount}</span>
              </span>
              <input
                type="range"
                min={48}
                max={900}
                step={2}
                value={aspects.pageCount}
                onChange={(e) => applyAspects({ pageCount: Number(e.target.value) })}
                className="mt-1 w-full accent-[#e8eef5]"
              />
            </label>

            <div className="mt-4">
              <p className="text-[11px] text-[#9db0c6]">Cloth colour</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {CLOTH_SWATCHES.map((sw) => (
                  <button
                    key={sw}
                    aria-label={`Cloth ${sw}`}
                    onClick={() => applyAspects({ clothColor: sw })}
                    style={{ background: sw }}
                    className={`h-7 w-7 rounded-full border transition-transform ${
                      aspects.clothColor === sw
                        ? "scale-110 border-[#e8eef5]"
                        : "border-white/15 hover:scale-105"
                    }`}
                  />
                ))}
              </div>
            </div>

            <button
              onClick={() => applyAspects({})}
              className={`${chipClass} mt-4 flex items-center gap-1`}
            >
              <RotateCcw size={11} /> Reset to suggestion
            </button>
          </div>

          {/* -------- fine control -------- */}
          {GROUPS.map((group) => (
            <div key={group.title} className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[10px] tracking-[0.24em] text-[#7f93aa] uppercase">{group.title}</p>
              <div className="mt-3 space-y-3">
                {group.fields.map(([field, label, min, max, step, digits]) => (
                  <label key={field} className="block">
                    <span className="flex items-center justify-between text-[11px] text-[#9db0c6]">
                      {label}
                      <span className="tabular-nums text-[#7f93aa]">
                        {(config[field] as number).toFixed(digits ?? 2)}
                      </span>
                    </span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={config[field] as number}
                      onChange={(e) =>
                        patchConfig({ [field]: Number(e.target.value) } as Partial<BookConfig>)
                      }
                      className="mt-1 w-full accent-[#e8eef5]"
                    />
                  </label>
                ))}

                {group.title === "Light & shadow" && (
                  <label className="flex items-center justify-between text-[11px] text-[#9db0c6]">
                    Cast shadows
                    <input
                      type="checkbox"
                      checked={config.shadows}
                      onChange={(e) => patchConfig({ shadows: e.target.checked })}
                      className="accent-[#e8eef5]"
                    />
                  </label>
                )}
              </div>
            </div>
          ))}

          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[10px] tracking-[0.24em] text-[#7f93aa] uppercase">Colour</p>
            <div className="mt-3 space-y-2">
              {COLOR_FIELDS.map(([field, label]) => (
                <label key={field} className="flex items-center justify-between text-[11px] text-[#9db0c6]">
                  {label}
                  <input
                    type="color"
                    value={config[field] as string}
                    onChange={(e) =>
                      patchConfig({ [field]: e.target.value } as Partial<BookConfig>)
                    }
                    className="h-7 w-12 cursor-pointer rounded border border-white/10 bg-transparent"
                  />
                </label>
                ))}
            </div>
          </div>

          {/* -------- save / reuse the design -------- */}
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[10px] tracking-[0.24em] text-[#7f93aa] uppercase">Save design</p>
            <p className="mt-2 text-[11px] leading-relaxed text-[#7f93aa]">
              Exports the build only — sizes, joint, spine, colours and light. Artwork and imported
              pages are not included.
            </p>

            <div className="mt-3 space-y-2">
              {designFiles(config, aspects).map((file) => (
                <button
                  key={file.name}
                  onClick={() => downloadFile(file)}
                  className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-[#131a22] px-3 py-2 text-left text-[12px] text-[#e8eef5] hover:border-white/25"
                >
                  <span>
                    {file.name.endsWith(".json")
                      ? "Design data (.json)"
                      : file.name.endsWith(".js")
                        ? "Three.js module (.js)"
                        : "Standalone page (.html)"}
                    <span className="mt-0.5 block text-[10px] text-[#7f93aa]">
                      {file.name.endsWith(".json")
                        ? "Every setting as plain data"
                        : file.name.endsWith(".js")
                          ? "Config + geometry builders to import"
                          : "Opens in any browser, orbit the book"}
                    </span>
                  </span>
                  <Download size={14} className="shrink-0 text-[#7f93aa]" />
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(designJson(config, aspects));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }}
                className={`${chipClass} flex items-center gap-1`}
              >
                {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "Copied" : "Copy JSON"}
              </button>

              <label className={`${chipClass} flex cursor-pointer items-center gap-1`}>
                <Upload size={11} /> Load JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => loadDesign(e.target.files?.[0])}
                />
              </label>
            </div>
          </div>

        </div>
      )}

      {editing && (
        <div className={panelClass}>
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

          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-[#e8eef5]">Interior pages</p>
                <p className="mt-0.5 text-[11px] text-[#7f93aa]">
                  Import a PDF — each page becomes a real leaf in the text block
                </p>
              </div>
              <FileText size={15} className="mt-1 shrink-0 text-[#7f93aa]" />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <label className="cursor-pointer rounded-full bg-[#e8eef5] px-3 py-1.5 text-[11px] tracking-[0.12em] text-[#101720] uppercase">
                {pages.length ? "Replace PDF" : "Import PDF"}
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => void importPdf(e.target.files?.[0])}
                />
              </label>
              {pages.length > 0 && (
                <button onClick={clearPdf} className={chipClass}>
                  Remove
                </button>
              )}
            </div>

            {pdfBusy && (
              <p className="mt-3 flex items-center gap-2 text-[11px] text-[#9db0c6]">
                <Loader2 size={12} className="animate-spin" />
                Rendering pages {pdfBusy.done}
                {pdfBusy.total ? ` / ${pdfBusy.total}` : ""}
              </p>
            )}
            {!pdfBusy && pages.length > 0 && (
              <p className="mt-3 text-[11px] text-[#7f93aa]">
                {pdfName} — {pages.length} pages on {Math.ceil(pages.length / 2)} leaves
              </p>
            )}
          </div>

          <div className="mt-3 space-y-3">
            {SLOTS.map(({ key: slot, label, hint }) => {
              const adj = { ...DEFAULT_ADJUST, ...adjusts[slot] };
              const open = openSlot === slot;
              return (
                <div key={slot} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <button
                    onClick={() => setOpenSlot(slot)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <div>
                      <p className="text-sm text-[#e8eef5]">{label}</p>
                      <p className="mt-0.5 text-[11px] text-[#7f93aa]">{hint}</p>
                    </div>
                    {images[slot] && (
                      <img
                        src={images[slot]}
                        alt={`${label} preview`}
                        className="h-12 w-9 rounded object-cover"
                      />
                    )}
                  </button>

                  <div className="mt-3 flex items-center gap-2">
                    <label className="cursor-pointer rounded-full bg-[#e8eef5] px-3 py-1.5 text-[11px] tracking-[0.12em] text-[#101720] uppercase">
                      {images[slot] ? "Replace" : "Upload"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => setImage(slot, e.target.files?.[0])}
                      />
                    </label>
                    {images[slot] && (
                      <button onClick={() => clearImage(slot)} className={chipClass}>
                        Remove
                      </button>
                    )}
                  </div>

                  {images[slot] && open && (
                    <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] tracking-[0.24em] text-[#7f93aa] uppercase">
                          Crop &amp; fit
                        </p>
                        <button
                          onClick={() => patchAdjust(slot, { ...DEFAULT_ADJUST })}
                          className="flex items-center gap-1 text-[10px] tracking-[0.14em] text-[#9db0c6] uppercase hover:text-[#e8eef5]"
                        >
                          <RotateCcw size={11} /> Reset
                        </button>
                      </div>

                      <div className="flex gap-1 rounded-full border border-white/10 p-1">
                        {(["cover", "contain"] as const).map((f) => (
                          <button
                            key={f}
                            onClick={() => patchAdjust(slot, { fit: f })}
                            className={`flex-1 rounded-full px-2 py-1 text-[10px] tracking-[0.14em] uppercase transition-colors ${
                              adj.fit === f
                                ? "bg-[#e8eef5] text-[#101720]"
                                : "text-[#9db0c6] hover:text-[#e8eef5]"
                            }`}
                          >
                            {f === "cover" ? "Fill" : "Fit"}
                          </button>
                        ))}
                      </div>

                      {(
                        [
                          ["scale", "Zoom", 0.5, 3, 0.01],
                          ["offsetX", "Pan X", -0.5, 0.5, 0.005],
                          ["offsetY", "Pan Y", -0.5, 0.5, 0.005],
                          ["rotation", "Rotate", -180, 180, 1],
                        ] as [keyof ImageAdjust, string, number, number, number][]
                      ).map(([field, label2, min, max, step]) => (
                        <label key={field} className="block">
                          <span className="flex items-center justify-between text-[11px] text-[#9db0c6]">
                            {label2}
                            <span className="tabular-nums text-[#7f93aa]">
                              {(adj[field] as number).toFixed(field === "rotation" ? 0 : 2)}
                            </span>
                          </span>
                          <input
                            type="range"
                            min={min}
                            max={max}
                            step={step}
                            value={adj[field] as number}
                            onChange={(e) =>
                              patchAdjust(slot, { [field]: Number(e.target.value) } as Partial<ImageAdjust>)
                            }
                            className="mt-1 w-full accent-[#e8eef5]"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="mt-5 text-[11px] leading-relaxed text-[#7f93aa]">
            Cover artwork stops just past the joint groove, so the hinge stays visible like a real
            case-bound book.
          </p>
        </div>
      )}
    </div>
  );
}
