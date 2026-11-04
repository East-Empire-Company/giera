import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TycoonCollisionRoots } from "../../src/client/game/tycoon-collision";

describe("TycoonCollisionRoots", () => {
  it("derives cylinders from visible roots and excludes hidden decoration", () => {
    const world = new THREE.Group();
    const solid = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), new THREE.MeshBasicMaterial());
    const hidden = solid.clone();
    hidden.visible = false;
    world.add(solid, hidden);
    const roots = new TycoonCollisionRoots();
    roots.add(solid);
    roots.add(hidden);

    const bodies = roots.get(world);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ radius: 1, height: 3 });
    expect(roots.get(world)).toBe(bodies);
  });

  it("refreshes bounds only after a root change is marked dirty", () => {
    const world = new THREE.Group();
    const solid = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    world.add(solid);
    const roots = new TycoonCollisionRoots();
    roots.add(solid);

    expect(roots.get(world)[0].radius).toBe(0.5);
    solid.scale.setScalar(2);
    expect(roots.get(world)[0].radius).toBe(0.5);
    roots.markDirty();
    expect(roots.get(world)[0].radius).toBe(1);
  });

  it("clears roots and cached bodies", () => {
    const world = new THREE.Group();
    const solid = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    world.add(solid);
    const roots = new TycoonCollisionRoots();
    roots.add(solid);
    expect(roots.get(world)).toHaveLength(1);

    roots.clear();

    expect(roots.get(world)).toHaveLength(0);
  });
});
