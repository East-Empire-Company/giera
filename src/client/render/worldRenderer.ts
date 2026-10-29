import * as THREE from "three";
import { CHUNK_SIZE, CHUNK_VOLUME, chunkKey, getBlockIndex, type ChunkPosition } from "../../shared/chunk";
import { meshChunk, type ChunkMesh, type MeshGroup } from "../../shared/mesher";
import { TERRAIN_MATERIAL, TERRAIN_MATERIAL_COUNT, terrainMaterialFor } from "../../shared/terrain-materials";
import { generateBlock, surfaceHeight, WORLDGEN_VERSION } from "../../shared/worldgen";
import type { ChunkBuildRequest, ChunkBuildResponse } from "../../shared/chunk-worker-protocol";
import atlasManifest from "../../shared/atlas-manifest.json";
import { addFoliageWind, decorRadiiFor, disposeGroundDecor, placeGroundDecor, scatterGrassBlades, scatterGroundDecor, setFoliageWindTime } from "./ground-decor";
import { BLOCK_ID } from "../../shared/blocks";

type ChunkView = { data: Uint8Array; mesh?: THREE.Mesh; cx: number; cz: number };
type ChunkJob = {
  taskId: number;
  coordinates: Omit<ChunkBuildRequest, "taskId">;
  resolve: (response: ChunkBuildResponse) => void;
  reject: (error: Error) => void;
};
type AtlasTile = (typeof atlasManifest.tiles)[keyof typeof atlasManifest.tiles];
const MAX_SURFACE_CHUNK_Y = 4;
/** Smooth-top vertex normals read columns up to two cells away, so edits that close to a border change the neighbour chunk. */
const SMOOTH_NORMAL_REACH = 2;

export const SHADOW_CASTER_HYSTERESIS = 16;

/**
 * True when any part of the chunk's footprint lies within `range` blocks of a player, so its shadow can be seen.
 * A chunk that already casts keeps casting until it is `SHADOW_CASTER_HYSTERESIS` blocks further out.
 */
export function shadowCastsFrom(
  chunk: { cx: number; cz: number },
  origins: { x: number; z: number }[],
  range: number,
  wasCasting: boolean
): boolean {
  const limit = wasCasting ? range + SHADOW_CASTER_HYSTERESIS : range;
  const limitSq = limit * limit;
  const minX = chunk.cx * CHUNK_SIZE;
  const minZ = chunk.cz * CHUNK_SIZE;
  for (let i = 0; i < origins.length; i++) {
    const origin = origins[i];
    const dx = origin.x < minX ? minX - origin.x : origin.x > minX + CHUNK_SIZE ? origin.x - (minX + CHUNK_SIZE) : 0;
    const dz = origin.z < minZ ? minZ - origin.z : origin.z > minZ + CHUNK_SIZE ? origin.z - (minZ + CHUNK_SIZE) : 0;
    if (dx * dx + dz * dz <= limitSq) return true;
  }
  return false;
}

/** Highest non-air, non-water block in the decor scan band (y 70 down to 31), or NaN when the column has none. */
export function topSolidY(blockAt: (x: number, y: number, z: number) => number, x = 0, z = 0): number {
  for (let y = 70; y > 30; y--) {
    const id = blockAt(x, y, z);
    if (id !== 0 && id !== BLOCK_ID.water) return y;
  }
  return Number.NaN;
}

export function createChunkMeshObject(data: ChunkMesh, coordinates: ChunkPosition, materials: THREE.Material[]): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
  geometry.setAttribute("aTileId", new THREE.BufferAttribute(data.tileIds, 1));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  for (const group of mergeMaterialGroups(data.groups)) geometry.addGroup(group.start, group.count, group.material);
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.position.set(coordinates.cx * CHUNK_SIZE, coordinates.cy * CHUNK_SIZE, coordinates.cz * CHUNK_SIZE);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** The mesher orders groups by draw bucket, so adjacent same-bucket groups collapse into one draw call. */
export function mergeMaterialGroups(groups: MeshGroup[]): MeshGroup[] {
  const merged: MeshGroup[] = [];
  for (const group of groups) {
    const last = merged[merged.length - 1];
    if (last && last.material === group.material && last.start + last.count === group.start) last.count += group.count;
    else merged.push({ ...group });
  }
  return merged;
}

type OreStyle = { color: number; metalness: number; roughness: number };
const ORE_STYLES: Record<string, OreStyle> = {
  default_mineral_coal: { color: 0x333333, metalness: 0.1, roughness: 1 },
  default_mineral_iron: { color: 0xb07a5a, metalness: 0.5, roughness: 0.7 },
  default_mineral_gold: { color: 0xd4af37, metalness: 0.7, roughness: 0.45 },
};

const GRASS_BLEND_SAMPLING = `vec3 gieraTriWeights = pow(abs(normalize(gieraWorldNormal)), vec3(4.0));
        gieraTriWeights /= max(gieraTriWeights.x + gieraTriWeights.y + gieraTriWeights.z, 0.000001);
        vec2 gieraGrassUvX = gieraWorldPosition.yz;
        vec2 gieraGrassUvY = gieraWorldPosition.zx;
        vec2 gieraGrassUvZ = gieraWorldPosition.xy;
        vec2 gieraGrassTopScale = gieraGrassTopRect.zw - gieraGrassTopRect.xy;
        vec2 gieraGrassSideScale = gieraGrassSideRect.zw - gieraGrassSideRect.xy;
        vec4 gieraGrassSampleX = textureGrad( map, mix( gieraGrassSideRect.xy, gieraGrassSideRect.zw, fract( gieraGrassUvX ) ), dFdx( gieraGrassUvX ) * gieraGrassSideScale, dFdy( gieraGrassUvX ) * gieraGrassSideScale );
        vec4 gieraGrassSampleY = textureGrad( map, mix( gieraGrassTopRect.xy, gieraGrassTopRect.zw, fract( gieraGrassUvY ) ), dFdx( gieraGrassUvY ) * gieraGrassTopScale, dFdy( gieraGrassUvY ) * gieraGrassTopScale );
        vec4 gieraGrassSampleZ = textureGrad( map, mix( gieraGrassSideRect.xy, gieraGrassSideRect.zw, fract( gieraGrassUvZ ) ), dFdx( gieraGrassUvZ ) * gieraGrassSideScale, dFdy( gieraGrassUvZ ) * gieraGrassSideScale );
        sampledDiffuseColor = gieraGrassSampleX * gieraTriWeights.x + gieraGrassSampleY * gieraTriWeights.y + gieraGrassSampleZ * gieraTriWeights.z;`;
const OAK_BARK_SAMPLING = "sampledDiffuseColor = vec4( gieraOakBarkColor, 1.0 );";
const TILE_SAMPLING = "sampledDiffuseColor = textureGrad( map, gieraTileUv, gieraDx, gieraDy );";

const GRASS_TOP_RECT = rectOf("grass_top");
const GRASS_SIDE_RECT = rectOf("grass_side");
const OAK_BARK_COLOR = new THREE.Color(0xa6653e);

function rectOf(tileName: keyof typeof atlasManifest.tiles): THREE.Vector4 {
  const uv = atlasManifest.tiles[tileName].uv;
  if (uv.length !== 4) throw new RangeError(`Invalid atlas UV rectangle: ${tileName}`);
  return new THREE.Vector4(uv[0], uv[1], uv[2], uv[3]);
}

type AtlasShading =
  | { kind: "tile"; rect: THREE.Vector4; grass: boolean; oakBark: boolean }
  | { kind: "merged"; rects: THREE.Vector4[] };

function applyAtlasShading(material: THREE.MeshStandardMaterial, shading: AtlasShading): void {
  const merged = shading.kind === "merged";
  const grassBlend = merged || shading.grass;
  const oakBark = merged || shading.oakBark;
  const grassSideId = atlasManifest.tiles.grass_side.id;
  const grassTopId = atlasManifest.tiles.grass_top.id;
  const oakLogSideId = atlasManifest.tiles.oak_log_side.id;
  const sampling = merged
    ? `if ( gieraTileIndex == ${grassSideId} || gieraTileIndex == ${grassTopId} ) {
            ${GRASS_BLEND_SAMPLING}
          } else if ( gieraTileIndex == ${oakLogSideId} ) {
            ${OAK_BARK_SAMPLING}
          } else {
            ${TILE_SAMPLING}
          }`
    : shading.grass
      ? GRASS_BLEND_SAMPLING
      : shading.oakBark
        ? OAK_BARK_SAMPLING
        : TILE_SAMPLING;
  const prologue = merged
    ? `int gieraTileIndex = int( gieraTileId + 0.5 );
          vec4 gieraTileRect = gieraTileRects[ gieraTileIndex ];`
    : "";
  material.onBeforeCompile = (shader) => {
    if (merged) shader.uniforms.gieraTileRects = { value: shading.rects };
    else shader.uniforms.gieraTileRect = { value: shading.rect };
    if (grassBlend) {
      shader.uniforms.gieraGrassTopRect = { value: GRASS_TOP_RECT };
      shader.uniforms.gieraGrassSideRect = { value: GRASS_SIDE_RECT };
    }
    if (oakBark) shader.uniforms.gieraOakBarkColor = { value: OAK_BARK_COLOR };
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
      ${merged ? "attribute float aTileId;\nvarying float gieraTileId;" : ""}
      varying vec3 gieraWorldTint;
      varying vec3 gieraWorldNormal;
      varying vec3 gieraWorldPosition;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      ${merged ? "gieraTileId = aTileId;" : ""}
      vec4 gieraWorld = modelMatrix * vec4( transformed, 1.0 );
      gieraWorldPosition = gieraWorld.xyz;
      float gieraCell = fract( sin( dot( floor( gieraWorld.xz * 0.37 ), vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
      float gieraBroad = fract( sin( dot( floor( gieraWorld.xz * 0.09 ), vec2( 269.5, 183.3 ) ) ) * 24634.6345 );
      float gieraVariation = ( gieraCell - 0.5 ) * 0.16 + ( gieraBroad - 0.5 ) * 0.22;
      gieraWorldTint = vec3( 1.0 + gieraVariation * 0.85, 1.0 + gieraVariation, 1.0 + gieraVariation * 0.55 );
      gieraWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );`
    );
    if (!shader.fragmentShader.includes("#include <map_fragment>")) {
      throw new Error("Three.js map shader chunk changed; #include <map_fragment> missing");
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
      ${merged ? `uniform vec4 gieraTileRects[${shading.rects.length}];\nvarying float gieraTileId;` : "uniform vec4 gieraTileRect;"}
      ${grassBlend ? "uniform vec4 gieraGrassTopRect;\nuniform vec4 gieraGrassSideRect;" : ""}
      ${oakBark ? "uniform vec3 gieraOakBarkColor;" : ""}
      varying vec3 gieraWorldTint;
      varying vec3 gieraWorldNormal;
      varying vec3 gieraWorldPosition;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#ifdef USE_MAP
        ${prologue}
        vec4 sampledDiffuseColor;
        vec2 localUv = fract( vMapUv );
        vec2 gieraTileUv = mix( gieraTileRect.xy, gieraTileRect.zw, localUv );
        vec2 gieraTileScale = gieraTileRect.zw - gieraTileRect.xy;
        vec2 gieraDx = dFdx( vMapUv ) * gieraTileScale;
        vec2 gieraDy = dFdy( vMapUv ) * gieraTileScale;
        ${sampling}
        #ifdef DECODE_VIDEO_TEXTURE
          sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
        #endif
        sampledDiffuseColor.rgb *= gieraWorldTint;
        float gieraFacing = clamp( gieraWorldNormal.y * 0.5 + 0.5, 0.0, 1.0 );
        sampledDiffuseColor.rgb *= mix( 0.93, 1.07, gieraFacing );
        diffuseColor *= sampledDiffuseColor;
      #endif`
    );
    if (material.roughnessMap) {
      const expand = (chunk: "normal_fragment_maps" | "roughnessmap_fragment" | "aomap_fragment", from: string, to: string): void => {
        const source = THREE.ShaderChunk[chunk];
        if (!source.includes(from)) throw new Error(`Three.js ${chunk} chunk changed; ${from} missing`);
        shader.fragmentShader = shader.fragmentShader.replace(`#include <${chunk}>`, source.replace(from, to));
      };
      expand("roughnessmap_fragment", "texture2D( roughnessMap, vRoughnessMapUv )", "textureGrad( roughnessMap, gieraTileUv, gieraDx, gieraDy )");
      expand("aomap_fragment", "texture2D( aoMap, vAoMapUv )", "textureGrad( aoMap, gieraTileUv, gieraDx, gieraDy )");
    }
  };
}

function createAtlasMaterial(options: {
  atlasTexture: THREE.Texture;
  atlasNormal: THREE.Texture;
  atlasOrm: THREE.Texture;
  shading: AtlasShading;
  cacheKey: string;
  normalMap?: THREE.Texture;
  ormMaps?: boolean;
  color?: number;
  roughness?: number;
  metalness?: number;
  transparent?: boolean;
  opacity?: number;
  envMapIntensity?: number;
}): THREE.MeshStandardMaterial {
  const ormMaps = options.ormMaps ?? true;
  const transparent = options.transparent ?? false;
  const material = new THREE.MeshStandardMaterial({
    map: options.atlasTexture,
    normalMap: options.normalMap ?? (ormMaps ? options.atlasNormal : null),
    aoMap: ormMaps ? options.atlasOrm : null,
    roughnessMap: ormMaps ? options.atlasOrm : null,
    vertexColors: true,
    color: new THREE.Color(options.color ?? 0xffffff),
    roughness: options.roughness ?? 1,
    metalness: options.metalness ?? 0,
    transparent,
    opacity: options.opacity ?? 1,
    alphaTest: 0,
    depthWrite: !transparent,
    envMapIntensity: options.envMapIntensity ?? 1,
    side: THREE.FrontSide,
  });
  applyAtlasShading(material, options.shading);
  material.customProgramCacheKey = () => options.cacheKey;
  return material;
}

export function createTileMaterials(
  atlasTexture: THREE.Texture,
  atlasNormal: THREE.Texture,
  atlasOrm: THREE.Texture,
  waterNormal: THREE.Texture
): THREE.Material[] {
  const materials: THREE.Material[] = [];
  for (const [name, tile] of Object.entries(atlasManifest.tiles)) {
    const rect = rectOf(name as keyof typeof atlasManifest.tiles);
    const water = name === "water";
    const glass = name === "glass";
    const ore = ORE_STYLES[name];
    const material = createAtlasMaterial({
      atlasTexture,
      atlasNormal,
      atlasOrm,
      normalMap: water ? waterNormal : undefined,
      ormMaps: !water && !glass,
      shading: { kind: "tile", rect, grass: name === "grass_top" || name === "grass_side", oakBark: name === "oak_log_side" },
      color: ore ? ore.color : name === "ginkgo_leaves" ? 0x8fe070 : 0xffffff,
      roughness: water ? 0.08 : glass ? 0.05 : ore ? ore.roughness : 1,
      metalness: ore ? ore.metalness : 0,
      transparent: water || glass,
      opacity: glass ? 0.3 : water ? 0.75 : 1,
      envMapIntensity: water ? 1.6 : glass ? 1.2 : 1,
      cacheKey: `giera-atlas-pbr-${tile.id}-${water ? "water" : glass ? "flat" : "atlas"}`,
    });
    if (name === "ginkgo_leaves") addFoliageWind(material);
    materials[tile.id] = material;
  }
  return materials;
}

/** Every opaque tile in one material: the atlas rectangle rides on the per-vertex `aTileId` attribute. */
export function createMergedTileMaterial(atlasTexture: THREE.Texture, atlasNormal: THREE.Texture, atlasOrm: THREE.Texture): THREE.MeshStandardMaterial {
  const tiles = Object.values(atlasManifest.tiles);
  const rects = new Array<THREE.Vector4>(Math.max(...tiles.map((tile) => tile.id)) + 1);
  for (const tile of tiles) {
    if (tile.uv.length !== 4) throw new RangeError(`Invalid atlas UV rectangle at id ${tile.id}`);
    rects[tile.id] = new THREE.Vector4(tile.uv[0], tile.uv[1], tile.uv[2], tile.uv[3]);
  }
  return createAtlasMaterial({
    atlasTexture,
    atlasNormal,
    atlasOrm,
    shading: { kind: "merged", rects },
    cacheKey: "giera-atlas-pbr-merged",
  });
}

export function createChunkMaterials(tileMaterials: THREE.Material[], merged: THREE.Material): THREE.Material[] {
  const materials: THREE.Material[] = new Array(TERRAIN_MATERIAL_COUNT);
  materials[TERRAIN_MATERIAL.opaque] = merged;
  for (const [name, tile] of Object.entries(atlasManifest.tiles)) {
    const bucket = terrainMaterialFor(name);
    if (bucket !== TERRAIN_MATERIAL.opaque) materials[bucket] = tileMaterials[tile.id];
  }
  return materials;
}

class ChunkWorkerPool {
  private readonly workers: Worker[];
  private readonly busy = new Map<Worker, ChunkJob>();
  private readonly queue: ChunkJob[] = [];
  private nextTaskId = 1;

  constructor(size: number) {
    this.workers = typeof Worker !== "undefined" ? Array.from({ length: size }, () => new Worker(new URL("../workers/chunk.worker.ts", import.meta.url), { type: "module" })) : [];
    for (const worker of this.workers) {
      worker.onmessage = (event: MessageEvent<ChunkBuildResponse>) => {
        const job = this.busy.get(worker);
        if (!job) return;
        this.busy.delete(worker);
        if ("error" in event.data) job.reject(new Error(event.data.error));
        else job.resolve(event.data);
        this.dispatch();
      };
      worker.onerror = () => {
        const job = this.busy.get(worker);
        if (job) {
          this.busy.delete(worker);
          job.reject(new Error("Chunk worker failed"));
        }
        this.dispatch();
      };
    }
  }

  generate(coordinates: Omit<ChunkBuildRequest, "taskId">): Promise<ChunkBuildResponse> {
    return new Promise<ChunkBuildResponse>((resolve, reject) => {
      this.queue.push({ taskId: this.nextTaskId++, coordinates, resolve, reject });
      this.dispatch();
    });
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    for (const job of this.queue) job.reject(new Error("Chunk worker pool disposed"));
    for (const job of this.busy.values()) job.reject(new Error("Chunk worker pool disposed"));
    this.queue.length = 0;
    this.busy.clear();
  }

  private dispatch(): void {
    for (const worker of this.workers) {
      if (this.busy.has(worker)) continue;
      const job = this.queue.shift();
      if (!job) return;
      this.busy.set(worker, job);
      worker.postMessage({ ...job.coordinates, taskId: job.taskId });
    }
  }
}

export class WorldRenderer {
  private readonly chunks = new Map<string, ChunkView>();
  private readonly pending = new Set<string>();
  private readonly workers: ChunkWorkerPool;
  private readonly materials: THREE.Material[];
  private readonly chunkMaterials: THREE.Material[];
  private readonly waterNormal: THREE.Texture;
  private readonly seed: number;
  private readonly worldgenVersion: number;
  private readonly scene: THREE.Scene;
  private readonly onProgress?: (loaded: number, total: number) => void;
  private completed = 0;
  private readonly decor = new THREE.Group();
  private decorCenter: { x: number; z: number } | null = null;
  private decorToken = 0;
  private shadowMaterialRegistrar: ((material: THREE.Material) => void) | null = null;
  private shadowOrigins: { x: number; z: number }[] | null = null;
  private shadowRange = 0;

  constructor(options: {
    scene: THREE.Scene;
    seed: number;
    worldgenVersion?: number;
    atlasTexture: THREE.Texture;
    atlasNormal: THREE.Texture;
    atlasOrm: THREE.Texture;
    waterNormal: THREE.Texture;
    workerCount?: number;
    onProgress?: (loaded: number, total: number) => void;
  }) {
    this.scene = options.scene;
    this.decor.name = "ground-decor";
    this.scene.add(this.decor);
    this.seed = options.seed;
    this.worldgenVersion = options.worldgenVersion ?? WORLDGEN_VERSION;
    this.onProgress = options.onProgress;
    this.materials = createTileMaterials(options.atlasTexture, options.atlasNormal, options.atlasOrm, options.waterNormal);
    this.chunkMaterials = createChunkMaterials(this.materials, createMergedTileMaterial(options.atlasTexture, options.atlasNormal, options.atlasOrm));
    this.waterNormal = options.waterNormal;
    const workerCount = options.workerCount ?? Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 2) - 1));
    this.workers = new ChunkWorkerPool(workerCount);
  }
  get loadedChunkCount(): number {
    return this.chunks.size;
  }

  getTileMaterial(tileName: string): THREE.Material | undefined {
    const tile = atlasManifest.tiles[tileName as keyof typeof atlasManifest.tiles];
    return tile ? this.materials[tile.id] : undefined;
  }

  registerShadowMaterials(register: (material: THREE.Material) => void): void {
    this.shadowMaterialRegistrar = register;
    for (const material of this.materials) register(material);
    for (const material of this.chunkMaterials) register(material);
    this.registerObjectMaterials(this.decor);
  }

  private registerObjectMaterials(root: THREE.Object3D): void {
    const register = this.shadowMaterialRegistrar;
    if (!register) return;
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) register(material);
    });
  }

  updateWater(time: number): void {
    this.waterNormal.offset.set((time * 0.02) % 1, (time * 0.013) % 1);
    setFoliageWindTime(time);
  }

  async loadArea(worldX: number, worldZ: number, radius: number, otherCenters?: { worldX: number; worldZ: number }[]): Promise<void> {
    const centerX = Math.floor(worldX / CHUNK_SIZE);
    const centerZ = Math.floor(worldZ / CHUNK_SIZE);
    const topY = Math.floor(surfaceHeight(worldX, worldZ, this.seed) / CHUNK_SIZE);
    const positions: ChunkPosition[] = [];
    for (let cz = centerZ - radius; cz <= centerZ + radius; cz++) {
      for (let cx = centerX - radius; cx <= centerX + radius; cx++) {
        const dx = cx - centerX;
        const dz = cz - centerZ;
        if (dx * dx + dz * dz > radius * radius) continue;
        for (let cy = 0; cy <= MAX_SURFACE_CHUNK_Y; cy++) positions.push({ cx, cy, cz });
      }
    }
    positions.sort((left, right) => {
      const leftDistance = (left.cx - centerX) ** 2 + (left.cz - centerZ) ** 2 + Math.abs(left.cy - topY) * 0.5;
      const rightDistance = (right.cx - centerX) ** 2 + (right.cz - centerZ) ** 2 + Math.abs(right.cy - topY) * 0.5;
      return leftDistance - rightDistance;
    });
    const required = positions.filter((position) => {
      const key = chunkKey(position.cx, position.cy, position.cz);
      if (this.chunks.has(key) || this.pending.has(key)) return false;
      this.pending.add(key);
      return true;
    });
    let loaded = 0;
    await Promise.all(required.map(async (position) => {
      const key = chunkKey(position.cx, position.cy, position.cz);
      try {
        const result = await this.workers.generate({ ...position, seed: this.seed, worldgenVersion: this.worldgenVersion });
        if ("error" in result) throw new Error(result.error);
        const chunk: ChunkView = { data: result.data, cx: position.cx, cz: position.cz };
        if (result.mesh.indices.length > 0) this.attachChunkMesh(chunk, result.mesh, position);
        this.chunks.set(key, chunk);
      } finally {
        this.pending.delete(key);
        loaded++;
        this.completed++;
        this.onProgress?.(this.completed, positions.length);
      }
    }));
    const allCenters = [
      { cx: centerX, cz: centerZ },
      ...(otherCenters ?? []).map((c) => ({ cx: Math.floor(c.worldX / CHUNK_SIZE), cz: Math.floor(c.worldZ / CHUNK_SIZE) })),
    ];
    this.removeOutside(allCenters, radius + 1);
    this.refreshGroundDecor(worldX, worldZ, radius);
  }

  private refreshGroundDecor(worldX: number, worldZ: number, radius: number): void {
    const center = { x: Math.round(worldX / 8) * 8, z: Math.round(worldZ / 8) * 8 };
    if (this.decorCenter && this.decorCenter.x === center.x && this.decorCenter.z === center.z) return;
    this.decorCenter = center;

    const token = ++this.decorToken;
    const radii = decorRadiiFor(radius);
    const items = scatterGroundDecor(this.seed, radii.props, center.x, center.z);
    const grassSites = scatterGrassBlades(this.seed, radii.blades, center.x, center.z);
    const surfaceAt = (x: number, z: number): number => this.surfaceColumnTop(x, z);
    void placeGroundDecor(
      items,
      this.seed,
      (x, y, z) => this.getBlock(x, y, z) === BLOCK_ID.grass,
      surfaceAt,
      grassSites
    ).then((decor) => {
      if (token !== this.decorToken) {
        disposeGroundDecor(decor);
        return;
      }
      const previous = this.decor.children[0];
      this.decor.clear();
      if (previous instanceof THREE.Group) disposeGroundDecor(previous);
      this.decor.add(decor);
      this.registerObjectMaterials(decor);
    });
  }

  getBlock(x: number, y: number, z: number): number {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cy, cz));
    if (!chunk) return generateBlock(x, y, z, this.seed, this.worldgenVersion);
    const localX = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localY = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localZ = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.data[getBlockIndex(localX, localY, localZ)];
  }

  /** Same result as `topSolidY(getBlock)`, but looks each vertical chunk up once instead of once per block. */
  surfaceColumnTop(x: number, z: number): number {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const localX = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localZ = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    let cachedCy = Number.NaN;
    let cachedData: Uint8Array | undefined;
    for (let y = 70; y > 30; y--) {
      const cy = Math.floor(y / CHUNK_SIZE);
      if (cy !== cachedCy) {
        cachedCy = cy;
        cachedData = this.chunks.get(chunkKey(cx, cy, cz))?.data;
      }
      const id = cachedData
        ? cachedData[getBlockIndex(localX, ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE, localZ)]
        : generateBlock(x, y, z, this.seed, this.worldgenVersion);
      if (id !== 0 && id !== BLOCK_ID.water) return y;
    }
    return Number.NaN;
  }

  setBlock(x: number, y: number, z: number, blockId: number): void {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = chunkKey(cx, cy, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      const data = new Uint8Array(CHUNK_VOLUME);
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            data[getBlockIndex(lx, ly, lz)] = generateBlock(cx * CHUNK_SIZE + lx, cy * CHUNK_SIZE + ly, cz * CHUNK_SIZE + lz, this.seed, this.worldgenVersion);
          }
        }
      }
      chunk = { data, cx, cz };
      this.chunks.set(key, chunk);
    }
    const localX = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localY = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localZ = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    chunk.data[getBlockIndex(localX, localY, localZ)] = blockId;
    this.remeshChunk(cx, cy, cz);

    if (localX < SMOOTH_NORMAL_REACH) this.remeshChunk(cx - 1, cy, cz);
    if (localX >= CHUNK_SIZE - SMOOTH_NORMAL_REACH) this.remeshChunk(cx + 1, cy, cz);
    if (localY < SMOOTH_NORMAL_REACH) this.remeshChunk(cx, cy - 1, cz);
    if (localY >= CHUNK_SIZE - SMOOTH_NORMAL_REACH) this.remeshChunk(cx, cy + 1, cz);
    if (localZ < SMOOTH_NORMAL_REACH) this.remeshChunk(cx, cy, cz - 1);
    if (localZ >= CHUNK_SIZE - SMOOTH_NORMAL_REACH) this.remeshChunk(cx, cy, cz + 1);
  }

  remeshChunk(cx: number, cy: number, cz: number): void {
    const chunk = this.chunks.get(chunkKey(cx, cy, cz));
    if (!chunk) return;
    const meshData = meshChunk({
      data: chunk.data,
      cx,
      cy,
      cz,
      getBlock: (wx, wy, wz) => this.getBlock(wx, wy, wz),
      atlas: atlasManifest.tiles,
    });
    if (chunk.mesh) {
      this.scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunk.mesh = undefined;
    }
    if (meshData.indices.length > 0) this.attachChunkMesh(chunk, meshData, { cx, cy, cz });
  }

  private attachChunkMesh(chunk: ChunkView, meshData: ChunkMesh, position: ChunkPosition): void {
    const mesh = createChunkMeshObject(meshData, position, this.chunkMaterials);
    mesh.castShadow = this.shadowOrigins === null || shadowCastsFrom(position, this.shadowOrigins, this.shadowRange, false);
    chunk.mesh = mesh;
    this.scene.add(mesh);
  }

  updateShadowCasters(origins: { x: number; z: number }[], range: number): void {
    this.shadowOrigins = origins;
    this.shadowRange = range;
    for (const chunk of this.chunks.values()) {
      if (!chunk.mesh) continue;
      chunk.mesh.castShadow = shadowCastsFrom(chunk, origins, range, chunk.mesh.castShadow);
    }
  }

  dispose(): void {
    this.decorToken++;
    for (const child of this.decor.children) {
      if (child instanceof THREE.Group) disposeGroundDecor(child);
    }
    this.decor.clear();
    this.scene.remove(this.decor);
    this.workers.dispose();
    for (const chunk of this.chunks.values()) {
      if (!chunk.mesh) continue;
      this.scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
    }
    this.chunks.clear();
    for (const material of new Set([...this.materials, ...this.chunkMaterials])) material.dispose();
  }


  private removeOutside(centers: { cx: number; cz: number }[], radius: number): void {
    for (const [key, chunk] of this.chunks) {
      const { cx, cz } = chunk;
      const isNearAny = centers.some((c) => (cx - c.cx) ** 2 + (cz - c.cz) ** 2 <= radius * radius);
      if (isNearAny) continue;
      if (chunk.mesh) {
        this.scene.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
      }
      this.chunks.delete(key);
    }
  }
}
