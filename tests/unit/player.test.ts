import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PlayerController } from "../../src/client/entities/player";
import type { AABB } from "../../src/shared/physics";

describe("PlayerController", () => {
  it("initializes player at spawn with default head pivot and camera arm", () => {
    const player = new PlayerController({ id: "p1", spawn: [0, 45, 0] });
    expect(player.position.x).toBe(0);
    expect(player.position.y).toBe(45);
    expect(player.position.z).toBe(0);
    expect(player.yaw).toBe(Math.PI);
    expect(player.pitch).toBe(0);
  });

  it("clamps camera pitch within ±85 degrees", () => {
    const player = new PlayerController({ id: "p1", spawn: [0, 45, 0] });
    player.rotateCamera(0, 2.0); // > 85 deg (~1.48 rad)
    expect(player.pitch).toBeLessThanOrEqual(1.484);

    player.rotateCamera(0, -5.0);
    expect(player.pitch).toBeGreaterThanOrEqual(-1.484);
  });

  it("calculates third-person camera target with arm offset", () => {
    const player = new PlayerController({ id: "p1", spawn: [10, 40, 20] });
    const target = player.getCameraTarget();
    expect(target.x).toBeCloseTo(10, 1);
    expect(target.y).toBeCloseTo(41.55, 1);
    expect(target.z).toBeCloseTo(20, 1);
  });

  it("computes player bounding box correctly", () => {
    const player = new PlayerController({ id: "p1", spawn: [10, 40, 20] });
    const box = player.getBoundingBox();
    expect(box.minX).toBeCloseTo(9.7, 1);
    expect(box.maxX).toBeCloseTo(10.3, 1);
    expect(box.minY).toBeCloseTo(40, 1);
    expect(box.maxY).toBeCloseTo(41.8, 1);
  });

  it("respawns player at spawn coordinates when falling below y < -20", () => {
    const player = new PlayerController({ id: "p1", spawn: [0, 50, 0] });
    player.position.y = -21;
    player.step(0.05, () => false, { forward: 0, right: 0, jump: false, sprint: false });
    expect(player.position.y).toBe(50);
    expect(player.position.x).toBe(0);
    expect(player.position.z).toBe(0);
    expect(player.velocity.y).toBe(0);
  });

  it("syncs avatar object to player position and facing", () => {
    const player = new PlayerController({ id: "p1", spawn: [0, 40, 0] });
    player.yaw = Math.PI;
    const stub = { object: new THREE.Group() } as unknown as NonNullable<typeof player.avatar>;
    player.avatar = stub;
    player.position.set(7, 41, -3);
    player.syncAvatar();
    expect(player.avatar!.object.position.toArray()).toEqual([7, 41, -3]);
    expect(player.avatar!.object.rotation.y % (Math.PI * 2)).toBeCloseTo(0, 5);
  });

  it("starts with no acting flag and concept clothing colors", () => {
    const player = new PlayerController({ id: "p1", spawn: [3, 40, 5] });
    expect(player.isActing).toBe(false);
    expect(player.profile.clothing.torso).toMatch(/^#/);
    expect(player.profile.name).toBe("Ziemek");
  });

  const air = () => false;
  const floorAt = (y: number) => (_x: number, by: number, _z: number) => by < y;

  it("walks at 4.3 blocks/s on the ground and pins downward velocity to -1", () => {
    const player = new PlayerController({ id: "p1", spawn: [0, 40, 0] });
    player.onGround = true;
    player.step(1 / 60, air, { forward: 1, right: 0, jump: false, sprint: false });
    expect(player.velocity.y).toBe(-1);
    expect(Math.hypot(player.velocity.x, player.velocity.z)).toBeCloseTo(4.3, 5);
  });

  it("jumps at 9 and then falls under gravity", () => {
    const player = new PlayerController({ id: "p1", spawn: [0, 40, 0] });
    player.onGround = true;
    player.step(1 / 60, air, { forward: 0, right: 0, jump: true, sprint: false });
    expect(player.velocity.y).toBe(9);
    expect(player.onGround).toBe(false);
    player.step(0.1, air, { forward: 0, right: 0, jump: false, sprint: false });
    expect(player.velocity.y).toBeCloseTo(9 - 3.2, 5);
  });

  it("stops horizontal velocity against a wall", () => {
    const player = new PlayerController({ id: "p1", spawn: [0, 40, 0] });
    player.onGround = true;
    player.yaw = Math.PI;
    const wall = (_x: number, y: number, z: number) => y < 40 || z >= 1;
    player.step(0.5, wall, { forward: 1, right: 0, jump: false, sprint: false });
    expect(player.position.z).toBeLessThan(1);
    expect(player.velocity.z).toBe(0);
  });
  it("steps onto a one-block rise instead of stopping at its edge", () => {
    const player = new PlayerController({ id: "p1", spawn: [0, 40, 0] });
    player.onGround = true;
    player.yaw = Math.PI;
    for (let i = 0; i < 90; i += 1) {
      player.step(1 / 60, (_x, y, z) => (y < 40 && z < 5) || (y < 41 && z >= 5), { forward: 1, right: 0, jump: false, sprint: false });
    }
    expect(player.position.z).toBeGreaterThan(5.5);
    expect(player.position.y).toBeCloseTo(41, 1);
    expect(player.onGround).toBe(true);
  });
  it("does not step through a two-block wall", () => {
    const player = new PlayerController({ id: "p1", spawn: [0, 40, 0] });
    player.onGround = true;
    player.yaw = Math.PI;
    for (let i = 0; i < 90; i += 1) {
      player.step(1 / 60, (_x, y, z) => (y < 40 && z < 5) || (y < 42 && z >= 5), { forward: 1, right: 0, jump: false, sprint: false });
    }
    expect(player.position.z).toBeLessThan(5);
    expect(player.velocity.z).toBe(0);
  });

  it("lands on a floor instead of falling through", () => {
    const player = new PlayerController({ id: "p1", spawn: [0, 41, 0] });
    player.velocity.y = -8;
    player.step(0.2, floorAt(40), { forward: 0, right: 0, jump: false, sprint: false });
    expect(player.onGround).toBe(true);
    expect(player.position.y).toBeGreaterThanOrEqual(40);
  });
});
