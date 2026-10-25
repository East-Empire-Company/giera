import * as THREE from "three";
import { CHUNK_SIZE, CHUNK_VOLUME, chunkKey, getBlockIndex, type ChunkPosition } from "../../shared/chunk";
import { meshChunk, type ChunkMesh } from "../../shared/mesher";
import { generateBlock, surfaceHeight } from "../../shared/worldgen";
import type { ChunkBuildRequest, ChunkBuildResponse } from "../../shared/chunk-worker-protocol";
import atlasManifest from "../../shared/atlas-manifest.json";

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

export function createTileMaterials(atlasTexture: THREE.Texture, waterNormal: THREE.Texture): THREE.Material[] {
  const materials: THREE.Material[] = [];
  const tiles = Object.entries(atlasManifest.tiles).sort(([, left], [, right]) => left.id - right.id);
  for (const [name, tile] of tiles) {
    const glass = name === "glass";
    const foliage = name === "ginkgo_leaves";
    const water = name === "water";
    const material = new THREE.MeshStandardMaterial({
      map: atlasTexture,
      normalMap: water ? waterNormal : null,
      vertexColors: true,
      roughness: water ? 0.35 : glass ? 0.15 : 0.92,
      metalness: 0,
      transparent: glass,
      opacity: glass ? 0.58 : 1,
      alphaTest: foliage ? 0.4 : 0,
      depthWrite: !glass,
      side: THREE.FrontSide,
    });
    if (tile.uv.length !== 4) throw new RangeError(`Invalid atlas UV rectangle: ${name}`);
    const tileRect = new THREE.Vector4(tile.uv[0], tile.uv[1], tile.uv[2], tile.uv[3]);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.gieraTileRect = { value: tileRect };
      if (foliage) {
        shader.vertexShader = shader.vertexShader.replace(
          "#include <common>",
          "#include <common>\nvarying vec3 gieraFoliageTint;"
        );
        shader.vertexShader = shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          vec3 gieraWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
          float gieraPatch = fract( sin( dot( floor( gieraWorldPosition.xz * 0.31 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
          gieraFoliageTint = mix( vec3( 0.88, 1.04, 0.90 ), vec3( 1.08, 1.0, 0.78 ), gieraPatch );`
        );
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        "#include <common>\nuniform vec4 gieraTileRect;"
      );
      if (foliage) {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <common>",
          "#include <common>\nvarying vec3 gieraFoliageTint;"
        );
      }
      if (!shader.fragmentShader.includes("#include <map_fragment>")) {
        throw new Error("Three.js map shader chunk changed; #include <map_fragment> missing");
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
          vec2 localUv = fract( vMapUv );
          vec4 sampledDiffuseColor = texture2D( map, mix( gieraTileRect.xy, gieraTileRect.zw, localUv ) );
          #ifdef DECODE_VIDEO_TEXTURE
            sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
          #endif
          ${foliage ? "sampledDiffuseColor.rgb *= gieraFoliageTint;" : ""}
          vec2 edge = abs(localUv - 0.5) * 2.0;
          float bevel = 1.0 - smoothstep(0.85, 0.98, max(edge.x, edge.y));
          sampledDiffuseColor.rgb *= (0.88 + 0.12 * bevel);
          diffuseColor *= sampledDiffuseColor;
        #endif`
      );
    };
    material.customProgramCacheKey = () => `giera-atlas-${tile.id}`;
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
  private readonly seed: number;
  private readonly scene: THREE.Scene;
  private readonly onProgress?: (loaded: number, total: number) => void;
  private completed = 0;

  constructor(options: {
    scene: THREE.Scene;
    seed: number;
    atlasTexture: THREE.Texture;
    waterNormal: THREE.Texture;
    workerCount?: number;
    onProgress?: (loaded: number, total: number) => void;
  }) {
    this.scene = options.scene;
    this.seed = options.seed;
    this.onProgress = options.onProgress;
    this.materials = createTileMaterials(options.atlasTexture, options.waterNormal);
    const workerCount = options.workerCount ?? Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 2) - 1));
    this.workers = new ChunkWorkerPool(workerCount);
  }
  get loadedChunkCount(): number {
    return this.chunks.size;
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
        const result = await this.workers.generate({ ...position, seed: this.seed });
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
  }

  getBlock(x: number, y: number, z: number): number {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cy, cz));
    if (!chunk) return generateBlock(x, y, z, this.seed);
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
            data[getBlockIndex(lx, ly, lz)] = generateBlock(cx * CHUNK_SIZE + lx, cy * CHUNK_SIZE + ly, cz * CHUNK_SIZE + lz, this.seed);
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
