import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ChunkMesh } from "../../src/shared/mesher";
import { createChunkMeshObject, createMergedTileMaterial, createTileMaterials, shadowCastsFrom, topSolidY, WorldRenderer } from "../../src/client/render/worldRenderer";
import atlasManifest from "../../src/shared/atlas-manifest.json";
import { BLOCK_ID } from "../../src/shared/blocks";
import { TERRAIN_MATERIAL } from "../../src/shared/terrain-materials";
import { MAX_GENERATED_BLOCK_Y, surfaceHeight } from "../../src/shared/worldgen";

describe("merged atlas shader", () => {
  it("binds every atlas rectangle before shader compilation", () => {
    const material = createMergedTileMaterial(new THREE.Texture(), new THREE.Texture(), new THREE.Texture());
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "#include <common>\n#include <begin_vertex>",
      fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <aomap_fragment>",
    } as Parameters<THREE.Material["onBeforeCompile"]>[0];

    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

    const rects = shader.uniforms.gieraTileRects?.value as THREE.Vector4[];
    const stone = atlasManifest.tiles.stone;
    expect(rects[stone.id].toArray()).toEqual(stone.uv);
    expect(rects[atlasManifest.tiles.water.id].toArray()).toEqual(atlasManifest.tiles.water.uv);
    expect(shader.vertexShader).toContain("attribute float aTileId");
    expect(shader.fragmentShader).toContain(`uniform vec4 gieraTileRects[${rects.length}]`);
  });
  it("samples terrain and foliage normal maps from their atlas tiles", () => {
    const materials = [
      createMergedTileMaterial(new THREE.Texture(), new THREE.Texture(), new THREE.Texture()),
      createTileMaterials(new THREE.Texture(), new THREE.Texture(), new THREE.Texture(), new THREE.Texture())[atlasManifest.tiles.ginkgo_leaves.id],
    ];

    for (const material of materials) {
      const shader = {
        uniforms: {} as Record<string, { value: unknown }>,
        vertexShader: "#include <common>\n#include <begin_vertex>",
        fragmentShader: "#include <common>\n#include <map_fragment>\n#include <normal_fragment_maps>\n#include <roughnessmap_fragment>\n#include <aomap_fragment>",
      } as Parameters<THREE.Material["onBeforeCompile"]>[0];
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

      expect(shader.fragmentShader).toContain("textureGrad( normalMap, gieraTileUv, gieraDx, gieraDy )");
      expect(shader.fragmentShader).not.toContain("texture2D( normalMap, vNormalMapUv )");
    }
  });

});
describe("leaf atlas material", () => {
  it("discards transparent leaf texels", () => {
    const leaves = createTileMaterials(new THREE.Texture(), new THREE.Texture(), new THREE.Texture(), new THREE.Texture())[atlasManifest.tiles.ginkgo_leaves.id] as THREE.MeshStandardMaterial;
    expect(leaves.alphaTest).toBeGreaterThan(0);
  });
});

describe("chunk render objects", () => {
  const quad = (base: number): number[] => [base, base + 1, base + 2, base, base + 2, base + 3];
  const tileIds = (id: number): number[] => Array.from({ length: 4 }, () => id);
  const chunkMesh = (groups: ChunkMesh["groups"]): ChunkMesh => ({
    positions: Float32Array.from({ length: 36 }, (_, index) => index % 3),
    normals: Float32Array.from({ length: 36 }, () => 1),
    uvs: Float32Array.from({ length: 24 }, (_, index) => index % 2),
    colors: Float32Array.from({ length: 36 }, () => 1),
    tileIds: Float32Array.from([
      ...tileIds(atlasManifest.tiles.stone.id),
      ...tileIds(atlasManifest.tiles.dirt.id),
      ...tileIds(atlasManifest.tiles.ginkgo_leaves.id),
    ]),
    indices: Uint32Array.from([...quad(0), ...quad(4), ...quad(8)]),
    groups,
  });

  it("uses local vertices and positions the chunk at its world origin", () => {
    const geometry = chunkMesh([{ tile: atlasManifest.tiles.stone.id, material: TERRAIN_MATERIAL.opaque, start: 0, count: 18 }]);
    const mesh = createChunkMeshObject(geometry, { cx: 2, cy: 3, cz: -1 }, [new THREE.MeshBasicMaterial()]);
    expect(mesh.position.toArray()).toEqual([32, 48, -16]);
    expect(mesh.geometry.attributes.position.count).toBe(12);
    expect(mesh.geometry.groups).toEqual([{ start: 0, count: 18, materialIndex: TERRAIN_MATERIAL.opaque }]);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
  });

  it("draws adjacent opaque tiles in a single merged group", () => {
    const geometry = chunkMesh([
      { tile: atlasManifest.tiles.stone.id, material: TERRAIN_MATERIAL.opaque, start: 0, count: 6 },
      { tile: atlasManifest.tiles.dirt.id, material: TERRAIN_MATERIAL.opaque, start: 6, count: 6 },
      { tile: atlasManifest.tiles.ginkgo_leaves.id, material: TERRAIN_MATERIAL.leaves, start: 12, count: 6 },
    ]);
    const mesh = createChunkMeshObject(geometry, { cx: 0, cy: 0, cz: 0 }, []);
    expect(mesh.geometry.groups).toEqual([
      { start: 0, count: 12, materialIndex: TERRAIN_MATERIAL.opaque },
      { start: 12, count: 6, materialIndex: TERRAIN_MATERIAL.leaves },
    ]);
    expect(Array.from(mesh.geometry.attributes.aTileId.array)).toEqual(Array.from(geometry.tileIds));
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

describe("worldRenderer edit ledger", () => {
  const buildWorld = (): WorldRenderer =>
    new WorldRenderer({
      scene: new THREE.Scene(),
      seed: 1234,
      atlasTexture: new THREE.Texture(),
      atlasNormal: new THREE.Texture(),
      atlasOrm: new THREE.Texture(),
      waterNormal: new THREE.Texture(),
      workerCount: 1,
    });

  it("records every edit for persistence", () => {
    const world = buildWorld();
    world.setBlock(1, 2, 3, 9);
    world.setBlock(1, 2, 3, 10);
    expect(world.exportEdits()).toEqual({ "1,2,3": 10 });
    world.dispose();
  });

  it("restores saved edits into chunks created later", () => {
    const world = buildWorld();
    world.applySavedEdits({ seed: 1234, edits: { "4,5,6": 10 } });
    world.setBlock(0, 0, 0, 9);
    expect(world.getBlock(4, 5, 6)).toBe(10);
    world.dispose();
  });

  it("restores saved edits into already loaded chunks", () => {
    const world = buildWorld();
    world.setBlock(0, 0, 0, 9);
    world.applySavedEdits({ seed: 1234, edits: { "4,5,6": 10 } });
    expect(world.getBlock(4, 5, 6)).toBe(10);
    expect(world.exportEdits()).toEqual({ "0,0,0": 9, "4,5,6": 10 });
    world.dispose();
  });

  it("ignores malformed saved edit keys", () => {
    const world = buildWorld();
    world.applySavedEdits({ seed: 1234, edits: { "4,5": 10, "x,y,z": 10, "1,2,3": 10 } });
    expect(world.exportEdits()).toEqual({ "1,2,3": 10 });
    world.dispose();
  });

  it("ignores edits saved under another world seed", () => {
    const world = buildWorld();
    world.applySavedEdits({ seed: 999, edits: { "1,2,3": 10 } });
    expect(world.exportEdits()).toEqual({});
    expect(world.getBlock(1, 2, 3)).not.toBe(10);
    world.dispose();
  });

  it("keeps LAN edits out of the saved game", () => {
    const world = buildWorld();
    world.setBlock(1, 2, 3, 10, false);
    expect(world.getBlock(1, 2, 3)).toBe(10);
    expect(world.exportEdits()).toEqual({});
    world.dispose();
  });

  it("saves mined air blocks", () => {
    const world = buildWorld();
    world.setBlock(1, 2, 3, 0);
    expect(world.exportEdits()).toEqual({ "1,2,3": 0 });
    world.dispose();
  });

  it("keeps local edits persisted when the LAN server echoes them back", () => {
    const world = buildWorld();
    world.setBlock(1, 2, 3, 10);
    world.setBlock(1, 2, 3, 10, false);
    expect(world.exportEdits()).toEqual({ "1,2,3": 10 });
    world.dispose();
  });
});

describe("worldRenderer smooth-normal neighbour remesh", () => {
  const SEED = 1234;
  const BORDER_Z = 8;

  const buildWorld = (scene: THREE.Scene): WorldRenderer => {
    const world = new WorldRenderer({
      scene,
      seed: SEED,
      atlasTexture: new THREE.Texture(),
      atlasNormal: new THREE.Texture(),
      atlasOrm: new THREE.Texture(),
      waterNormal: new THREE.Texture(),
      workerCount: 1,
    });
    world.setBlock(0, surfaceHeight(0, 0, SEED), 0, BLOCK_ID.grass);
    world.setBlock(16, surfaceHeight(16, 0, SEED), 0, BLOCK_ID.grass);
    return world;
  };

  const borderNormals = (scene: THREE.Scene, surfaceChunkY: number): string[] => {
    const mesh = scene.children.find(
      (child): child is THREE.Mesh =>
        child instanceof THREE.Mesh && child.position.x === 16 && child.position.y === surfaceChunkY * 16 && child.position.z === 0
    );
    expect(mesh).toBeDefined();
    const positions = mesh!.geometry.attributes.position;
    const normals = mesh!.geometry.attributes.normal;
    const rows: string[] = [];
    for (let i = 0; i < positions.count; i++) {
      if (positions.getX(i) !== 0 || normals.getY(i) <= 0.5) continue;
      rows.push(
        `${positions.getY(i).toFixed(3)},${positions.getZ(i)}|${[normals.getX(i), normals.getY(i), normals.getZ(i)].map((v) => v.toFixed(4)).join(",")}`
      );
    }
    return rows.sort();
  };

  it("remeshes the neighbour chunk for an edit two columns inside the shared border", () => {
    const top = surfaceHeight(14, BORDER_Z, SEED);
    const chunkY = Math.floor(top / 16);

    const editedScene = new THREE.Scene();
    const edited = buildWorld(editedScene);
    edited.setBlock(14, top + 1, BORDER_Z, BLOCK_ID.grass);

    const referenceScene = new THREE.Scene();
    const reference = buildWorld(referenceScene);
    reference.setBlock(14, top + 1, BORDER_Z, BLOCK_ID.grass);
    reference.remeshChunk(1, chunkY, 0);

    expect(borderNormals(referenceScene, chunkY).length).toBeGreaterThan(0);
    expect(borderNormals(editedScene, chunkY)).toEqual(borderNormals(referenceScene, chunkY));
    edited.dispose();
    reference.dispose();
  });
});

describe("terrain shadow caster range", () => {
  const origins = [{ x: 0, z: 0 }];

  it("casts for chunks that reach into range of a player", () => {
    expect(shadowCastsFrom({ cx: 1, cz: 1 }, origins, 80, false)).toBe(true);
  });

  it("does not cast for chunks beyond range of every player", () => {
    expect(shadowCastsFrom({ cx: 20, cz: 0 }, origins, 80, false)).toBe(false);
  });

  it("casts when any one of several players is in range, so split-screen P2 keeps shadows", () => {
    const both = [{ x: 0, z: 0 }, { x: 400, z: 0 }];
    expect(shadowCastsFrom({ cx: 25, cz: 0 }, both, 80, false)).toBe(true);
    expect(shadowCastsFrom({ cx: 12, cz: 0 }, both, 80, false)).toBe(false);
  });

  it("measures to the nearest edge of the chunk, so a chunk whose near edge is in range casts", () => {
    const player = [{ x: 0, z: 8 }];
    expect(shadowCastsFrom({ cx: 5, cz: 0 }, player, 80, false)).toBe(true);
    expect(shadowCastsFrom({ cx: 5, cz: 0 }, player, 79.9, false)).toBe(false);
  });

  it("treats a player standing inside a chunk as distance zero", () => {
    expect(shadowCastsFrom({ cx: 0, cz: 0 }, [{ x: 8, z: 8 }], 1, false)).toBe(true);
  });

  it("keeps an already-casting chunk casting until it is clearly out of range (hysteresis)", () => {
    const player = [{ x: 0, z: 8 }];
    expect(shadowCastsFrom({ cx: 5, cz: 0 }, player, 79.9, false)).toBe(false);
    expect(shadowCastsFrom({ cx: 5, cz: 0 }, player, 79.9, true)).toBe(true);
    expect(shadowCastsFrom({ cx: 7, cz: 0 }, player, 80, true)).toBe(false);
  });
});

describe("topSolidY", () => {
  const column = (blocks: Record<number, number>) => (_x: number, y: number, _z: number): number => blocks[y] ?? 0;

  it("returns the highest non-air, non-water block between y=70 and y=31", () => {
    expect(topSolidY(column({ 55: BLOCK_ID.grass, 54: BLOCK_ID.dirt }))).toBe(55);
  });

  it("skips water and keeps scanning down to the seabed", () => {
    expect(topSolidY(column({ 60: BLOCK_ID.water, 59: BLOCK_ID.water, 58: BLOCK_ID.sand }))).toBe(58);
  });

  it("lands on a tree crown above the ground, because that is what the player sees", () => {
    expect(topSolidY(column({ 62: BLOCK_ID.oak_leaves, 55: BLOCK_ID.grass }))).toBe(62);
  });

  it("returns NaN when the column has nothing solid in range", () => {
    expect(topSolidY(column({}))).toBeNaN();
    expect(topSolidY(column({ 20: BLOCK_ID.stone }))).toBeNaN();
  });

  it("never reads below y=31 or above generated block height", () => {
    const seen: number[] = [];
    topSolidY((_x, y) => {
      seen.push(y);
      return 0;
    });
    expect(Math.min(...seen)).toBe(31);
    expect(Math.max(...seen)).toBe(MAX_GENERATED_BLOCK_Y);
  });
});

describe("WorldRenderer.surfaceColumnTop", () => {
  const build = (): WorldRenderer =>
    new WorldRenderer({
      scene: new THREE.Scene(),
      seed: 1234,
      atlasTexture: new THREE.Texture(),
      atlasNormal: new THREE.Texture(),
      atlasOrm: new THREE.Texture(),
      waterNormal: new THREE.Texture(),
      workerCount: 1,
    });

  it("agrees with the generic scan for generated terrain and trees, loaded or not", () => {
    const world = build();
    for (let x = -40; x <= 40; x += 3) {
      for (let z = -40; z <= 40; z += 3) {
        expect(world.surfaceColumnTop(x, z)).toBe(topSolidY((bx, by, bz) => world.getBlock(bx, by, bz), x, z));
      }
    }
    world.dispose();
  });

  it("sees player edits in loaded chunks exactly like getBlock does", () => {
    const world = build();
    const generic = (): number => topSolidY((bx, by, bz) => world.getBlock(bx, by, bz), 5, 5);
    const before = world.surfaceColumnTop(5, 5);
    expect(before).toBe(generic());
    world.setBlock(5, before, 5, BLOCK_ID.air);
    expect(world.surfaceColumnTop(5, 5)).toBe(generic());
    expect(world.surfaceColumnTop(5, 5)).toBeLessThan(before);
    world.setBlock(5, before, 5, BLOCK_ID.planks);
    expect(world.surfaceColumnTop(5, 5)).toBe(before);
    world.dispose();
  });

  it("finds high blocks beyond the previous y=70 decor scan", () => {
    const world = build();
    world.setBlock(5, 80, 5, BLOCK_ID.planks);
    expect(world.surfaceColumnTop(5, 5)).toBe(80);
    world.dispose();
  });

  it("handles negative coordinates and chunk boundaries", () => {
    const world = build();
    for (const [x, z] of [[-1, -1], [-16, -16], [-17, 15], [15, -17], [16, 16], [0, 0]] as const) {
      expect(world.surfaceColumnTop(x, z)).toBe(topSolidY((bx, by, bz) => world.getBlock(bx, by, bz), x, z));
    }
    world.dispose();
  });
});

describe("terrain shadow casters follow the players", () => {
  const build = (): { world: WorldRenderer; scene: THREE.Scene } => {
    const scene = new THREE.Scene();
    const world = new WorldRenderer({
      scene,
      seed: 1234,
      atlasTexture: new THREE.Texture(),
      atlasNormal: new THREE.Texture(),
      atlasOrm: new THREE.Texture(),
      waterNormal: new THREE.Texture(),
      workerCount: 1,
    });
    for (const cx of [0, 12]) world.setBlock(cx * 16 + 8, 3, 8, BLOCK_ID.grass);
    return { world, scene };
  };
  const casting = (scene: THREE.Scene, chunkX: number): boolean => {
    const mesh = scene.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.position.x === chunkX * 16 && c.position.y === 0);
    expect(mesh).toBeDefined();
    return mesh!.castShadow;
  };

  it("stops far chunks casting and lets near chunks cast once casters are updated", () => {
    const { world, scene } = build();
    world.updateShadowCasters([{ x: 8, z: 8 }], 80);
    expect(casting(scene, 0)).toBe(true);
    expect(casting(scene, 12)).toBe(false);
    world.dispose();
  });

  it("re-enables casting for a chunk when a player walks into range", () => {
    const { world, scene } = build();
    world.updateShadowCasters([{ x: 8, z: 8 }], 80);
    expect(casting(scene, 12)).toBe(false);
    world.updateShadowCasters([{ x: 200, z: 8 }], 80);
    expect(casting(scene, 12)).toBe(true);
    expect(casting(scene, 0)).toBe(false);
    world.dispose();
  });

  it("keeps a chunk's casting state when it is remeshed after an edit", () => {
    const { world, scene } = build();
    world.updateShadowCasters([{ x: 8, z: 8 }], 80);
    world.setBlock(12 * 16 + 9, 3, 8, BLOCK_ID.grass);
    expect(casting(scene, 12)).toBe(false);
    world.setBlock(9, 3, 8, BLOCK_ID.grass);
    expect(casting(scene, 0)).toBe(true);
    world.dispose();
  });
});
