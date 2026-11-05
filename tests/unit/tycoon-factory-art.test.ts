import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createExpansionArt, createMainFactoryArt } from "../../src/client/game/tycoon-factory-art";

describe("authored tycoon factory art", () => {
  it("builds a layered industrial conveyor and machine instead of only recoloring kit models", () => {
    const art = createMainFactoryArt({ groundAt: () => 0, beltTop: 0.8 });

    expect(art.root.getObjectByName("factory-foundation")).toBeInstanceOf(THREE.Group);
    expect(art.root.getObjectByName("factory-machine-frame")).toBeInstanceOf(THREE.Group);
    expect(art.root.getObjectByName("factory-power-core")).toBeInstanceOf(THREE.Mesh);
    expect(art.root.getObjectByName("factory-conveyor-slats")).toBeInstanceOf(THREE.InstancedMesh);
    expect(art.root.getObjectByName("factory-conveyor-rollers")).toBeInstanceOf(THREE.InstancedMesh);
    expect(art.root.getObjectByName("factory-control-console")).toBeInstanceOf(THREE.Group);
    art.dispose();
  });

  it("animates the belt, press, and beacon from simulation delta", () => {
    const art = createMainFactoryArt({ groundAt: () => 0, beltTop: 0.8 });
    const slats = art.root.getObjectByName("factory-conveyor-slats") as THREE.InstancedMesh;
    const piston = art.root.getObjectByName("factory-press-piston") as THREE.Mesh;
    const beacon = art.root.getObjectByName("factory-machine-beacon") as THREE.Group;
    const beforeSlat = new THREE.Matrix4();
    slats.getMatrixAt(0, beforeSlat);
    const beforePistonY = piston.position.y;
    const beforeBeaconY = beacon.rotation.y;

    art.update(0.4);

    const afterSlat = new THREE.Matrix4();
    slats.getMatrixAt(0, afterSlat);
    expect(afterSlat.elements[12]).not.toBe(beforeSlat.elements[12]);
    expect(piston.position.y).not.toBe(beforePistonY);
    expect(beacon.rotation.y).not.toBe(beforeBeaconY);
    art.dispose();
  });

  it("gives every expansion a named, animated feature with a distinct silhouette", () => {
    for (let index = 0; index < 6; index++) {
      const art = createExpansionArt(index);
      const moving = art.root.getObjectByName(`expansion-moving-${index}`) as THREE.Object3D;
      expect(art.root.name).toBe(`expansion-art-${index}`);
      expect(art.root.getObjectByName(`expansion-feature-${index}`)).toBeInstanceOf(THREE.Group);
      expect(moving).toBeDefined();
      const before = moving.matrix.clone();
      art.update(0.5);
      moving.updateMatrix();
      expect(moving.matrix.equals(before)).toBe(false);
      art.dispose();
    }
  });
});
