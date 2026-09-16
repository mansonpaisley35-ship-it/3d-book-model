/*
 * Lazy PDF page source.
 *
 * One imported PDF becomes a `PdfBookSource`. Pages are rendered to a canvas
 * only when the book actually needs them and kept in a small LRU cache, so a
 * 600-page document costs the same as a short one. Adapted from the approach
 * used in the reference book engine.
 */
import * as THREE from "three";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Hard ceiling so a huge PDF cannot melt the page geometry. */
export const MAX_PDF_PAGES = 600;
/** How many rendered pages are kept on the GPU at once. */
const CACHE_LIMIT = 24;
const RENDER_WIDTH = 900;

type Doc = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;

export class PdfBookSource {
  readonly title: string;
  /** physical pages actually shown (page 1 = front cover, last = back cover) */
  readonly pageCount: number;
  readonly totalPages: number;
  readonly aspect: number;

  private doc: Doc;
  private cache = new Map<number, THREE.Texture>();
  private pending = new Set<number>();
  private failed = new Set<number>();
  private disposed = false;

  static async load(file: File): Promise<PdfBookSource> {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
    if (!isPdf) throw new Error("That file is not a PDF");

    const data = new Uint8Array(await file.arrayBuffer());
    let doc: Doc;
    try {
      doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
    } catch {
      throw new Error("This PDF could not be opened (it may be damaged or password protected)");
    }
    const total = doc.numPages;
    if (!total) throw new Error("This PDF contains no pages");

    const first = await doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    const aspect = vp.width / vp.height;
    first.cleanup();

    return new PdfBookSource(doc, {
      title: (file.name || "Imported book").replace(/\.pdf$/i, ""),
      pageCount: Math.min(total, MAX_PDF_PAGES),
      totalPages: total,
      aspect: aspect > 0.2 && aspect < 5 ? aspect : 0.72,
    });
  }

  private constructor(
    doc: Doc,
    meta: { title: string; pageCount: number; totalPages: number; aspect: number },
  ) {
    this.doc = doc;
    this.title = meta.title;
    this.pageCount = meta.pageCount;
    this.totalPages = meta.totalPages;
    this.aspect = meta.aspect;
  }

  get truncated() {
    return this.totalPages > this.pageCount;
  }

  /**
   * Texture for a 0-based physical page, or null while it is still rendering.
   * `onReady` fires once the page has been drawn, so the caller can re-render.
   */
  getTexture(index: number, onReady?: () => void): THREE.Texture | null {
    if (this.disposed || index < 0 || index >= this.pageCount) return null;
    const cached = this.cache.get(index);
    if (cached) {
      // refresh the LRU position
      this.cache.delete(index);
      this.cache.set(index, cached);
      return cached;
    }
    console.log('[book] want page', index);
    if (!this.failed.has(index)) void this.render(index, onReady);
    return null;
  }

  private async render(index: number, onReady?: () => void) {
    if (this.pending.has(index) || this.disposed) return;
    this.pending.add(index);
    try {
      const page = await this.doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width });

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(2, Math.round(viewport.width));
      canvas.height = Math.max(2, Math.round(viewport.height));
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fdfaf2";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();
      if (this.disposed) return;

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;

      this.cache.set(index, texture);
      while (this.cache.size > CACHE_LIMIT) {
        const oldest = this.cache.keys().next().value as number | undefined;
        if (oldest === undefined || oldest === index) break;
        this.cache.get(oldest)?.dispose();
        this.cache.delete(oldest);
      }
      console.log('[book] rendered page', index);
      onReady?.();
    } catch (err) {
      // one unreadable page must never break the book: it simply stays blank
      this.failed.add(index);
      console.warn("[book] page render failed", index + 1, err);
    } finally {
      this.pending.delete(index);
    }
  }

  dispose() {
    this.disposed = true;
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
    this.pending.clear();
    try {
      void this.doc.destroy();
    } catch {
      /* ignore */
    }
  }
}
