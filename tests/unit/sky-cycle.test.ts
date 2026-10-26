import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SkyCycle } from "../../src/client/render/renderer";

function makeSky(): { scene: THREE.Scene; sky: SkyCycle } {
  const scene = new THREE.Scene();
  const sky = new SkyCycle(scene, { clouds: new THREE.Texture(), sideClouds: new THREE.Texture() });
  return { scene, sky };
}

describe("SkyCycle environment modulation", () => {
  it("lights the HDRI environment fully at noon and dims it at night", () => {
    const { scene, sky } = makeSky();
    sky.update(450, new THREE.Vector3());
    const noon = scene.environmentIntensity;
    sky.update(1350, new THREE.Vector3());
    const midnight = scene.environmentIntensity;
    expect(noon).toBeCloseTo(1, 3);
    expect(midnight).toBeCloseTo(0.15, 3);
    expect(midnight).toBeLessThan(noon);
  });

  it("keeps the sun aligned with the camera centre so shadows stay centred", () => {
    const { scene, sky } = makeSky();
    const centre = new THREE.Vector3(12, 0, -7);
    sky.update(450, centre);
    const sun = scene.children.find((child): child is THREE.DirectionalLight => child instanceof THREE.DirectionalLight);
    expect(sun).toBeDefined();
    expect(sun!.target.position.toArray()).toEqual(centre.toArray());
  });
});
