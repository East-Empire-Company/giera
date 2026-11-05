import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createStarToken, TycoonLabelView } from "../../src/client/game/tycoon-visuals";

describe("tycoon star visuals", () => {
  it("creates a centered, dimensional star token with a readable gold material", () => {
    const token = createStarToken();
    const mesh = token.children[0] as THREE.Mesh;
    const material = mesh.material as THREE.MeshStandardMaterial;
    const bounds = new THREE.Box3().setFromObject(token);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());

    expect(mesh.isMesh).toBe(true);
    expect(material.color.getHex()).toBe(0xffd84d);
    expect(material.emissiveIntensity).toBeGreaterThan(0);
    expect(size.z).toBeGreaterThan(0.1);
    expect(center.length()).toBeLessThan(0.001);
    expect(mesh.castShadow).toBe(true);
    expect(material.emissiveIntensity).toBeGreaterThan(0.8);
    expect(token.getObjectByName("tycoon-star-halo")).toBeInstanceOf(THREE.Mesh);
    expect(token.getObjectByName("tycoon-star-core")).toBeInstanceOf(THREE.Mesh);
  });

  it("updates labels safely when no DOM canvas is available", () => {
    const label = new TycoonLabelView();

    expect(label.sprite).toBeUndefined();
    expect(() => label.update({ icon: "star", text: "12/20", accent: "#ffd84d" })).not.toThrow();
    expect(() => label.dispose()).not.toThrow();
  });
});
