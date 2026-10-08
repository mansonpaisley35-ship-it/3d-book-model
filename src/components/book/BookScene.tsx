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
  Info,
  Loader2,
  RotateCcw,
  Ruler,
  Settings2,
  Sparkles,
  Trash2,
  Library,
  Upload,
  X,
} from "lucide-react";
import { designFiles, designJson, downloadFile } from "./export";
import { Book, DEFAULT_ADJUST, type BookAdjusts, type BookImages, type ImageAdjust } from "./Book";
import {
  CLOTH_SWATCHES,
  DEFAULT_ASPECTS,
  PAGE_EDGE_TEXTURES,
  PAPERS,
  TRIMS,
  migrateConfig,
  suggestConfig,
  type Aspects,
  type BookConfig,
  type PageEdgeTexture,
  type PaperKey,
  type TrimKey,
} from "./config";
import { useBookMotion } from "./book-state";
import { PdfBookSource } from "./pdf-source";
import {
  LAST_BOOK_KEY,
  deleteBook,
  listBooks,
  saveBook,
  updateBook,
  type PoseKey,
  type StoredBook,
} from "./library";

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

type NumField = {
  key: keyof BookConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  digits?: number;
  /** short help text shown on the information icon */
  tip?: string;
  /** the visual direction of the slider, e.g. Rounded -> Flat */
  ends?: [string, string];
};

/** Panel groups follow the physical construction of a case-bound book. */
const GROUPS: { title: string; fields: NumField[] }[] = [
  {
    title: "Book",
    fields: [
      { key: "bookWidth", label: "Book width", min: 2, max: 6, step: 0.01 },
      { key: "bookHeight", label: "Book height", min: 3, max: 8, step: 0.01 },
      {
        key: "pageBlockThickness",
        label: "Page block thickness",
        min: 0.2,
        max: 2.6,
        step: 0.01,
        tip: "Thickness of the bound page block. Page count and paper stock suggest a starting value.",
      },
      {
        key: "boardThickness",
        label: "Board thickness",
        min: 0.03,
        max: 0.2,
        step: 0.005,
        digits: 3,
        tip: "Thickness of the rigid board beneath the covering material.",
      },
      {
        key: "coverOverhang",
        label: "Cover overhang",
        min: 0,
        max: 0.25,
        step: 0.005,
        digits: 3,
        tip: "How far the boards project past the page block at head, tail and fore-edge.",
      },
    ],
  },
  {
    title: "Cover shape",
    fields: [
      {
        key: "coverCornerRadius",
        label: "Cover corner radius",
        min: 0,
        max: 0.14,
        step: 0.005,
        digits: 3,
      },
      {
        key: "headTailEdgeRadius",
        label: "Head & tail edge radius",
        min: 0.005,
        max: 0.09,
        step: 0.005,
        digits: 3,
        tip: "Radius of the case edges at the head and the tail.",
      },
    ],
  },
  {
    title: "Spine & joint",
    fields: [
      {
        key: "jointPosition",
        label: "Joint position",
        min: 0.04,
        max: 0.55,
        step: 0.002,
        digits: 3,
        tip: "Distance between the spine centre and the cover joint.",
      },
      {
        key: "jointWidth",
        label: "Joint width",
        min: 0.006,
        max: 0.2,
        step: 0.002,
        digits: 3,
        tip: "Width of the flexible joint between the cover board and spine.",
      },
      {
        key: "jointDepth",
        label: "Joint depth",
        min: 0.002,
        max: 0.1,
        step: 0.001,
        digits: 3,
        tip: "Depth of the recessed hinge groove.",
      },
      {
        key: "jointSoftness",
        label: "Joint softness",
        min: 0,
        max: 1,
        step: 0.02,
        tip: "Controls how gently the joint transitions into the cover.",
        ends: ["Crisp", "Soft"],
      },
      {
        key: "spineExtension",
        label: "Spine extension",
        min: 0,
        max: 0.2,
        step: 0.005,
        digits: 3,
        tip: "How far the spine crown projects outward beyond the cover boards.",
      },
      {
        key: "spineProfileFlatness",
        label: "Spine profile flatness",
        min: 0,
        max: 1,
        step: 0.02,
        tip: "Cross-section of the spine, from rounded to flatter and more squared.",
        ends: ["Rounded", "Flat"],
      },
      {
        key: "hollowBack",
        label: "Hollow back",
        min: 0,
        max: 1,
        step: 0.02,
        tip: "Gap between the page block and the inside of the spine.",
        ends: ["Solid", "Hollow"],
      },
    ],
  },
  {
    title: "Page block",
    fields: [
      {
        key: "pageBlockCornerRadius",
        label: "Page block corner radius",
        min: 0,
        max: 0.3,
        step: 0.005,
        digits: 3,
        tip: "Roundness of the page block's fore-edge corners — separate from the cover boards.",
      },
      {
        key: "headMargin",
        label: "Head margin",
        min: 0,
        max: 0.3,
        step: 0.005,
        digits: 3,
        tip: "Extra inset of the page block below the head, on top of the square",
      },
      {
        key: "tailMargin",
        label: "Tail margin",
        min: 0,
        max: 0.3,
        step: 0.005,
        digits: 3,
        tip: "Extra inset of the page block above the tail, on top of the square",
      },
      {
        key: "foreEdgeMargin",
        label: "Fore-edge margin",
        min: 0,
        max: 0.3,
        step: 0.005,
        digits: 3,
      },
      {
        key: "pageEdgeVariation",
        label: "Page edge variation",
        min: 0,
        max: 1,
        step: 0.02,
        tip: "Amount of subtle irregularity between individual page edges.",
        ends: ["Uniform", "Natural"],
      },
    ],
  },
  {
    title: "Materials",
    fields: [
      { key: "clothRoughness", label: "Cover roughness", min: 0.2, max: 1, step: 0.01 },
      { key: "clothSheen", label: "Cover sheen", min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: "Lighting & presentation",
    fields: [
      { key: "ambient", label: "Ambient light", min: 0, max: 1.5, step: 0.01 },
      { key: "keyIntensity", label: "Key light intensity", min: 0, max: 6, step: 0.05 },
      {
        key: "keyAzimuth",
        label: "Key light angle",
        min: -180,
        max: 180,
        step: 1,
        digits: 0,
        tip: "Rotates the key light around the book, in degrees.",
      },
      { key: "keyElevation", label: "Key light height", min: 5, max: 85, step: 1, digits: 0 },
      { key: "rimIntensity", label: "Rim light intensity", min: 0, max: 4, step: 0.05 },
      { key: "envIntensity", label: "Environment light", min: 0, max: 2, step: 0.02 },
      { key: "shadowOpacity", label: "Shadow strength", min: 0, max: 1, step: 0.01 },
      { key: "shadowBlur", label: "Shadow softness", min: 0.5, max: 6, step: 0.1 },
    ],
  },
];

const COLOR_FIELDS: [keyof BookConfig, string][] = [
  ["clothColor", "Cover colour"],
  ["spineColor", "Spine colour"],
  ["pageColor", "Paper colour"],
  ["edgeColor", "Page edge colour"],
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

const eul = (x: number, y: number, z = 0) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));

const POSES: { key: PoseKey; label: string; lying: boolean; q: () => THREE.Quaternion }[] = [
  { key: "front", label: "Front cover", lying: false, q: () => new THREE.Quaternion() },
  { key: "threeQuarter", label: "Three-quarter", lying: false, q: () => eul(0, 0.55) },
  { key: "back", label: "Back cover", lying: false, q: () => eul(0, Math.PI) },
  { key: "spineStanding", label: "Spine first, standing", lying: false, q: () => eul(0, Math.PI / 2) },
  { key: "foreEdge", label: "Fore-edge first", lying: false, q: () => eul(0, -Math.PI / 2) },
  { key: "lyingFlat", label: "Lying flat, cover up", lying: true, q: () => eul(-Math.PI / 2, 0) },
  { key: "lyingBack", label: "Lying flat, back up", lying: true, q: () => eul(Math.PI / 2, 0, Math.PI) },
  {
    key: "spineLying",
    label: "Spine first, lying down",
    lying: true,
    q: () => eul(0, Math.PI / 2).multiply(eul(-Math.PI / 2, 0)),
  },
];

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Moves the book between poses with a lifted, eased arc (picked up, turned,
 * set down) and spins it on a turntable while auto-spin is on.
 */
function PoseRig({
  pose,
  lyingDrop,
  spin,
  settle,
  children,
}: {
  pose: PoseKey;
  lyingDrop: number;
  spin: boolean;
  settle: React.MutableRefObject<(() => void) | null>;
  children: React.ReactNode;
}) {
  const spinGroup = useRef<THREE.Group>(null);
  const poseGroup = useRef<THREE.Group>(null);
  const tween = useRef({
    from: new THREE.Quaternion(),
    to: new THREE.Quaternion(),
    fromY: 0,
    toY: 0,
    t: 1,
    init: false,
  });

  useEffect(() => {
    const g = poseGroup.current;
    const def = POSES.find((p) => p.key === pose) ?? POSES[0]!;
    const tw = tween.current;
    const toY = def.lying ? -lyingDrop : 0;
    if (!g || !tw.init) {
      tw.to.copy(def.q());
      tw.from.copy(tw.to);
      tw.fromY = tw.toY = toY;
      tw.t = 1;
      tw.init = !!g;
      if (g) {
        g.quaternion.copy(tw.to);
        g.position.y = toY;
      }
      return;
    }
    tw.from.copy(g.quaternion);
    tw.fromY = g.position.y;
    tw.to.copy(def.q());
    tw.toY = toY;
    tw.t = tw.from.angleTo(tw.to) < 0.001 && Math.abs(tw.fromY - toY) < 0.001 ? 1 : 0;
  }, [pose, lyingDrop]);

  useFrame((_, dt) => {
    const g = poseGroup.current;
    const s = spinGroup.current;
    const tw = tween.current;
    if (s) {
      if (spin) s.rotation.y += dt * 0.45;
      else {
        const a = ((((s.rotation.y + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
        s.rotation.y = a * Math.max(0, 1 - dt * 3.5);
      }
    }
    if (!g) return;
    if (!tw.init) {
      g.quaternion.copy(tw.to);
      g.position.y = tw.toY;
      tw.init = true;
    }
    if (tw.t < 1) {
      tw.t = Math.min(1, tw.t + dt / 1.25);
      const e = easeInOut(tw.t);
      g.quaternion.slerpQuaternions(tw.from, tw.to, e);
      const arc = tw.from.angleTo(tw.to) > 0.01 ? Math.sin(Math.PI * e) * 0.9 : 0;
      g.position.y = tw.fromY + (tw.toY - tw.fromY) * e + arc;
    }
    const spun = s ? Math.abs(s.rotation.y) < 0.01 : true;
    if (tw.t >= 1 && spun && settle.current) {
      const fn = settle.current;
      settle.current = null;
      fn();
    }
  });

  return (
    <group ref={spinGroup}>
      <group ref={poseGroup}>{children}</group>
    </group>
  );
}

function blobUrls(covers: StoredBook["covers"]): BookImages {
  const out: BookImages = {};
  for (const [k, b] of Object.entries(covers ?? {}))
    if (b) out[k as keyof BookImages] = URL.createObjectURL(b);
  return out;
}

export default function BookScene() {
  const [free, setFree] = useState(false);
  const [view, setView] = useState<ViewKey>("cover");
  const [images, setImages] = useState<BookImages>({});
  const [adjusts, setAdjusts] = useState<BookAdjusts>({});
  const [editing, setEditing] = useState(false);
  const [building, setBuilding] = useState(false);
  const [openSlot, setOpenSlot] = useState<keyof BookImages>("front");
  const [source, setSource] = useState<PdfBookSource | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  /* ---- library & modes ---- */
  const [books, setBooks] = useState<StoredBook[]>([]);
  const [bookId, setBookId] = useState<string | null>(null);
  const [libraryReady, setLibraryReady] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [pose, setPose] = useState<PoseKey>("front");
  const [displayPose, setDisplayPose] = useState<PoseKey>("front");
  const [autoSpin, setAutoSpin] = useState(false);
  const [orbit, setOrbit] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [draft, setDraft] = useState<{ pdf?: File } & Partial<Record<keyof BookImages, File>>>({});
  const settle = useRef<(() => void) | null>(null);
  const loadedRef = useRef<string | null>(null);

  // pages 1 and N are the covers, so the interior makes this many spreads
  const spreadCount = source ? Math.max(1, Math.floor((source.pageCount - 2) / 2)) : 0;
  const reading = useBookMotion(spreadCount, !!source && !configuring);

  const [aspects, setAspects] = useState<Aspects>(DEFAULT_ASPECTS);
  const [config, setConfig] = useState<BookConfig>(() => suggestConfig(DEFAULT_ASPECTS));
  const [copied, setCopied] = useState(false);

  /** Put a stored book on the stage, with its own saved look and pose. */
  const presentBook = async (rec: StoredBook) => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const next = await PdfBookSource.load(
        new File([rec.pdf], `${rec.title}.pdf`, { type: "application/pdf" }),
      );
      loadedRef.current = null;
      setSource((prev) => {
        prev?.dispose();
        return next;
      });
      setImages((prev) => {
        Object.values(prev).forEach((u) => u && URL.revokeObjectURL(u));
        return blobUrls(rec.covers);
      });
      setAdjusts(rec.adjusts ?? {});
      setConfig(migrateConfig(rec.config));
      setAspects(rec.aspects ?? DEFAULT_ASPECTS);
      setPose(rec.pose ?? "front");
      setDisplayPose(rec.pose ?? "front");
      setAutoSpin(!!rec.autoSpin);
      setOrbit(rec.orbit ?? true);
      setBookId(rec.id);
      loadedRef.current = rec.id;
      localStorage.setItem(LAST_BOOK_KEY, rec.id);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "That book could not be opened");
    } finally {
      setPdfBusy(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const all = await listBooks();
        setBooks(all);
        const last = localStorage.getItem(LAST_BOOK_KEY);
        const rec = all.find((b) => b.id === last) ?? all[0];
        if (rec) await presentBook(rec);
      } catch (err) {
        console.error("Could not read the library", err);
      } finally {
        setLibraryReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // every change to the look is saved to this book
  useEffect(() => {
    if (!bookId || loadedRef.current !== bookId) return;
    const id = bookId;
    const h = setTimeout(() => {
      const patch = { config, aspects, adjusts, pose, autoSpin, orbit };
      void updateBook(id, patch);
      setBooks((list) => list.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    }, 350);
    return () => clearTimeout(h);
  }, [bookId, config, aspects, adjusts, pose, autoSpin, orbit]);

  const importBook = async () => {
    if (!draft.pdf) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      const probe = await PdfBookSource.load(draft.pdf);
      const pageCount = probe.pageCount;
      const title = probe.title;
      probe.dispose();
      const a = { ...DEFAULT_ASPECTS, pageCount: Math.max(48, Math.min(900, pageCount)) };
      const covers: StoredBook["covers"] = {};
      for (const s of ["front", "back", "spine", "edges"] as const) if (draft[s]) covers[s] = draft[s];
      const rec: StoredBook = {
        id: crypto.randomUUID(),
        title,
        pageCount,
        createdAt: Date.now(),
        pdf: draft.pdf,
        covers,
        adjusts: {},
        config: suggestConfig(a),
        aspects: a,
        pose: "front",
        autoSpin: false,
        orbit: true,
      };
      await saveBook(rec);
      setBooks((list) => [rec, ...list]);
      setImportOpen(false);
      setDraft({});
      await presentBook(rec);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "That PDF could not be imported");
      setPdfBusy(false);
    }
  };

  const removeBook = async (id: string) => {
    await deleteBook(id);
    const rest = books.filter((b) => b.id !== id);
    setBooks(rest);
    if (id === bookId) {
      setBookId(null);
      loadedRef.current = null;
      setSource((prev) => {
        prev?.dispose();
        return null;
      });
      setConfiguring(false);
      if (rest[0]) await presentBook(rest[0]);
    }
  };

  /** Re-open a previously saved design file. */
  const loadDesign = async (file?: File | null) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as { aspects?: Aspects; config?: unknown };
      if (data.aspects) setAspects(data.aspects);
      // older files used the pre-rename property names — migrate them
      if (data.config) setConfig(migrateConfig(data.config));
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

  const patchConfig = (patch: Partial<BookConfig>) => setConfig((prev) => ({ ...prev, ...patch }));

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
    const rec = books.find((b) => b.id === bookId);
    if (rec) {
      const covers = { ...rec.covers, [key]: file };
      void updateBook(rec.id, { covers });
      setBooks((list) => list.map((b) => (b.id === rec.id ? { ...b, covers } : b)));
    }
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
    const rec = books.find((b) => b.id === bookId);
    if (rec) {
      const covers = { ...rec.covers };
      delete covers[key];
      void updateBook(rec.id, { covers });
      setBooks((list) => list.map((b) => (b.id === rec.id ? { ...b, covers } : b)));
    }
  };

  const patchAdjust = (key: keyof BookImages, patch: Partial<ImageAdjust>) =>
    setAdjusts((prev) => ({ ...prev, [key]: { ...DEFAULT_ADJUST, ...prev[key], ...patch } }));

  const openEditor = (slot: keyof BookImages) => {
    setOpenSlot(slot);
    setBuilding(false);
    setEditing(true);
  };

  const enterConfigure = () => {
    if (reading.open) reading.toggleOpen();
    settle.current = null;
    setDisplayPose(pose);
    setConfiguring(true);
  };

  const exitConfigure = () => {
    setConfiguring(false);
    setEditing(false);
    setBuilding(false);
    setFree(false);
    setView("cover");
  };

  const choosePose = (p: PoseKey) => {
    setPose(p);
    setDisplayPose(p);
  };

  /** Double tap: stand the book up facing the reader, then open (or close) it. */
  const activate = () => {
    if (configuring || !source) return;
    if (reading.open) {
      reading.toggleOpen();
      return;
    }
    setFree(false);
    setView("cover");
    settle.current = () => reading.toggleOpen();
    setDisplayPose("front");
  };

  // keep the book comfortably framed whatever size it is built at
  const fit = useMemo(() => {
    const span = Math.max(config.bookHeight, config.bookWidth * 1.25);
    return { scale: (0.76 * 5.0) / span, dist: Math.max(0.85, span / 5.0) };
  }, [config.bookHeight, config.bookWidth]);

  const lyingDrop =
    config.bookHeight / 2 - (config.pageBlockThickness + config.boardThickness * 2) / 2;

  const key = useMemo(() => {
    const az = (config.keyAzimuth * Math.PI) / 180;
    const el = (config.keyElevation * Math.PI) / 180;
    const r = 11;
    return [Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r] as [
      number,
      number,
      number,
    ];
  }, [config.keyAzimuth, config.keyElevation]);

  const panelClass =
    "pointer-events-auto absolute inset-y-0 right-0 z-20 w-full max-w-sm overflow-y-auto border-l border-white/10 bg-[#0e1319]/95 p-6 backdrop-blur-xl";
  const chipClass =
    "rounded-full border border-white/10 px-3 py-1.5 text-[11px] tracking-[0.12em] text-[#9db0c6] uppercase hover:text-[#e8eef5]";
  const pillClass =
    "flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] tracking-[0.16em] text-[#cfdcea] uppercase backdrop-blur-md transition-colors hover:bg-white/10";
  const current = books.find((b) => b.id === bookId);

  return (
    <div className="relative h-full w-full">
      {source && (
      <Canvas
        shadows={config.shadows}
        dpr={[1, 2]}
        camera={{ position: [4.2, 1.9, 10.6], fov: 30 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        onPointerDown={() => configuring && orbit && setFree(true)}
      >
        <color attach="background" args={["#0e1319"]} />
        <fog attach="fog" args={["#0e1319", 16, 30]} />

        <Suspense fallback={null}>
          <group position={[0, 0.15, 0]} scale={fit.scale}>
            <PoseRig
              pose={configuring ? pose : displayPose}
              lyingDrop={lyingDrop}
              spin={configuring && autoSpin}
              settle={settle}
            >
              <Book
                autoRotate={false}
                images={images}
                adjusts={adjusts}
                source={source}
                reading={reading}
                config={config}
                editable={configuring}
                onActivate={activate}
                onEdit={(slot) => configuring && openEditor(slot)}
              />
            </PoseRig>
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
          <directionalLight
            position={[-6, 3, -5]}
            intensity={config.rimIntensity}
            color="#7fa6d6"
          />
          <spotLight
            position={[0, 7, -6]}
            angle={0.6}
            penumbra={1}
            intensity={0.8}
            color="#cfe0f5"
          />

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

        <CameraRig view={configuring ? view : "cover"} active={!free} dist={fit.dist} />
        <OrbitControls
          enabled={configuring && orbit && free}
          enablePan={false}
          minDistance={5}
          maxDistance={22}
          minPolarAngle={0.15}
          maxPolarAngle={Math.PI / 1.9}
          enableDamping
          dampingFactor={0.06}
        />
      </Canvas>
      )}

      {!source && libraryReady && !pdfBusy && (
        <div className="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center">
          <div className="text-center">
            <p className="font-serif text-2xl text-[#e8eef5]">No book on the shelf yet</p>
            <p className="mt-2 text-sm text-[#8fa3ba]">Import a PDF and it becomes a real book.</p>
            <button
              onClick={() => setImportOpen(true)}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#e8eef5] px-5 py-2.5 text-[11px] tracking-[0.16em] text-[#101720] uppercase"
            >
              <Upload size={13} /> Import a book
            </button>
          </div>
        </div>
      )}

      {pdfBusy && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <p className="flex items-center gap-2 text-sm text-[#9db0c6]">
            <Loader2 size={14} className="animate-spin" /> Opening the book…
          </p>
        </div>
      )}

      {configuring && source && (
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
      )}

      {!configuring && source && (
        <p className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] tracking-[0.2em] whitespace-nowrap text-[#5f7387] uppercase">
          {reading.open
            ? "Tap or drag a page · double tap the cover to close"
            : "Double tap the book to open it"}
        </p>
      )}

      <div className="pointer-events-auto absolute top-6 right-6 flex flex-wrap justify-end gap-2">
        {!configuring && (
          <>
            <button onClick={() => setImportOpen(true)} className={pillClass}>
              <Upload size={13} /> Import
            </button>
            {books.length > 0 && (
              <button onClick={() => setLibraryOpen(true)} className={pillClass}>
                <Library size={13} /> Library
              </button>
            )}
            {source && (
              <button onClick={enterConfigure} className={pillClass}>
                <Settings2 size={13} /> Configure
              </button>
            )}
          </>
        )}
        {configuring && (
          <>
            <button
              onClick={() => {
                setEditing(false);
                setBuilding((v) => !v);
              }}
              className={pillClass}
            >
              <Ruler size={13} /> Build
            </button>
            <button onClick={() => openEditor(openSlot)} className={pillClass}>
              <Feather size={13} /> Artwork
            </button>
            <button
              onClick={exitConfigure}
              className="flex items-center gap-2 rounded-full bg-[#e8eef5] px-4 py-2 text-[11px] tracking-[0.16em] text-[#101720] uppercase"
            >
              <Check size={13} /> Done
            </button>
          </>
        )}
      </div>

      {configuring && !building && !editing && (
        <div className="pointer-events-auto absolute top-24 left-6 z-20 w-64 rounded-xl border border-white/10 bg-[#0e1319]/90 p-4 backdrop-blur-xl md:top-40">
          <p className="text-[10px] tracking-[0.24em] text-[#7f93aa] uppercase">Presentation</p>
          <label className="mt-3 flex items-center justify-between text-[11px] text-[#9db0c6]">
            Auto spin
            <input
              type="checkbox"
              checked={autoSpin}
              onChange={(e) => setAutoSpin(e.target.checked)}
              className="accent-[#e8eef5]"
            />
          </label>
          <label className="mt-2 flex items-center justify-between text-[11px] text-[#9db0c6]">
            Drag to orbit
            <input
              type="checkbox"
              checked={orbit}
              onChange={(e) => {
                setOrbit(e.target.checked);
                if (!e.target.checked) setFree(false);
              }}
              className="accent-[#e8eef5]"
            />
          </label>
          <p className="mt-4 text-[10px] tracking-[0.24em] text-[#7f93aa] uppercase">Position</p>
          <div className="mt-2 grid grid-cols-1 gap-1">
            {POSES.map((p) => (
              <button
                key={p.key}
                onClick={() => choosePose(p.key)}
                className={`rounded-lg px-3 py-1.5 text-left text-[12px] transition-colors ${
                  pose === p.key
                    ? "bg-[#e8eef5] text-[#101720]"
                    : "text-[#9db0c6] hover:bg-white/5 hover:text-[#e8eef5]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-[#65788e]">
            Every change is saved to {current?.title ?? "this book"}.
          </p>
        </div>
      )}

      {importOpen && (
        <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0e1319] p-6">
            <div className="flex items-start justify-between">
              <h2 className="font-serif text-xl text-[#e8eef5]">Import a book</h2>
              <button
                onClick={() => setImportOpen(false)}
                aria-label="Close"
                className="rounded-full border border-white/10 p-2 text-[#9db0c6] hover:text-[#e8eef5]"
              >
                <X size={14} />
              </button>
            </div>
            {(
              [
                ["pdf", "Book PDF (required)", "application/pdf"],
                ["front", "Front cover image", "image/*"],
                ["back", "Back cover image", "image/*"],
                ["spine", "Spine image", "image/*"],
                ["edges", "Page edge image", "image/*"],
              ] as [keyof typeof draft, string, string][]
            ).map(([k, label, accept]) => (
              <label
                key={k}
                className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#131a22] px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block text-[12px] text-[#e8eef5]">{label}</span>
                  <span className="block truncate text-[10px] text-[#7f93aa]">
                    {draft[k]?.name ?? (k === "pdf" ? "Choose a PDF" : "Optional")}
                  </span>
                </span>
                {k === "pdf" ? (
                  <FileText size={14} className="text-[#7f93aa]" />
                ) : (
                  <Upload size={14} className="text-[#7f93aa]" />
                )}
                <input
                  type="file"
                  accept={accept}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setDraft((d) => ({ ...d, [k]: f }));
                  }}
                />
              </label>
            ))}
            {pdfError && (
              <p className="mt-3 text-[11px] text-[#e2a2a2]" role="alert">
                {pdfError}
              </p>
            )}
            <button
              disabled={!draft.pdf || pdfBusy}
              onClick={() => void importBook()}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-[#e8eef5] px-4 py-2.5 text-[11px] tracking-[0.16em] text-[#101720] uppercase disabled:opacity-40"
            >
              {pdfBusy && <Loader2 size={12} className="animate-spin" />} Add to library
            </button>
          </div>
        </div>
      )}

      {libraryOpen && (
        <div className={panelClass}>
          <div className="flex items-start justify-between">
            <h2 className="font-serif text-xl text-[#e8eef5]">Library</h2>
            <button
              onClick={() => setLibraryOpen(false)}
              aria-label="Close library"
              className="rounded-full border border-white/10 p-2 text-[#9db0c6] hover:text-[#e8eef5]"
            >
              <X size={14} />
            </button>
          </div>
          <div className="mt-5 space-y-2">
            {books.map((b) => (
              <div
                key={b.id}
                className={`flex items-center justify-between gap-2 rounded-xl border p-3 ${
                  b.id === bookId
                    ? "border-white/30 bg-white/[0.06]"
                    : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <button
                  onClick={() => {
                    setLibraryOpen(false);
                    if (b.id !== bookId) void presentBook(b);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm text-[#e8eef5]">{b.title}</span>
                  <span className="text-[10px] text-[#7f93aa]">{b.pageCount} pages</span>
                </button>
                <button
                  onClick={() => void removeBook(b.id)}
                  aria-label={`Remove ${b.title}`}
                  className="rounded-full p-2 text-[#7f93aa] hover:text-[#e2a2a2]"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
                  Pick the basics and every joint, board and margin is proportioned for you
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

          {/* -------- fine control, grouped by book construction -------- */}
          {GROUPS.map((group) => (
            <div
              key={group.title}
              className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4"
            >
              <p className="text-[10px] tracking-[0.24em] text-[#7f93aa] uppercase">
                {group.title}
              </p>
              <div className="mt-3 space-y-3">
                {group.fields.map((f) => (
                  <label key={f.key} className="block">
                    <span className="flex items-center justify-between gap-2 text-[11px] text-[#9db0c6]">
                      <span className="flex items-center gap-1">
                        {f.label}
                        {f.tip && (
                          <span
                            title={f.tip}
                            aria-label={f.tip}
                            className="cursor-help text-[#65788e]"
                          >
                            <Info size={11} />
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums text-[#7f93aa]">
                        {(config[f.key] as number).toFixed(f.digits ?? 2)}
                      </span>
                    </span>
                    <input
                      type="range"
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      value={config[f.key] as number}
                      onChange={(e) =>
                        patchConfig({ [f.key]: Number(e.target.value) } as Partial<BookConfig>)
                      }
                      className="mt-1 w-full accent-[#e8eef5]"
                    />
                    {f.ends && (
                      <span className="flex justify-between text-[9px] tracking-[0.14em] text-[#65788e] uppercase">
                        <span>{f.ends[0]}</span>
                        <span>{f.ends[1]}</span>
                      </span>
                    )}
                  </label>
                ))}

                {group.title === "Page block" && (
                  <label className="block">
                    <span className="text-[11px] text-[#9db0c6]">Page edge texture</span>
                    <select
                      value={config.pageEdgeTexture}
                      onChange={(e) =>
                        patchConfig({ pageEdgeTexture: e.target.value as PageEdgeTexture })
                      }
                      className="mt-1 w-full rounded-lg border border-white/10 bg-[#131a22] px-3 py-2 text-[12px] text-[#e8eef5]"
                    >
                      {PAGE_EDGE_TEXTURES.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {group.title === "Lighting & presentation" && (
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
                <label
                  key={field}
                  className="flex items-center justify-between text-[11px] text-[#9db0c6]"
                >
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
                {copied ? <Check size={11} /> : <Copy size={11} />}{" "}
                {copied ? "Copied" : "Copy JSON"}
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
                              patchAdjust(slot, {
                                [field]: Number(e.target.value),
                              } as Partial<ImageAdjust>)
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
