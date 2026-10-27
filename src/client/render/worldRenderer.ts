import * as THREE from "three";
import { CHUNK_SIZE, CHUNK_VOLUME, chunkKey, getBlockIndex, type ChunkPosition } from "../../shared/chunk";
import { meshChunk, type ChunkMesh } from "../../shared/mesher";
import { generateBlock, surfaceHeight, WORLDGEN_VERSION } from "../../shared/worldgen";
import type { ChunkBuildRequest, ChunkBuildResponse } from "../../shared/chunk-worker-protocol";
import atlasManifest from "../../shared/atlas-manifest.json";
import { placeGroundDecor, scatterGroundDecor } from "./ground-decor";
import { BLOCK_ID } from "../../shared/blocks";

type ChunkView = { data: Uint8Array; mesh?: THREE.Mesh };
type ChunkJob = {
  taskId: number;
  coordinates: Omit<ChunkBuildRequest, "taskId">;
  resolve: (response: ChunkBuildResponse) => void;
  reject: (error: Error) => void;
};
type AtlasTile = (typeof atlasManifest.tiles)[keyof typeof atlasManifest.tiles];
const MAX_SURFACE_CHUNK_Y = 4;

export function createChunkMeshObject(data: ChunkMesh, coordinates: ChunkPosition, materials: THREE.Material[]): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  for (const group of data.groups) geometry.addGroup(group.start, group.count, group.tile);
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.position.set(coordinates.cx * CHUNK_SIZE, coordinates.cy * CHUNK_SIZE, coordinates.cz * CHUNK_SIZE);
  return mesh;
}

type OreStyle = { color: number; metalness: number; roughness: number };
const ORE_STYLES: Record<string, OreStyle> = {
  default_mineral_coal: { color: 0x333333, metalness: 0.1, roughness: 1 },
  default_mineral_iron: { color: 0xb07a5a, metalness: 0.5, roughness: 0.7 },
  default_mineral_gold: { color: 0xd4af37, metalness: 0.7, roughness: 0.45 },
};

export function createTileMaterials(
  atlasTexture: THREE.Texture,
  atlasNormal: THREE.Texture,
  atlasOrm: THREE.Texture,
  waterNormal: THREE.Texture
): THREE.Material[] {
  const materials: THREE.Material[] = [];
  const tiles = Object.entries(atlasManifest.tiles).sort(([, left], [, right]) => left.id - right.id);
  for (const [name, tile] of tiles) {
    const glass = name === "glass";
    const water = name === "water";
    const ore = ORE_STYLES[name];
    const material = new THREE.MeshStandardMaterial({
      map: atlasTexture,
      normalMap: water ? waterNormal : null,
      aoMap: water || glass ? null : atlasOrm,
      roughnessMap: water || glass ? null : atlasOrm,
      vertexColors: true,
      color: ore ? new THREE.Color(ore.color) : new THREE.Color(name === "ginkgo_leaves" ? 0x8fe070 : 0xffffff),
      roughness: water ? 0.08 : glass ? 0.05 : ore ? ore.roughness : 1,
      metalness: ore ? ore.metalness : 0,
      transparent: glass || water,
      opacity: glass ? 0.3 : water ? 0.75 : 1,
      alphaTest: 0,
      depthWrite: !glass && !water,
      envMapIntensity: water ? 1.6 : glass ? 1.2 : 1,
      side: THREE.FrontSide,
    });
    if (tile.uv.length !== 4) throw new RangeError(`Invalid atlas UV rectangle: ${name}`);
    const tileRect = new THREE.Vector4(tile.uv[0], tile.uv[1], tile.uv[2], tile.uv[3]);
    const usesAtlasNormal = !water;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.gieraTileRect = { value: tileRect };
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        "#include <common>\nvarying vec3 gieraWorldTint;\nvarying vec3 gieraWorldNormal;"
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec4 gieraWorld = modelMatrix * vec4( transformed, 1.0 );
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
        "#include <common>\nuniform vec4 gieraTileRect;\nvarying vec3 gieraWorldTint;\nvarying vec3 gieraWorldNormal;"
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
          vec2 localUv = fract( vMapUv );
          vec2 gieraTileUv = mix( gieraTileRect.xy, gieraTileRect.zw, localUv );
          vec2 gieraTileScale = gieraTileRect.zw - gieraTileRect.xy;
          vec2 gieraDx = dFdx( vMapUv ) * gieraTileScale;
          vec2 gieraDy = dFdy( vMapUv ) * gieraTileScale;
          vec4 sampledDiffuseColor = textureGrad( map, gieraTileUv, gieraDx, gieraDy );
          #ifdef DECODE_VIDEO_TEXTURE
            sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
          #endif
          sampledDiffuseColor.rgb *= gieraWorldTint;
          float gieraFacing = clamp( gieraWorldNormal.y * 0.5 + 0.5, 0.0, 1.0 );
          sampledDiffuseColor.rgb *= mix( 0.93, 1.07, gieraFacing );
          diffuseColor *= sampledDiffuseColor;
        #endif`
      );
      if (usesAtlasNormal) {
        const expand = (chunk: "normal_fragment_maps" | "roughnessmap_fragment" | "aomap_fragment", from: string, to: string): void => {
          const source = THREE.ShaderChunk[chunk];
          if (!source.includes(from)) throw new Error(`Three.js ${chunk} chunk changed; ${from} missing`);
          shader.fragmentShader = shader.fragmentShader.replace(`#include <${chunk}>`, source.replace(from, to));
        };
        expand("roughnessmap_fragment", "texture2D( roughnessMap, vRoughnessMapUv )", "textureGrad( roughnessMap, gieraTileUv, gieraDx, gieraDy )");
        expand("aomap_fragment", "texture2D( aoMap, vAoMapUv )", "textureGrad( aoMap, gieraTileUv, gieraDx, gieraDy )");
      }
    };
    material.customProgramCacheKey = () => `giera-atlas-pbr-${tile.id}-${water ? "water" : usesAtlasNormal ? "atlas" : "flat"}`;
    materials[tile.id] = material;
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
    const { promise, resolve, reject } = Promise.withResolvers<ChunkBuildResponse>();
    this.queue.push({ taskId: this.nextTaskId++, coordinates, resolve, reject });
    this.dispatch();
    return promise;
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
  private readonly waterNormal: THREE.Texture;
  private readonly seed: number;
  private readonly worldgenVersion: number;
  private readonly scene: THREE.Scene;
  private readonly onProgress?: (loaded: number, total: number) => void;
  private completed = 0;
  private readonly decor = new THREE.Group();
  private decorCenter: { x: number; z: number } | null = null;
  private decorToken = 0;

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

  updateWater(time: number): void {
    this.waterNormal.offset.set((time * 0.02) % 1, (time * 0.013) % 1);
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
        const chunk: ChunkView = { data: result.data };
        if (result.mesh.indices.length > 0) {
          chunk.mesh = createChunkMeshObject(result.mesh, position, this.materials);
          this.scene.add(chunk.mesh);
        }
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
    const center = { x: Math.round(worldX), z: Math.round(worldZ) };
    if (this.decorCenter && this.decorCenter.x === center.x && this.decorCenter.z === center.z) return;
    this.decorCenter = center;

    const token = ++this.decorToken;
    const items = scatterGroundDecor(this.seed, Math.max(24, radius * CHUNK_SIZE * 0.75), center.x, center.z);
    const surfaceAt = (x: number, z: number): number => {
      for (let y = 70; y > 30; y--) {
        const id = this.getBlock(x, y, z);
        if (id !== 0 && id !== BLOCK_ID.water) return y;
      }
      return Number.NaN;
    };
    void placeGroundDecor(
      items,
      this.seed,
      (x, y, z) => this.getBlock(x, y, z) === BLOCK_ID.grass,
      surfaceAt
    ).then((decor) => {
      if (token !== this.decorToken) return;
      this.decor.clear();
      this.decor.add(decor);
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
      chunk = { data };
      this.chunks.set(key, chunk);
    }
    const localX = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localY = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localZ = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    chunk.data[getBlockIndex(localX, localY, localZ)] = blockId;
    this.remeshChunk(cx, cy, cz);

    if (localX === 0) this.remeshChunk(cx - 1, cy, cz);
    if (localX === CHUNK_SIZE - 1) this.remeshChunk(cx + 1, cy, cz);
    if (localY === 0) this.remeshChunk(cx, cy - 1, cz);
    if (localY === CHUNK_SIZE - 1) this.remeshChunk(cx, cy + 1, cz);
    if (localZ === 0) this.remeshChunk(cx, cy, cz - 1);
    if (localZ === CHUNK_SIZE - 1) this.remeshChunk(cx, cy, cz + 1);
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
    if (meshData.indices.length > 0) {
      chunk.mesh = createChunkMeshObject(meshData, { cx, cy, cz }, this.materials);
      this.scene.add(chunk.mesh);
    }
  }

  dispose(): void {
    this.workers.dispose();
    for (const chunk of this.chunks.values()) {
      if (!chunk.mesh) continue;
      this.scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
    }
    this.chunks.clear();
    for (const material of this.materials) material.dispose();
  }

  private removeOutside(centers: { cx: number; cz: number }[], radius: number): void {
    for (const [key, chunk] of this.chunks) {
      const [cx, , cz] = key.split(",").map(Number);
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
