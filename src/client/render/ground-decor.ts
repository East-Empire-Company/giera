import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeRng } from "../../shared/rng";

export type ScatterKind = "tuft" | "flower" | "rock" | "mushroom";

type ScatterItem = { x: number; y: number; z: number; kind: ScatterKind; scale: number; rotation: number };

const FLOWER_COLORS = [0xff6b8a, 0xffd166, 0xf4f1de, 0xc77dff, 0x7bdff2];
const ROCK_COLORS = [0x8d8d8d, 0x9b9b8f, 0x7f8a8d];
const MUSHROOM_COLORS = [0xd84a3a, 0xe0b040, 0xc06b5a];
const TUFT_COLORS = [0x6fae4b, 0x83bc52, 0x639e4c];

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

function tuftGeometry(): THREE.BufferGeometry {
  const first = new THREE.PlaneGeometry(0.18, 0.38);
  first.translate(0, 0.19, 0);
  const second = first.clone();
  second.rotateY(Math.PI / 2);
  const merged = mergeGeometries([first, second], false)!;
  first.dispose();
  second.dispose();
  return merged;
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

function paletteColor(item: ScatterItem, palette: number[], seed: number): number {
  const hash = (Math.imul(item.x + 1024, 73856093) ^ Math.imul(item.z + 1024, 19349663) ^ seed) >>> 0;
  return palette[hash % palette.length];
}

export function placeGroundDecor(
  items: ScatterItem[],
  seed: number,
  isGrass: (x: number, y: number, z: number) => boolean,
  surfaceAt: (x: number, z: number) => number
): THREE.Group {
  const group = new THREE.Group();
  group.name = "ground-decor";
  const placed = items.flatMap((item) => {
    const y = surfaceAt(item.x, item.z);
    return Number.isFinite(y) && isGrass(item.x, y, item.z) ? [{ ...item, y: y + 1 }] : [];
  });

  const tuft = makeInstances(
    placed,
    "tuft",
    tuftGeometry(),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide }),
    (item) => paletteColor(item, TUFT_COLORS, seed)
  );
  const flowerGeometry = new THREE.DodecahedronGeometry(0.11, 0);
  const flowerHead = makeInstances(
    placed,
    "flower",
    flowerGeometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, flatShading: true }),
    (item) => paletteColor(item, FLOWER_COLORS, seed),
    0.38,
    0.7
  );
  const flowerStem = makeInstances(
    placed,
    "flower",
    new THREE.CylinderGeometry(0.018, 0.024, 0.34, 5),
    new THREE.MeshStandardMaterial({ color: 0x5a9a42, roughness: 0.9 }),
    () => 0xffffff,
    0.17,
    1
  );
  const rock = makeInstances(
    placed,
    "rock",
    new THREE.DodecahedronGeometry(0.2, 0),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }),
    (item) => paletteColor(item, ROCK_COLORS, seed),
    0.12,
    0.7
  );
  const mushroomCap = makeInstances(
    placed,
    "mushroom",
    new THREE.SphereGeometry(0.14, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, flatShading: true }),
    (item) => paletteColor(item, MUSHROOM_COLORS, seed),
    0.25,
    1
  );
  const mushroomStem = makeInstances(
    placed,
    "mushroom",
    new THREE.CylinderGeometry(0.04, 0.055, 0.2, 6),
    new THREE.MeshStandardMaterial({ color: 0xf1e3c8, roughness: 0.85 }),
    () => 0xffffff,
    0.1,
    1
  );

  for (const mesh of [tuft, flowerStem, flowerHead, rock, mushroomStem, mushroomCap]) {
    if (mesh) group.add(mesh);
  }
  flowerGeometry.dispose();
  return group;
}
