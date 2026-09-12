/**
 * Every dimension, colour and light in the book is driven by this object, so
 * the whole model is configurable from the UI. Units: 1 unit ~= 2.5 cm.
 *
 * Naming rule: one physical concept = exactly one property. Legacy names only
 * ever appear inside `migrateConfig`.
 */
export type PageEdgeTexture = "smooth" | "natural" | "rough" | "deckled";

export const PAGE_EDGE_TEXTURES: { key: PageEdgeTexture; label: string }[] = [
  { key: "smooth", label: "Smooth" },
  { key: "natural", label: "Natural" },
  { key: "rough", label: "Rough" },
  { key: "deckled", label: "Deckled" },
];

export type BookConfig = {
  /* ---- book ---- */
  bookWidth: number; // spine -> fore-edge, closed
  bookHeight: number; // head -> tail
  pageBlockThickness: number; // thickness of the bound page block
  boardThickness: number; // rigid board under the covering material
  coverOverhang: number; // how far the boards project past the page block

  /* ---- cover shape ---- */
  coverCornerRadius: number; // rounded fore-edge corners of the boards
  headTailEdgeRadius: number; // edge radius at head and tail of the case

  /* ---- spine & joint ---- */
  jointPosition: number; // distance from the spine crown to the joint centre
  jointWidth: number;
  jointDepth: number;
  jointSoftness: number; // 0..1, crisp -> soft transition into the cover
  spineExtension: number; // how far the spine crown projects past the boards
  spineProfileFlatness: number; // 0 = rounded cross-section, 1 = flat/squared
  hollowBack: number; // 0 = page block meets the spine, 1 = pronounced hollow

  /* ---- page block ---- */
  headMargin: number; // extra inset at the head, on top of the overhang
  tailMargin: number;
  foreEdgeMargin: number;
  pageBlockCornerRadius: number; // roundness of the page block's outer corners
  pageEdgeVariation: number; // 0 = uniform leaves, 1 = naturally irregular
  pageEdgeTexture: PageEdgeTexture;

  /* ---- materials ---- */
  clothColor: string;
  spineColor: string;
  pageColor: string;
  edgeColor: string;
  clothRoughness: number;
  clothSheen: number;

  /* ---- presentation ---- */
  ambient: number;
  keyIntensity: number;
  keyAzimuth: number; // degrees around the book
  keyElevation: number; // degrees above the horizon
  rimIntensity: number;
  envIntensity: number;
  shadows: boolean;
  shadowOpacity: number;
  shadowBlur: number;
};

export type TrimKey = "stripe" | "novel" | "pocket" | "large" | "square";

export const TRIMS: Record<TrimKey, { label: string; width: number; height: number }> = {
  stripe: { label: "Stripe Press — 5.5 × 8.25 in", width: 3.35, height: 5.0 },
  novel: { label: "Trade hardcover — 6 × 9 in", width: 3.6, height: 5.45 },
  pocket: { label: "Pocket — 4.5 × 7 in", width: 2.75, height: 4.25 },
  large: { label: "Large format — 7 × 10 in", width: 4.25, height: 6.05 },
  square: { label: "Square — 8 × 8 in", width: 4.85, height: 4.85 },
};

export type PaperKey = "thin" | "standard" | "thick";

export const PAPERS: Record<PaperKey, { label: string; mmPerLeaf: number }> = {
  thin: { label: "Bible / thin stock", mmPerLeaf: 0.06 },
  standard: { label: "Standard book stock", mmPerLeaf: 0.1 },
  thick: { label: "Heavy uncoated", mmPerLeaf: 0.16 },
};

export type Aspects = {
  trim: TrimKey;
  pageCount: number;
  paper: PaperKey;
  clothColor: string;
};

/** Page count + paper stock are the only inputs to the suggested thickness. */
export function suggestedPageBlockThickness(pageCount: number, paper: PaperKey): number {
  const leaves = Math.max(16, Math.round(pageCount / 2));
  // mm -> scene units (1 unit = 25 mm)
  return Math.min(2.6, Math.max(0.28, (leaves * PAPERS[paper].mmPerLeaf) / 25));
}

/**
 * Suggested configuration: everything the user doesn't care about is derived
 * from the few things they do — trim, extent, paper stock and cloth colour.
 * The joint in particular is proportional to the case thickness, which is what
 * keeps it looking right on both thin and fat books.
 */
export function suggestConfig(a: Aspects): BookConfig {
  const trim = TRIMS[a.trim];
  const pageBlockThickness = suggestedPageBlockThickness(a.pageCount, a.paper);
  const boardThickness = 0.075 + pageBlockThickness * 0.012;
  const caseT = pageBlockThickness + boardThickness * 2;
  const coverOverhang = +(trim.height * 0.016).toFixed(3);

  return {
    bookWidth: trim.width,
    bookHeight: trim.height,
    pageBlockThickness,
    boardThickness,
    coverOverhang,

    coverCornerRadius: Math.min(0.075, trim.width * 0.016),
    headTailEdgeRadius: Math.min(0.05, caseT * 0.035),

    jointWidth: +(trim.width * 0.014 + caseT * 0.02).toFixed(3),
    jointDepth: +Math.min(boardThickness * 0.55, trim.width * 0.007).toFixed(3),
    jointPosition: +(trim.width * 0.028 + caseT * 0.06).toFixed(3),
    spineExtension: +(caseT * 0.055).toFixed(3),
    spineProfileFlatness: 0,
    hollowBack: 1,
    jointSoftness: 0.65,

    headMargin: 0,
    tailMargin: 0,
    // the square (coverOverhang) already sets the cover's projection on all
    // three fore edges; these margins are any *extra* inset on top of it
    foreEdgeMargin: 0,
    pageBlockCornerRadius: 0,
    pageEdgeVariation: 0,
    pageEdgeTexture: "natural",

    clothColor: a.clothColor,
    spineColor: a.clothColor,
    pageColor: "#f6f1e4",
    edgeColor: "#efe7d8",

    clothRoughness: 0.74,
    clothSheen: 0.45,

    ambient: 0.32,
    keyIntensity: 2.4,
    keyAzimuth: 40,
    keyElevation: 44,
    rimIntensity: 1.1,
    envIntensity: 0.6,
    shadows: true,
    shadowOpacity: 0.5,
    shadowBlur: 2.6,
  };
}

export const DEFAULT_ASPECTS: Aspects = {
  trim: "stripe",
  pageCount: 320,
  paper: "standard",
  clothColor: "#212e3e",
};

export const DEFAULT_CONFIG = suggestConfig(DEFAULT_ASPECTS);

/** Current design-file format version. */
export const DESIGN_VERSION = 2;

/** Old property name -> canonical name. Used only when reading saved files. */
const LEGACY_KEYS: Record<string, keyof BookConfig> = {
  width: "bookWidth",
  height: "bookHeight",
  pageDepth: "pageBlockThickness",
  cornerRadius: "coverCornerRadius",
  edgeRound: "headTailEdgeRadius",
  grooveOffset: "jointPosition",
  grooveWidth: "jointWidth",
  grooveDepth: "jointDepth",
  grooveBlend: "jointSoftness",
  spineBuckle: "spineExtension",
  spineSquareness: "spineProfileFlatness",
  spineHollow: "hollowBack",
  marginTop: "headMargin",
  marginBottom: "tailMargin",
  marginFore: "foreEdgeMargin",
};

/**
 * Bring any saved config (version 1 or 2) up to the current shape. Version 1
 * files carried the cover overhang inside the page margins, so the overhang is
 * zeroed and the margins are kept as-is — the book looks identical.
 */
export function migrateConfig(raw: unknown): BookConfig {
  const input = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...DEFAULT_CONFIG };
  let legacy = false;

  for (const [k, v] of Object.entries(input)) {
    const mapped = LEGACY_KEYS[k];
    if (mapped) {
      legacy = true;
      out[mapped] = v;
    } else if (k in DEFAULT_CONFIG) {
      out[k] = v;
    }
  }

  if (legacy && !("coverOverhang" in input)) out["coverOverhang"] = 0;
  return out as BookConfig;
}

export const CLOTH_SWATCHES = [
  "#212e3e",
  "#14261f",
  "#3a1f24",
  "#4a3a22",
  "#2b2b31",
  "#7d2f24",
  "#d9d2c3",
  "#0f1114",
];
