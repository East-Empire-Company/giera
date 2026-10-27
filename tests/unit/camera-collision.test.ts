import { describe, expect, it } from "vitest";
import { collideCamera } from "../../src/shared/camera-collision";

const wallAtZ = (wall: number) => (_x: number, _y: number, z: number) => z === wall;

describe("collideCamera", () => {
  it("returns the desired position when nothing blocks the arm", () => {
    const out = collideCamera({ x: 0.5, y: 5.5, z: 0.5 }, { x: 0.5, y: 5.5, z: 6 }, () => false);
    expect(out).toEqual({ x: 0.5, y: 5.5, z: 6 });
  });

  it("pulls the camera in front of a wall between target and desired position", () => {
    const out = collideCamera({ x: 0.5, y: 5.5, z: 0.5 }, { x: 0.5, y: 5.5, z: 8 }, wallAtZ(4));
    expect(out.z).toBeLessThan(4);
    expect(out.z).toBeGreaterThan(3);
  });

  it("never collapses closer than the minimum distance when enclosed", () => {
    const out = collideCamera({ x: 0.5, y: 5.5, z: 0.5 }, { x: 0.5, y: 5.5, z: 6 }, wallAtZ(1));
    expect(Math.hypot(out.x - 0.5, out.y - 5.5, out.z - 0.5)).toBeGreaterThanOrEqual(0.5 - 1e-9);
  });

  it("lifts the camera over a low obstruction instead of collapsing onto the character", () => {
    const floorBelow = (_x: number, y: number, _z: number) => y < 5;
    const target = { x: 0.5, y: 6.5, z: 0.5 };
    const out = collideCamera(target, { x: 0.5, y: 3.5, z: 6 }, floorBelow);
    const dist = Math.hypot(out.x - target.x, out.y - target.y, out.z - target.z);
    expect(dist).toBeGreaterThan(3);
    expect(out.y).toBeGreaterThan(5);
  });
});
