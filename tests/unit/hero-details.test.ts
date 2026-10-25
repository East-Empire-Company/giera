import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyHeroDetails } from "../../src/client/entities/hero-details";

function buildRig(): { root: THREE.Group; head: THREE.Mesh; torso: THREE.Mesh; legLeft: THREE.Mesh } {
  const root = new THREE.Group();
  const head = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
  head.name = "head_1";
  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.78, 2, 1.33));
  torso.name = "torso_1";
  const legLeft = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2, 0.7));
  legLeft.name = "leg-left_1";
  root.add(head, torso, legLeft);
  return { root, head, torso, legLeft };
}

function textureOf(child: THREE.Object3D): THREE.Texture | null {
  const mesh = child as THREE.Mesh;
  const material = mesh.material;
  if (!material) return null;
  const single = Array.isArray(material) ? material[0] : material;
  return (single as THREE.MeshBasicMaterial).map ?? null;
}

describe("hero details", () => {
  it("gives Ziemek shaggy hair, a backpack and a creeper hoodie emblem", () => {
    const { root, head, torso, legLeft } = buildRig();

    applyHeroDetails(root, "ziemek");

    expect(head.children.length).toBeGreaterThanOrEqual(4);
    expect(torso.children.length).toBeGreaterThanOrEqual(4);
    const emblem = torso.children.find((child) => textureOf(child) !== null);
    expect(emblem).toBeDefined();
    const emblemTexture = textureOf(emblem!);
    expect((emblemTexture?.image as { width: number }).width).toBe(16);
    expect(legLeft.scale.y).toBeLessThan(1);
    expect(head.scale.x).toBeGreaterThan(1);
  });

  it("gives Gniewko neat hair and polo trim without a backpack", () => {
    const { root, head, torso } = buildRig();

    applyHeroDetails(root, "gniewko");

    expect(head.children.length).toBeGreaterThanOrEqual(2);
    expect(torso.children.length).toBe(2);
    expect(torso.children.some((child) => textureOf(child) !== null)).toBe(false);
  });

  it("does nothing when the rig has no head or torso mesh", () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));

    expect(() => applyHeroDetails(root, "ziemek")).not.toThrow();
    expect(root.children[0].children.length).toBe(0);
  });

  it("gives NPCs short hair without hero garments or child proportions", () => {
    const { root, head, torso } = buildRig();

    applyHeroDetails(root, "mina");

    expect(head.children.length).toBeGreaterThanOrEqual(2);
    expect(torso.children.length).toBe(0);
    expect(head.scale.x).toBe(1);
  });
});
