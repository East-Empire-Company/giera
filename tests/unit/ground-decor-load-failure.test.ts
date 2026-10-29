import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadAsync = vi.fn();

vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    loadAsync = loadAsync;
  },
}));

vi.mock("../../src/shared/retry", () => ({
  withRetry: <T>(task: () => Promise<T>): Promise<T> => task(),
}));

const flatGltf = (): { scene: THREE.Group } => {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  return { scene };
};

const items = [
  { x: 1, y: 0, z: 1, kind: "tuft" as const, scale: 1, rotation: 0 },
  { x: 2, y: 0, z: 2, kind: "rock" as const, scale: 1, rotation: 0 },
];
const sites = [
  { x: 3, z: 3, scale: 1, rotation: 0 },
  { x: 4, z: 4, scale: 1, rotation: 0 },
];

describe("ground decor when a prop asset fails to load", () => {
  beforeEach(() => {
    vi.resetModules();
    loadAsync.mockReset();
  });

  it("still places rocks and grass blades, which need no network asset", async () => {
    loadAsync.mockRejectedValue(new Error("network down"));
    const { placeGroundDecor } = await import("../../src/client/render/ground-decor");

    const group = await placeGroundDecor(items, 7, () => true, () => 5, sites);

    const instanced = group.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
    expect(instanced.length).toBeGreaterThanOrEqual(2);
    const counts = instanced.map((mesh) => mesh.count).sort();
    expect(counts).toContain(1);
    expect(counts).toContain(sites.length);
  });

  it("recovers on a later placement after a transient failure instead of caching the rejection", async () => {
    loadAsync.mockRejectedValueOnce(new Error("blip")).mockResolvedValue(flatGltf());
    const { placeGroundDecor } = await import("../../src/client/render/ground-decor");

    await placeGroundDecor(items, 7, () => true, () => 5, sites);
    const second = await placeGroundDecor(items, 7, () => true, () => 5, sites);

    const meshCount = second.children.filter((child) => child instanceof THREE.InstancedMesh).length;
    expect(meshCount).toBeGreaterThanOrEqual(3);
    expect(loadAsync).toHaveBeenCalledTimes(2);
  });
});
