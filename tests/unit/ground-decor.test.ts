import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  createGrassBladeInstances,
  decorRadiiFor,
  disposeGroundDecor,
  MAX_BLADE_RADIUS,
  placeGroundDecor,
  scatterGrassBlades,
} from "../../src/client/render/ground-decor";

describe("instanced grass blades", () => {
  it("scatters a bounded deterministic field inside the requested radius", () => {
    const first = scatterGrassBlades(4242, 32, 4, -7);
    const repeated = scatterGrassBlades(4242, 32, 4, -7);
    expect(first.length).toBeGreaterThan(1000);
    expect(first.length).toBeLessThan(5000);
    expect(repeated).toEqual(first);
    expect(scatterGrassBlades(4243, 32, 4, -7)).not.toEqual(first);
    for (const site of first) expect(Math.hypot(site.x - 4, site.z + 7)).toBeLessThanOrEqual(32);
  });

  it("builds three-triangle instances only on grass surfaces", () => {
    const sites = scatterGrassBlades(7, 8, 0, 0);
    const mesh = createGrassBladeInstances(sites, 7, () => true, () => 12);
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh?.count).toBe(sites.length);
    expect(mesh?.geometry.index?.count).toBe(9);
    const matrix = new THREE.Matrix4();
    mesh?.getMatrixAt(0, matrix);
    expect(matrix.elements[13]).toBeCloseTo(13);
    expect(createGrassBladeInstances(sites, 7, () => false, () => 12)).toBeNull();
  });

  it("receives shadows but does not cast them, since blades are sub-texel in every cascade", () => {
    const mesh = createGrassBladeInstances(scatterGrassBlades(7, 8, 0, 0), 7, () => true, () => 12);
    expect(mesh?.receiveShadow).toBe(true);
    expect(mesh?.castShadow).toBe(false);
  });
});


describe("decorRadiiFor", () => {
  it("keeps props across most of the streamed world but bounds the dense blade field", () => {
    const desktop = decorRadiiFor(20);
    expect(desktop.props).toBe(240);
    expect(desktop.blades).toBe(MAX_BLADE_RADIUS);
    expect(desktop.blades).toBeLessThan(desktop.props);
  });

  it("never exceeds the prop radius on small views", () => {
    const console = decorRadiiFor(8);
    expect(console.props).toBe(96);
    expect(console.blades).toBeLessThanOrEqual(console.props);
  });

  it("bounds total blade attempts so a recenter stays cheap", () => {
    const attempts = scatterGrassBlades(1, decorRadiiFor(20).blades, 0, 0).length;
    expect(attempts).toBeLessThanOrEqual(20000);
  });

  it("keeps a usable minimum radius", () => {
    expect(decorRadiiFor(1).props).toBeGreaterThanOrEqual(24);
    expect(decorRadiiFor(1).blades).toBeGreaterThanOrEqual(24);
  });
});

describe("surface memoisation", () => {
  it("asks the world for each column only once across props and blades", async () => {
    let calls = 0;
    const group = await placeGroundDecor(
      [{ x: 1, y: 0, z: 1, kind: "rock", scale: 1, rotation: 0 }],
      7,
      () => true,
      (x, z) => {
        calls++;
        return 5 + (x ^ z) * 0;
      },
      [{ x: 1.2, z: 1.7, scale: 1, rotation: 0 }, { x: 1.6, z: 1.1, scale: 1, rotation: 0 }]
    );
    expect(calls).toBe(1);
    disposeGroundDecor(group);
  });
});
describe("ground decor cleanup", () => {
  it("releases instance buffers without disposing shared geometry or materials", async () => {
    const group = await placeGroundDecor(
      [{ x: 1, y: 0, z: -2, kind: "rock", scale: 1, rotation: 0 }],
      7,
      () => true,
      () => 5
    );
    const rock = group.children[0] as THREE.InstancedMesh;
    const disposeInstance = vi.spyOn(rock, "dispose");
    const disposeGeometry = vi.spyOn(rock.geometry, "dispose");
    const disposeMaterial = vi.spyOn(rock.material as THREE.Material, "dispose");

    disposeGroundDecor(group);

    expect(disposeInstance).toHaveBeenCalledOnce();
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(disposeMaterial).not.toHaveBeenCalled();
    expect(group.children).toHaveLength(0);
  });
});
