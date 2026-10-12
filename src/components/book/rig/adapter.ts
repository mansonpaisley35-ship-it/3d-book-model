import type { Cfg } from "./kin";

/** The fields of the app's BookConfig (src/components/book/config.ts) that the rig reads. Structural, so the real BookConfig is assignable. */
export type RigSource = {
  bookWidth: number; bookHeight: number; pageBlockThickness: number; boardThickness: number; coverOverhang: number;
  coverCornerRadius: number; headTailEdgeRadius: number; jointPosition: number; jointWidth: number; jointDepth: number; jointSoftness: number;
  spineExtension: number; spineProfileFlatness: number; hollowBack: number; headMargin: number; tailMargin: number; foreEdgeMargin: number;
};

/** BookConfig -> the rig's configuration. The rig was written against the design-file names (the app's LEGACY_KEYS table), and it takes the per-edge
 *  margin INCLUDING the cover overhang, exactly like metrics() in Book.tsx (`insetHead = coverOverhang + headMargin`, ...). */
export function toRigCfg(c: RigSource): Cfg {
  return {
    width: c.bookWidth, height: c.bookHeight, pageDepth: c.pageBlockThickness, boardThickness: c.boardThickness,
    cornerRadius: c.coverCornerRadius, edgeRound: c.headTailEdgeRadius,
    grooveOffset: c.jointPosition, grooveWidth: c.jointWidth, grooveDepth: c.jointDepth, grooveBlend: c.jointSoftness,
    spineBuckle: c.spineExtension, spineSquareness: c.spineProfileFlatness, spineHollow: c.hollowBack,
    marginTop: c.coverOverhang + c.headMargin, marginBottom: c.coverOverhang + c.tailMargin, marginFore: c.coverOverhang + c.foreEdgeMargin,
  };
}

/**
 * Leaves of the rig for a PDF with `pageCount` physical pages (PdfBookSource.pageCount: page 1 = front cover, last = back cover).
 * The interior pages make ceil((pageCount-2)/2) leaves, plus two ENDPAPER leaves (first and last), as in Shift Happens.
 */
export const leavesFor = (pageCount: number) => 2 + Math.ceil(Math.max(2, pageCount - 2) / 2);

/**
 * Which 0-based PHYSICAL pdf page (PdfBookSource.getTexture(index)) is printed on rig page `n` (1-based, as in the texture tag "page:n"),
 * or null for a blank sheet (the verso of the last interior page when the interior count is odd). Rig pages 1,2 and 2N-1,2N are endpapers
 * (tags "endpaper:*") and never reach this function.
 */
export const pdfIndexForRigPage = (n: number, pageCount: number): number | null => {
  const interior = Math.max(0, pageCount - 2), i = n - 3;           // rig page 3 is the first interior page
  return i >= 0 && i < interior ? 1 + i : null;                     // physical index 0 is the front cover
};
