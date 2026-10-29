import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { makeRng } from "../../shared/rng";
import { withRetry } from "../../shared/retry";

export type ScatterKind = "tuft" | "flower" | "rock" | "mushroom";
export type ScatterItem = {
  x: number;
  y: number;
  z: number;
  kind: ScatterKind;
  scale: number;
  rotation: number;
};

export type GrassBladeSite = { x: number; z: number; scale: number; rotation: number };

const ROCK_COLORS = [0x8d8d8d, 0x9b9b8f, 0x7f8a8d];
const rockGeometry = new THREE.DodecahedronGeometry(0.2, 0);
const rockMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });

type PropPart = { geometry: THREE.BufferGeometry; material: THREE.Material; baseHeight: number };

const propCache = new Map<string, Promise<PropPart[]>>();

function loadProp(file: string): Promise<PropPart[]> {
  let cached = propCache.get(file);
  if (!cached) {
    cached = (async () => {
      const gltf = await withRetry(() => new GLTFLoader().loadAsync(`/assets/models/props/${file}`));
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
    cached.catch(() => propCache.delete(file));
    propCache.set(file, cached);
  }
  return cached;
}

const PROP_FILES: Record<"tuft" | "flower" | "mushroom", { file: string; targetHeight: number }> = {
  tuft: { file: "Grass_Small.gltf", targetHeight: 0.45 },
  flower: { file: "Flower_1.gltf", targetHeight: 0.38 },
  mushroom: { file: "Bush_Small_Flowers.gltf", targetHeight: 0.55 },
};

const foliageWind = { value: 0 };
const bladeGeometry = new THREE.BufferGeometry();
const bladePositions: number[] = [];
for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
  const dx = -Math.sin(angle);
  const dz = Math.cos(angle);
  const lean = angle;
  bladePositions.push(
    dx * 0.12, 0, dz * 0.12,
    -dx * 0.12, 0, -dz * 0.12,
    Math.sin(lean) * 0.08, 0.62, Math.cos(lean) * 0.08
  );
}
bladeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(bladePositions, 3));
bladeGeometry.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]);
bladeGeometry.computeVertexNormals();

const bladeMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  flatShading: true,
  roughness: 1,
  side: THREE.DoubleSide,
});

export function setFoliageWindTime(time: number): void {
  foliageWind.value = time;
}

export function addFoliageWind(material: THREE.Material): void {
  if (material.userData.gieraFoliageWind) return;
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    if (!shader.vertexShader.includes("#include <begin_vertex>")) {
      throw new Error("Three.js vertex shader chunk changed; #include <begin_vertex> missing");
    }
    shader.uniforms.gieraWindTime = foliageWind;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      "#include <common>\nuniform float gieraWindTime;"
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 gieraWindOrigin = (instanceMatrix * vec4(position, 1.0)).xyz;
      #else
        vec3 gieraWindOrigin = (modelMatrix * vec4(position, 1.0)).xyz;
      #endif
      float gieraWindMask = clamp(position.y * 2.0, 0.0, 1.0);
      float gieraWind = sin(gieraWindTime * 1.2 + dot(gieraWindOrigin.xz, vec2(0.17, 0.23))) * 0.045 * gieraWindMask;
      transformed.x += gieraWind;
      transformed.z += gieraWind * 0.35;`
    );
  };
  material.customProgramCacheKey = () => `${previousCacheKey.call(material)}|giera-foliage-wind-v1`;
  material.userData.gieraFoliageWind = true;
  material.needsUpdate = true;
}

export const MAX_BLADE_RADIUS = 80;
const MIN_DECOR_RADIUS = 24;

export function decorRadiiFor(viewRadiusChunks: number): { props: number; blades: number } {
  const props = Math.max(MIN_DECOR_RADIUS, viewRadiusChunks * 16 * 0.75);
  return { props, blades: Math.max(MIN_DECOR_RADIUS, Math.min(props, MAX_BLADE_RADIUS)) };
}

export function scatterGrassBlades(seed: number, radius: number, centerX: number, centerZ: number): GrassBladeSite[] {
  const rng = makeRng(seed ^ 0x7f4a7c15);
  const sites: GrassBladeSite[] = [];
  const attempts = Math.round(radius * radius * 2);
  for (let i = 0; i < attempts; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * radius;
    sites.push({
      x: centerX + Math.cos(angle) * distance,
      z: centerZ + Math.sin(angle) * distance,
      scale: 0.7 + rng() * 0.55,
      rotation: rng() * Math.PI * 2,
    });
  }
  return sites;
}

export function createGrassBladeInstances(
  sites: GrassBladeSite[],
  seed: number,
  isGrass: (x: number, y: number, z: number) => boolean,
  surfaceAt: (x: number, z: number) => number
): THREE.InstancedMesh | null {
  const selected: { site: GrassBladeSite; y: number }[] = [];
  for (const site of sites) {
    const x = Math.floor(site.x);
    const z = Math.floor(site.z);
    const y = surfaceAt(x, z);
    if (Number.isFinite(y) && isGrass(x, y, z)) selected.push({ site, y: y + 1 });
  }
  if (selected.length === 0) return null;
  addFoliageWind(bladeMaterial);
  const mesh = new THREE.InstancedMesh(bladeGeometry, bladeMaterial, selected.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const palette = [0x8fb54d, 0x9cc85a, 0x80a943];
  for (let i = 0; i < selected.length; i++) {
    const { site, y } = selected[i];
    dummy.position.set(site.x, y, site.z);
    dummy.rotation.y = site.rotation;
    dummy.scale.setScalar(site.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    const hash = (Math.imul(Math.floor(site.x + 1024), 73856093) ^ Math.imul(Math.floor(site.z + 1024), 19349663) ^ seed) >>> 0;
    color.setHex(palette[hash % palette.length]);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  return mesh;
}

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
  const parts = await loadProp(PROP_FILES[kind].file).catch(() => [] as PropPart[]);
  if (parts.length === 0) return [];
  for (const part of parts) addFoliageWind(part.material);
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
  rawSurfaceAt: (x: number, z: number) => number,
  grassSites: GrassBladeSite[] = []
): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = "ground-decor";
  const surfaceCache = new Map<number, number>();
  const surfaceAt = (x: number, z: number): number => {
    const key = (x + 32768) * 65536 + (z + 32768);
    let y = surfaceCache.get(key);
    if (y === undefined) {
      y = rawSurfaceAt(x, z);
      surfaceCache.set(key, y);
    }
    return y;
  };
  const placed = items.flatMap((item) => {
    const y = surfaceAt(item.x, item.z);
    return Number.isFinite(y) && isGrass(item.x, y, item.z) ? [{ ...item, y: y + 1 }] : [];
  });

  const [tuftMeshes, flowerMeshes, bushMeshes] = await Promise.all([
    makePropInstances(placed, "tuft", seed),
    makePropInstances(placed, "flower", seed),
    makePropInstances(placed, "mushroom", seed),
  ]);

  const rock = makeInstances(
    placed,
    "rock",
    rockGeometry,
    rockMaterial,
    (item) => paletteColor(item, ROCK_COLORS, seed),
    0.12,
    0.7
  );
  const grass = createGrassBladeInstances(grassSites, seed, isGrass, surfaceAt);

  for (const mesh of [...tuftMeshes, ...flowerMeshes, ...bushMeshes, rock, grass]) {
    if (mesh) group.add(mesh);
  }
  return group;
}

export function disposeGroundDecor(group: THREE.Group): void {
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  group.clear();
}
