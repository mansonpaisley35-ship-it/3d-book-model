/**
 * Every dimension, colour and light in the book is driven by this object, so
 * the whole model is configurable from the UI. Units: 1 unit ~= 2.5 cm.
 */
export type BookConfig = {
  /* ---- case ---- */
  width: number; // spine -> fore-edge
  height: number;
  pageDepth: number; // thickness of the text block
  boardThickness: number; // board + cloth
  cornerRadius: number; // fore-edge corner of the boards
  edgeRound: number; // head/tail rounding of the case

  /* ---- joint / spine ---- */
  grooveOffset: number; // distance from the spine crown to the groove centre
  grooveWidth: number;
  grooveDepth: number;
  spineBuckle: number; // how far the rounded spine bulges past the boards

  /* ---- text block ---- */
  marginTop: number;
  marginBottom: number;
  marginFore: number;

  /* ---- colour ---- */
  clothColor: string;
  spineColor: string;
  pageColor: string;
  edgeColor: string;
  headband: boolean;
  headbandColor: string;

  /* ---- material ---- */
  clothRoughness: number;
  clothSheen: number;

  /* ---- light & shadow ---- */
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
  stripe: { label: "Stripe Press (5.5 x 8.25 in)", width: 3.35, height: 5.0 },
  novel: { label: "Trade hardcover (6 x 9 in)", width: 3.6, height: 5.45 },
  pocket: { label: "Pocket (4.5 x 7 in)", width: 2.75, height: 4.25 },
  large: { label: "Large format (7 x 10 in)", width: 4.25, height: 6.05 },
  square: { label: "Square (8 x 8 in)", width: 4.85, height: 4.85 },
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

/**
 * Suggested configuration: everything the user doesn't care about is derived
 * from the few things they do — trim, extent, paper stock and cloth colour.
 * The joint groove in particular is proportional to the case thickness, which
 * is what keeps it looking right on both thin and fat books.
 */
export function suggestConfig(a: Aspects): BookConfig {
  const trim = TRIMS[a.trim];
  const leaves = Math.max(16, Math.round(a.pageCount / 2));
  // mm -> scene units (1 unit = 25 mm)
  const pageDepth = Math.min(2.6, Math.max(0.28, (leaves * PAPERS[a.paper].mmPerLeaf) / 25));
  const boardThickness = 0.075 + pageDepth * 0.012;
  const caseT = pageDepth + boardThickness * 2;

  return {
    width: trim.width,
    height: trim.height,
    pageDepth,
    boardThickness,
    cornerRadius: Math.min(0.075, trim.width * 0.016),
    edgeRound: Math.min(0.05, caseT * 0.035),

    grooveWidth: +(caseT * 0.14).toFixed(3),
    grooveDepth: +Math.min(boardThickness * 0.62, caseT * 0.05).toFixed(3),
    grooveOffset: +(trim.width * 0.042 + caseT * 0.075).toFixed(3),
    spineBuckle: +(caseT * 0.055).toFixed(3),

    marginTop: +(trim.height * 0.016).toFixed(3),
    marginBottom: +(trim.height * 0.016).toFixed(3),
    marginFore: +(trim.width * 0.021).toFixed(3),

    clothColor: a.clothColor,
    spineColor: a.clothColor,
    pageColor: "#f6f1e4",
    edgeColor: "#efe7d8",
    headband: true,
    headbandColor: "#8a3b35",

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
