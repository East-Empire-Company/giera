import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { makeRng } from "../../shared/rng";

export type ScatterKind = "tuft" | "flower" | "rock" | "mushroom";

type ScatterItem = { x: number; y: number; z: number; kind: ScatterKind; scale: number; rotation: number };

const ROCK_COLORS = [0x8d8d8d, 0x9b9b8f, 0x7f8a8d];

type PropPart = { geometry: THREE.BufferGeometry; material: THREE.Material; baseHeight: number };

const propCache = new Map<string, Promise<PropPart[]>>();

function loadProp(file: string): Promise<PropPart[]> {
  let cached = propCache.get(file);
  if (!cached) {
    cached = (async () => {
      const gltf = await new GLTFLoader().loadAsync(`/assets/models/props/${file}`);
      gltf.scene.updateMatrixWorld(true);
      const parts: PropPart[] = [];
      const box = new THREE.Box3();
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
        geometry.computeBoundingBox();
        box.union(geometry.boundingBox!);
        const source = Array.isArray(object.material) ? object.material[0] : object.material;
        parts.push({ geometry, material: source.clone(), baseHeight: 1 });
      });
      const height = Math.max(0.001, box.max.y - box.min.y);
      const centerX = (box.min.x + box.max.x) / 2;
      const centerZ = (box.min.z + box.max.z) / 2;
      for (const part of parts) {
        part.geometry.translate(-centerX, -box.min.y, -centerZ);
        part.baseHeight = height;
      }
      return parts;
    })();
    propCache.set(file, cached);
  }
  return cached;
}

const PROP_FILES: Record<"tuft" | "flower" | "mushroom", { file: string; targetHeight: number }> = {
  tuft: { file: "Grass_Small.gltf", targetHeight: 0.45 },
  flower: { file: "Flower_1.gltf", targetHeight: 0.38 },
  mushroom: { file: "Bush_Small_Flowers.gltf", targetHeight: 0.55 },
};

export function scatterGroundDecor(seed: number, radius: number, centerX: number, centerZ: number): ScatterItem[] {
  const rng = makeRng(seed ^ 0x5bd1e995);
  const items: ScatterItem[] = [];
  const attempts = Math.round(radius * radius * 0.36);
  for (let i = 0; i < attempts; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * radius;
    const roll = rng();
    items.push({
      x: Math.round(centerX + Math.cos(angle) * distance),
      y: 0,
      z: Math.round(centerZ + Math.sin(angle) * distance),
      kind: roll < 0.5 ? "tuft" : roll < 0.77 ? "flower" : roll < 0.91 ? "rock" : "mushroom",
      scale: 0.7 + rng() * 0.55,
      rotation: rng() * Math.PI * 2,
    });
  }
  return items;
}

export function variationColor(seed: number, item: ScatterItem): THREE.Color {
  const hash = (Math.imul(item.x + 1024, 73856093) ^ Math.imul(item.z + 1024, 19349663) ^ seed) >>> 0;
  const brightness = 0.86 + ((hash % 1000) / 1000) * 0.28;
  return new THREE.Color(brightness, brightness, brightness);
}

export function paletteColor(item: ScatterItem, palette: number[], seed: number): number {
  const hash = (Math.imul(item.x + 1024, 73856093) ^ Math.imul(item.z + 1024, 19349663) ^ seed) >>> 0;
  return palette[hash % palette.length];
}

async function makePropInstances(
  placed: ScatterItem[],
  kind: "tuft" | "flower" | "mushroom",
  seed: number
): Promise<THREE.InstancedMesh[]> {
  const selected = placed.filter((item) => item.kind === kind);
  if (selected.length === 0) return [];
  const parts = await loadProp(PROP_FILES[kind].file);
  const dummy = new THREE.Object3D();
  return parts.map((part) => {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, selected.length);
    const uniformScale = PROP_FILES[kind].targetHeight / part.baseHeight;
    selected.forEach((item, i) => {
      dummy.position.set(item.x + 0.5, item.y, item.z + 0.5);
      dummy.rotation.y = item.rotation;
      const s = uniformScale * item.scale;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, variationColor(seed, item));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    return mesh;
  });
}

function makeInstances(
  items: ScatterItem[],
  kind: ScatterKind,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  colorFor: (item: ScatterItem) => number,
  offsetY = 0,
  scaleY = 1
): THREE.InstancedMesh | null {
  const selected = items.filter((item) => item.kind === kind);
  if (selected.length === 0) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, selected.length);
  const dummy = new THREE.Object3D();
  selected.forEach((item, i) => {
    dummy.position.set(item.x + 0.5, item.y + offsetY, item.z + 0.5);
    dummy.rotation.y = item.rotation;
    dummy.scale.set(item.scale, item.scale * scaleY, item.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, new THREE.Color(colorFor(item)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  return mesh;
}

export async function placeGroundDecor(
  items: ScatterItem[],
  seed: number,
  isGrass: (x: number, y: number, z: number) => boolean,
  surfaceAt: (x: number, z: number) => number
): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = "ground-decor";
  const placed = items.flatMap((item) => {
    const y = surfaceAt(item.x, item.z);
    return Number.isFinite(y) && isGrass(item.x, y, item.z) ? [{ ...item, y: y + 1 }] : [];
  });

  const [tuftMeshes, flowerMeshes, bushMeshes] = await Promise.all([
    makePropInstances(placed, "tuft", seed),
    makePropInstances(placed, "flower", seed),
    makePropInstances(placed, "mushroom", seed),
  ]);

  const rockGeometry = new THREE.DodecahedronGeometry(0.2, 0);
  const rock = makeInstances(
    placed,
    "rock",
    rockGeometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }),
    (item) => paletteColor(item, ROCK_COLORS, seed),
    0.12,
    0.7
  );

  for (const mesh of [...tuftMeshes, ...flowerMeshes, ...bushMeshes, rock]) {
    if (mesh) group.add(mesh);
  }
  return group;
}
