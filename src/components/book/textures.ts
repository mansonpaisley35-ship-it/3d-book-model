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
      const warp = ((x / step + y / step) % 2) === 0;
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

/** Page-edge striations: hundreds of hairline leaves seen from the fore-edge. */
export function makePageEdgeMap(size = 1024): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#efe9dd";
  ctx.fillRect(0, 0, c.width, c.height);
  for (let x = 0; x < size; x += 1) {
    const v = 214 + Math.random() * 34;
    ctx.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
    ctx.fillRect(x, 0, 1, c.height);
    if (x % 3 === 0) {
      ctx.fillStyle = "rgba(120,105,84,0.35)";
      ctx.fillRect(x, 0, 1, c.height);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** White-ink / blind-deboss artwork used as an alpha + bump source. */
export function makeStampMap(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
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

/** A simple pencil glyph — the on-cover "edit" affordance. */
export function drawPencil(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const s = Math.min(w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = s * 0.055;
  ctx.lineJoin = "round";

  const bw = s * 0.2; // body width
  const top = -s * 0.34;
  const tipY = s * 0.34;
  const shoulder = tipY - s * 0.16;

  // body
  ctx.beginPath();
  ctx.rect(-bw / 2, top, bw, shoulder - top);
  ctx.stroke();

  // ferrule line
  ctx.beginPath();
  ctx.moveTo(-bw / 2, top + s * 0.12);
  ctx.lineTo(bw / 2, top + s * 0.12);
  ctx.stroke();

  // tip
  ctx.beginPath();
  ctx.moveTo(-bw / 2, shoulder);
  ctx.lineTo(0, tipY);
  ctx.lineTo(bw / 2, shoulder);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
