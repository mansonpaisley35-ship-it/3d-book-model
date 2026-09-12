import * as THREE from "three";

/** Fine woven-cloth normal map, generated once at runtime. */
export function makeClothNormalMap(size = 512): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgb(128,128,255)";
  ctx.fillRect(0, 0, size, size);

  // weave: alternating horizontal / vertical thread highlights
  const step = 4;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const warp = (x / step + y / step) % 2 === 0;
      const n = (Math.random() - 0.5) * 26;
      const gx = (warp ? 18 : -18) + n;
      const gy = (warp ? -18 : 18) + n;
      ctx.fillStyle = `rgb(${128 + gx},${128 + gy},250)`;
      ctx.fillRect(x, y, step, step);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 20);
  tex.anisotropy = 8;
  return tex;
}

/** Subtle roughness break-up so the cloth doesn't read as plastic. */
export function makeClothRoughnessMap(size = 512): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 168 + Math.random() * 46;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 8);
  return tex;
}

/**
 * Page-edge striations: hundreds of hairline leaves seen from the fore-edge.
 * `texture` picks the character of the cut (smooth -> deckled) and `variation`
 * (0..1) how irregular individual leaves are.
 */
export type PageEdgeStyle = "smooth" | "natural" | "rough" | "deckled";

const EDGE_STYLES: Record<
  PageEdgeStyle,
  { contrast: number; every: number; line: number; wave: number }
> = {
  smooth: { contrast: 12, every: 5, line: 0.12, wave: 0 },
  natural: { contrast: 34, every: 3, line: 0.35, wave: 0 },
  rough: { contrast: 58, every: 2, line: 0.55, wave: 1.4 },
  deckled: { contrast: 70, every: 2, line: 0.6, wave: 4.5 },
};

export function makePageEdgeMap(
  texture: PageEdgeStyle = "natural",
  variation = 0,
  size = 1024,
): THREE.Texture {
  const st = EDGE_STYLES[texture];
  const v = Math.min(1, Math.max(0, variation));
  const c = document.createElement("canvas");
  c.width = size;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#efe9dd";
  ctx.fillRect(0, 0, c.width, c.height);

  const contrast = st.contrast * (1 + v * 1.6);
  for (let x = 0; x < size; x += 1) {
    const v0 = 224 - contrast / 2 + Math.random() * contrast;
    ctx.fillStyle = `rgb(${v0},${v0 - 6},${v0 - 18})`;
    ctx.fillRect(x, 0, 1, c.height);
    if (x % st.every === 0) {
      ctx.fillStyle = `rgba(120,105,84,${st.line * (1 + v * 0.6)})`;
      ctx.fillRect(x, 0, 1, c.height);
    }
  }

  // uneven cut: a soft shadow that wanders along the height of the edge
  const wave = st.wave + v * 8;
  if (wave > 0.01) {
    for (let x = 0; x < size; x += 1) {
      const d =
        Math.sin(x * 0.09) * 0.5 + Math.sin(x * 0.31 + 1.7) * 0.3 + (Math.random() - 0.5) * 0.4;
      const h = Math.abs(d) * wave;
      ctx.fillStyle = "rgba(96,84,64,0.22)";
      ctx.fillRect(x, 0, 1, h);
      ctx.fillRect(x, c.height - h, 1, h);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** White-ink / blind-deboss artwork used as an alpha + bump source. */
export function makeStampMap(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

/** An elegant feather-quill glyph — the on-cover "edit" affordance. */
export function drawQuill(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const s = Math.min(w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(s / 100, s / 100);
  ctx.rotate(0.12);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // ---- feather vane: two mirrored curves meeting at plume tip and nib ----
  ctx.beginPath();
  ctx.moveTo(30, -44); // plume tip
  ctx.bezierCurveTo(2, -18, -12, 12, -20, 34); // outer (left) edge down to nib
  ctx.bezierCurveTo(-4, 26, 16, 8, 34, -14); // inner edge back up
  ctx.bezierCurveTo(38, -24, 36, -36, 30, -44);
  ctx.fill();

  // ---- barb separations, cut out of the vane with fine strokes ----------
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const sx = 27 - t * 40;
    const sy = -34 + t * 60;
    ctx.beginPath();
    ctx.moveTo(sx + 1, sy - 1);
    ctx.quadraticCurveTo(sx + 8, sy - 8, sx + 15 - t * 6, sy - 14 + t * 8);
    ctx.stroke();
  }
  ctx.restore();

  // ---- shaft / rachis, continuing into the nib -------------------------
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(29, -41);
  ctx.bezierCurveTo(14, -18, -2, 8, -18, 33);
  ctx.stroke();

  // ---- nib ------------------------------------------------------------
  ctx.beginPath();
  ctx.moveTo(-13, 26);
  ctx.lineTo(-27, 44);
  ctx.lineTo(-19, 28);
  ctx.closePath();
  ctx.fill();

  // ---- ink flourish beneath the nib -----------------------------------
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-34, 46);
  ctx.quadraticCurveTo(-10, 52, 24, 40);
  ctx.stroke();

  ctx.restore();
}
