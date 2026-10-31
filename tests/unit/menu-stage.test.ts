import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MenuStage } from "../../src/client/startup/menu-stage";

describe("MenuStage", () => {
  it("orbits the camera at a fixed radius and advances by delta times speed", () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    const focus = new THREE.Vector3(12, 60, 12);
    const stage = new MenuStage({ radius: 13, height: 8.5, speed: 0.06, startAngle: 0 });

    stage.update(1, camera, focus);
    expect(camera.position.x).toBeCloseTo(12 + 13 * Math.sin(0.06), 5);
    expect(camera.position.y).toBeCloseTo(68.5, 5);
    expect(camera.position.z).toBeCloseTo(12 + 13 * Math.cos(0.06), 5);
    expect(camera.position.distanceTo(focus)).toBeCloseTo(Math.hypot(13, 8.5), 5);

    stage.update(1, camera, focus);
    expect(camera.position.x).toBeCloseTo(12 + 13 * Math.sin(0.12), 5);
    expect(camera.position.z).toBeCloseTo(12 + 13 * Math.cos(0.12), 5);
  });

  it("pulls the camera in when the orbit path is blocked", () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    const focus = new THREE.Vector3(12, 60, 12);
    const stage = new MenuStage({ radius: 13, height: 8.5, speed: 0.06, startAngle: 0 });

    stage.update(1, camera, focus);
    const openDistance = camera.position.distanceTo(focus);

    const blockedStage = new MenuStage({
      radius: 13,
      height: 8.5,
      speed: 0.06,
      startAngle: 0,
      solid: () => true,
    });
    blockedStage.update(1, camera, focus);
    expect(camera.position.distanceTo(focus)).toBeLessThan(openDistance);
    expect(camera.position.y).toBeGreaterThan(focus.y);
  });

  it("elevates the camera above high terrain via groundAt", () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    const focus = new THREE.Vector3(12, 60, 12);
    const stage = new MenuStage({
      radius: 13,
      height: 8.5,
      speed: 0.06,
      startAngle: 0,
      groundAt: () => 75,
    });

    stage.update(1, camera, focus);
    // Default would be 60 + 8.5 = 68.5, but terrain is 75 -> clamped to 75 + 2 = 77
    expect(camera.position.y).toBeCloseTo(77, 5);
  });
});
