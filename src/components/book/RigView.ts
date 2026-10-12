import * as THREE from "three";
import type { RigPart } from "./rig/rig";
import { pdfIndexForRigPage } from "./rig/adapter";
import { drawEndpaper } from "./rig-interaction";
import type { PdfBookSource } from "./pdf-source";

export function setMatrix(matrix: THREE.Matrix4, values: number[]) {
  matrix.set(
    values[0] ?? 1, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0,
    values[4] ?? 0, values[5] ?? 1, values[6] ?? 0, values[7] ?? 0,
    values[8] ?? 0, values[9] ?? 0, values[10] ?? 1, values[11] ?? 0,
    values[12] ?? 0, values[13] ?? 0, values[14] ?? 0, values[15] ?? 1,
  );
}

/** Imperative mesh bridge: no per-frame React updates, bones or texture clones. */
export class RigView {
  private meshes = new Map<string, THREE.Mesh>();
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private endpapers = new Map<string, THREE.CanvasTexture>();
  private disposed = false;

  constructor(
    private group: THREE.Group,
    private source: PdfBookSource | null,
    private pageColor: string,
    private board: THREE.Material,
    private edges: THREE.Material,
  ) {}

  private pageMaterial(tag: string) {
    const cached = this.materials.get(tag);
    if (cached) return cached;
    const material = new THREE.MeshStandardMaterial({
      color: this.pageColor, roughness: 0.94, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.materials.set(tag, material);
    if (tag.startsWith("endpaper:")) {
      const canvas = document.createElement("canvas");
      canvas.width = 480; canvas.height = 680;
      const context = canvas.getContext("2d");
      if (context) {
        drawEndpaper(context, tag.slice(9));
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        this.endpapers.set(tag, texture);
        material.map = texture;
        material.color.set("#ffffff");
      }
    }
    return material;
  }

  private refresh(tag: string, material: THREE.MeshStandardMaterial) {
    if (!this.source || !tag.startsWith("page:")) return;
    const index = pdfIndexForRigPage(Number(tag.slice(5)), this.source.pageCount);
    if (index === null) return;
    const ready = () => {
      if (this.disposed || !this.group.children.some((mesh) => mesh.userData['tex'] === tag)) return;
      const map = this.source?.getTexture(index);
      if (map) {
        material.map = map;
        material.color.set("#ffffff");
        material.needsUpdate = true;
      }
    };
    const map = this.source.getTexture(index, ready);
    if (map !== material.map) {
      material.map = map;
      material.color.set(map ? "#ffffff" : this.pageColor);
      material.needsUpdate = true;
    }
  }

  update(parts: RigPart[]) {
    const live = new Set<string>();
    const liveTags = new Set<string>();
    for (const part of parts) {
      if (part.name === "frontBoard" || part.name === "backBoard" || part.name === "spineBridge") continue;
      live.add(part.name);
      if (part.tex) liveTags.add(part.tex);
      const material = part.tex ? this.pageMaterial(part.tex) : part.name.startsWith("hingePin") ? this.board : this.edges;
      let mesh = this.meshes.get(part.name);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
        mesh.name = part.name;
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.castShadow = part.name === "textBlock" || part.name === "textBlockLeft";
        mesh.receiveShadow = true;
        this.meshes.set(part.name, mesh);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(part.mesh.pos, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(part.mesh.nor, 3));
      geometry.setIndex(part.mesh.idx);
      if (part.mesh.uv) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(part.mesh.uv, 2));
      geometry.computeBoundingSphere();
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      mesh.material = material;
      mesh.userData['tex'] = part.tex;
      setMatrix(mesh.matrix, part.local);
      if (mesh.parent !== this.group) this.group.add(mesh);
      if (part.tex && material instanceof THREE.MeshStandardMaterial) this.refresh(part.tex, material);
    }
    for (const [name, mesh] of this.meshes) {
      if (!live.has(name) && mesh.parent) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
    }
    // Release maps before the PDF LRU can evict them; keep the tag's material.
    for (const [tag, material] of this.materials) {
      if (tag.startsWith("page:") && !liveTags.has(tag)) material.map = null;
    }
  }

  dispose() {
    this.disposed = true;
    for (const mesh of this.meshes.values()) { mesh.removeFromParent(); mesh.geometry.dispose(); }
    for (const material of this.materials.values()) material.dispose();
    for (const texture of this.endpapers.values()) texture.dispose();
    this.meshes.clear(); this.materials.clear(); this.endpapers.clear();
  }
}