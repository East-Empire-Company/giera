import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyNpcDetails } from "../../src/client/entities/hero-details";

function makeHead(): { root: THREE.Group; head: THREE.Mesh } {
  const root = new THREE.Group();
  const head = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
  head.name = "head_1";
  root.add(head);
  return { root, head };
}

describe("NPC visual details", () => {
  it("adds auburn hair to Mina without changing rig proportions", () => {
    const { root, head } = makeHead();

    applyNpcDetails(root, "mina");

    expect(head.children.length).toBe(2);
    expect(head.scale.toArray()).toEqual([1, 1, 1]);
    expect((head.children[0] as THREE.Mesh).material).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  it("adds grey hair to Staszek", () => {
    const { root, head } = makeHead();

    applyNpcDetails(root, "staszek");

    expect(head.children.length).toBe(2);
  });

  it("does nothing when NPC rig has no head mesh", () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));

    expect(() => applyNpcDetails(root, "mina")).not.toThrow();
    expect(root.children[0].children).toHaveLength(0);
  });
});
