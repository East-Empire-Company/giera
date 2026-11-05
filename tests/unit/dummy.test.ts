import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TrainingDummy } from "../../src/client/entities/dummy";

describe("TrainingDummy", () => {
  it("initializes upright with zero wobble", () => {
    const dummy = new TrainingDummy({ x: 2, y: 50, z: 2 });
    expect(dummy.wobbleAngle).toBe(0);
  });

  it("wobbles on hit and dampens back toward zero over time", () => {
    const dummy = new TrainingDummy({ x: 2, y: 50, z: 2 });
    dummy.hit();
    expect(Math.abs(dummy.wobbleAngle)).toBeGreaterThan(0.3);

    for (let i = 0; i < 40; i++) {
      dummy.update(0.05);
    }
    expect(Math.abs(dummy.wobbleAngle)).toBeLessThan(0.05);
  });

  it("keeps the default impulse at 14 and scales it exactly with combat gear", () => {
    const dummy = new TrainingDummy({ x: 2, y: 50, z: 2 });
    const impulse = () => (dummy as unknown as { wobbleVelocity: number }).wobbleVelocity;
    dummy.hit();
    expect(impulse()).toBe(14);
    dummy.hit(4.5);
    expect(impulse()).toBe(63);
  });

  it("gives every vertex-coloured mesh a colour attribute so shared tile materials do not render black", () => {
    const tileMaterial = new THREE.MeshStandardMaterial({ vertexColors: true });
    const dummy = new TrainingDummy({ x: 2, y: 50, z: 2 }, { planks: tileMaterial, bark: tileMaterial });
    const offenders: string[] = [];
    dummy.object.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      const needsColor = materials.some((material) => (material as THREE.MeshStandardMaterial).vertexColors);
      if (needsColor && !node.geometry.getAttribute("color")) offenders.push(node.geometry.type);
    });
    expect(offenders).toEqual([]);
  });
});
