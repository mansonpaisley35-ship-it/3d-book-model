/**
 * Design export: turns the current book configuration into portable files so
 * the same case can be rebuilt anywhere. Only design/geometry is exported —
 * no uploaded artwork, no PDF pages.
 *
 * The geometry source below is plain ES module JavaScript and is the single
 * copy shared by both the .js and the .html exports. It mirrors the builders in
 * Book.tsx (same formulas, same shared joint contract), written without types
 * so it runs untouched in any three.js project or straight in a browser.
 */
import type { Aspects, BookConfig } from "./config";

export const GEOMETRY_JS = `/**
 * Parametric case-bound book geometry — four independent parts:
 *   frontBoard, backBoard, spineBridge, textBlock
 * Every dimension comes from the config object; no magic numbers.
 */

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Quintic smootherstep valley: 1 at the centre, 0 with zero slope at the rim. */
const bump = (u) => {
  const a = 1 - Math.min(1, Math.abs(u));
  return a * a * a * (a * (a * 6 - 15) + 10);
};

export function metrics(c) {
  const W = c.width;
  const H = c.height;
  const T = c.pageDepth + c.boardThickness * 2;
  const hingeX = -W / 2 + c.grooveOffset;
  const hingeW = c.grooveWidth / 2;

  const pageForeX = W / 2 - c.marginFore;
  const spineInnerX = -W / 2 - c.spineBuckle + c.boardThickness * 1.15;
  const hollow = clamp01(c.spineHollow);
  const pageSpineX = spineInnerX + (hingeX + hingeW * 0.5 - spineInnerX) * hollow;

  return {
    W,
    H,
    T,
    hingeX,
    hingeW,
    spineInnerX,
    pageWidth: Math.max(0.3, pageForeX - pageSpineX),
    pageHeight: Math.max(0.3, H - c.marginTop - c.marginBottom),
    pageDepth: Math.max(0.06, c.pageDepth - 0.04),
    pageCX: (pageForeX + pageSpineX) / 2,
    pageCY: (c.marginBottom - c.marginTop) / 2,
  };
}

/**
 * The shared joint contract used by BOTH boards and spine, so they always meet
 * at the same point with the same flat tangent whatever the configuration is.
 */
export function joint(c) {
  const { W, T, hingeX, hingeW } = metrics(c);
  const half = hingeW * (1 + clamp01(c.grooveBlend));
  const jointX = hingeX - half;
  const overlap = Math.min(0.005, half * 0.3);
  return { W, T, half, jointX, overlap, hingeX };
}

/** Cross-section in XY, swept along the book's height, head/tail rounded. */
function extrude(THREE, shape, c) {
  const ER = Math.min(c.edgeRound, c.boardThickness * 0.9, c.height / 20);
  const depth = c.height - ER * 2;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: 96,
    bevelEnabled: true,
    bevelThickness: ER,
    bevelSize: ER * 0.85,
    bevelOffset: -ER * 0.85,
    bevelSegments: 12,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, depth / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

/** One board: flat plate, rounded fore-edge, C2 joint valley by the spine. */
export function buildBoardGeometry(THREE, c) {
  const { W, T, half, jointX, overlap, hingeX } = joint(c);
  const BOARD = c.boardThickness;
  const D = Math.min(c.grooveDepth, BOARD * 0.7);
  const R = Math.min(c.cornerRadius, BOARD * 0.45);
  const out = T / 2;
  const inn = T / 2 - BOARD;
  const tip = jointX - overlap;

  const grooveY = (x) => out - D * bump((x - hingeX) / half);

  const s = new THREE.Shape();
  const x0 = W / 2 - R;
  const steps = 160;
  s.moveTo(x0, out);
  for (let i = 1; i <= steps; i++) {
    const x = x0 + ((tip - x0) * i) / steps;
    s.lineTo(x, grooveY(x));
  }
  s.lineTo(tip, inn);
  s.lineTo(W / 2, inn);
  s.lineTo(W / 2, out - R);
  for (let i = 1; i <= 16; i++) {
    const a = (i / 16) * (Math.PI / 2);
    s.lineTo(W / 2 - R * (1 - Math.cos(a)), out - R + R * Math.sin(a));
  }

  return extrude(THREE, s, c);
}

/**
 * Spine shell: a superellipse X(Y) whose tips land exactly on the board's outer
 * plane with a horizontal tangent and whose crown is vertical, so it melts into
 * both boards for any squareness, buckle or groove setting.
 */
export function buildSpineGeometry(THREE, c) {
  const { T, jointX } = joint(c);
  const BOARD = c.boardThickness;
  const crown = -c.width / 2 - c.spineBuckle;

  const q = clamp01(c.spineSquareness);
  const m = 2 + q * q * 12;

  const b = T / 2;
  const a = Math.max(1e-4, jointX - crown);
  const bIn = Math.max(1e-4, b - BOARD);
  const aIn = Math.max(1e-4, jointX - (crown + BOARD));

  const prof = (y, aa, bb, x0) => {
    const Y = Math.min(1, Math.abs(y) / bb);
    const X = 1 - Math.pow(Math.max(0, 1 - Math.pow(Y, m)), 1 / m);
    return x0 + aa * X;
  };

  const N = 192;
  const s = new THREE.Shape();
  s.moveTo(jointX, b);
  for (let i = 1; i <= N; i++) {
    const y = b - (2 * b * i) / N;
    s.lineTo(prof(y, a, b, crown), y);
  }
  s.lineTo(jointX, -bIn);
  for (let i = 1; i <= N; i++) {
    const y = -bIn + (2 * bIn * i) / N;
    s.lineTo(prof(y, aIn, bIn, crown + BOARD), y);
  }
  s.lineTo(jointX, b);

  return extrude(THREE, s, c);
}

/** The text block as one solid slab (swap for real leaves when animating). */
export function buildTextBlockGeometry(THREE, c) {
  const m = metrics(c);
  const geo = new THREE.BoxGeometry(m.pageWidth, m.pageHeight, m.pageDepth);
  geo.rotateY(Math.PI / 2);
  return geo;
}

/**
 * Assemble the whole book as a THREE.Group of four independent meshes.
 * Pass the three.js namespace so this file stays import-free.
 */
export function buildBook(THREE, c) {
  const m = metrics(c);

  const cloth = new THREE.MeshPhysicalMaterial({
    color: c.clothColor,
    roughness: c.clothRoughness,
    metalness: 0,
    sheen: c.clothSheen,
    sheenColor: new THREE.Color("#ffffff"),
    clearcoat: 0.06,
    clearcoatRoughness: 0.7,
  });
  const spineCloth = cloth.clone();
  spineCloth.color = new THREE.Color(c.spineColor);
  const paper = new THREE.MeshStandardMaterial({
    color: c.pageColor,
    roughness: 0.92,
    metalness: 0,
  });

  const board = buildBoardGeometry(THREE, c);
  const front = new THREE.Mesh(board, cloth);
  front.name = "frontBoard";

  const back = new THREE.Mesh(board.clone(), cloth);
  back.name = "backBoard";
  back.rotation.x = Math.PI;

  const spine = new THREE.Mesh(buildSpineGeometry(THREE, c), spineCloth);
  spine.name = "spineBridge";

  const block = new THREE.Mesh(buildTextBlockGeometry(THREE, c), paper);
  block.name = "textBlock";
  block.position.set(m.pageCX, m.pageCY, 0);

  const group = new THREE.Group();
  group.name = "book";
  for (const mesh of [front, back, spine, block]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
`;

export type DesignFile = { name: string; mime: string; contents: string };

const stamp = () => new Date().toISOString().slice(0, 10);

/** Plain data: the whole design, re-loadable into this studio or any tool. */
export function designJson(config: BookConfig, aspects: Aspects) {
  return JSON.stringify(
    {
      format: "book-canvas-design",
      version: 1,
      exported: new Date().toISOString(),
      units: "1 unit = 25 mm",
      parts: ["frontBoard", "backBoard", "spineBridge", "textBlock"],
      aspects,
      config,
    },
    null,
    2,
  );
}

/** An ES module: the config plus the geometry builders, ready to import. */
export function designModule(config: BookConfig) {
  return `// Book design export — ${stamp()}
// Usage:
//   import * as THREE from "three";
//   import { config, buildBook } from "./book-design.js";
//   scene.add(buildBook(THREE, config));

export const config = ${JSON.stringify(config, null, 2)};

${GEOMETRY_JS}`;
}

/** A single self-contained page: open it in a browser and orbit the book. */
export function designHtml(config: BookConfig) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Book design — ${stamp()}</title>
<style>
  html, body { margin: 0; height: 100%; background: #0e1319; overflow: hidden; }
  canvas { display: block; }
</style>
</head>
<body>
<script type="importmap">
{ "imports": { "three": "https://unpkg.com/three@0.171.0/build/three.module.js",
               "three/addons/": "https://unpkg.com/three@0.171.0/examples/jsm/" } }
</script>
<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export const config = ${JSON.stringify(config, null, 2)};

${GEOMETRY_JS.replace(/^export /gm, "")}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = config.shadows;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#0e1319");
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = config.envIntensity;

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 100);
const span = Math.max(config.height, config.width * 1.25);
camera.position.set(span * 0.8, span * 0.4, span * 2.1);

const book = buildBook(THREE, config);
scene.add(book);

scene.add(new THREE.AmbientLight(0xffffff, config.ambient));
const az = (config.keyAzimuth * Math.PI) / 180;
const el = (config.keyElevation * Math.PI) / 180;
const r = span * 2.2;
const key = new THREE.DirectionalLight(0xffffff, config.keyIntensity);
key.position.set(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
key.castShadow = config.shadows;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0006;
scene.add(key);
const rim = new THREE.DirectionalLight(0x7fa6d6, config.rimIntensity);
rim.position.set(-r, r * 0.4, -r * 0.7);
scene.add(rim);

if (config.shadows) {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 8, span * 8),
    new THREE.ShadowMaterial({ opacity: config.shadowOpacity })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -config.height / 2 - 0.02;
  floor.receiveShadow = true;
  scene.add(floor);
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
</script>
</body>
</html>
`;
}

export function designFiles(config: BookConfig, aspects: Aspects): DesignFile[] {
  return [
    { name: `book-design-${stamp()}.json`, mime: "application/json", contents: designJson(config, aspects) },
    { name: `book-design-${stamp()}.js`, mime: "text/javascript", contents: designModule(config) },
    { name: `book-design-${stamp()}.html`, mime: "text/html", contents: designHtml(config) },
  ];
}

export function downloadFile(file: DesignFile) {
  const blob = new Blob([file.contents], { type: `${file.mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
