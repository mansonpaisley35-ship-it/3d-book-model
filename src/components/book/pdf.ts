import * as THREE from "three";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfPage = {
  index: number;
  texture: THREE.Texture;
  aspect: number;
};

/**
 * Render the pages of a PDF into canvas-backed textures, one per page.
 * Client-only: dynamically import this module from an event handler.
 */
export async function renderPdfPages(
  file: File,
  {
    maxPages = 48,
    targetWidth = 640,
    onProgress,
  }: {
    maxPages?: number;
    targetWidth?: number;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<PdfPage[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const total = Math.min(doc.numPages, maxPages);
  const out: PdfPage[] = [];

  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: targetWidth / base.width });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round(viewport.width));
    canvas.height = Math.max(2, Math.round(viewport.height));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fdfaf2";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;

    out.push({ index: i, texture, aspect: canvas.width / canvas.height });
    onProgress?.(i, total);
    page.cleanup();
  }

  return out;
}

export function disposePdfPages(pages: PdfPage[]) {
  for (const p of pages) p.texture.dispose();
}
