import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ChunkMesh } from "../../src/shared/mesher";
import { createChunkMeshObject, WorldRenderer } from "../../src/client/render/worldRenderer";
describe("chunk render objects", () => {
  it("uses local vertices and positions the chunk at its world origin", () => {
    const geometry: ChunkMesh = {
      positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
      normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
      uvs: Float32Array.of(0, 0, 1, 0, 0, 1),
      colors: Float32Array.of(1, 1, 1, 1, 1, 1, 1, 1, 1),
      indices: Uint32Array.of(0, 1, 2),
      groups: [{ tile: 0, start: 0, count: 3 }],
    };
    const mesh = createChunkMeshObject(geometry, { cx: 2, cy: 3, cz: -1 }, [new THREE.MeshBasicMaterial()]);
    expect(mesh.position.toArray()).toEqual([32, 48, -16]);
    expect(mesh.geometry.attributes.position.count).toBe(3);
    expect(mesh.geometry.groups).toEqual([{ start: 0, count: 3, materialIndex: 0 }]);
  });
});

describe("worldRenderer setBlock", () => {
  it("updates stored block and keeps chunk state consistent", () => {
    const scene = new THREE.Scene();
    const atlas = new THREE.Texture();
    const normal = new THREE.Texture();
    const renderer = new WorldRenderer({ scene, seed: 1234, atlasTexture: atlas, atlasNormal: new THREE.Texture(), atlasOrm: new THREE.Texture(), waterNormal: normal, workerCount: 1 });
    renderer.setBlock(0, 0, 0, 9); // planks
    expect(renderer.getBlock(0, 0, 0)).toBe(9);
    renderer.dispose();
  });
});
