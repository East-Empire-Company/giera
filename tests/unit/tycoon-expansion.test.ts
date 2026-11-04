import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TycoonExpansion, EXPANSION_SLOTS } from "../../src/client/game/tycoon-expansion";

describe("TycoonExpansion", () => {
  it("starts locked and turns green when stars cover the cost", () => {
    const expansion = new TycoonExpansion({ groundAt: () => 0, render: false });
    expect(expansion.stateOf(0)).toBe("locked");
    expansion.refresh(EXPANSION_SLOTS[0].cost);
    expect(expansion.stateOf(0)).toBe("affordable");
    expansion.refresh(EXPANSION_SLOTS[0].cost - 1);
    expect(expansion.stateOf(0)).toBe("locked");
  });

  it("claims a circle once and keeps it owned", () => {
    const expansion = new TycoonExpansion({ groundAt: () => 0, render: false });
    expect(expansion.claim(0)).toBe(true);
    expect(expansion.claim(0)).toBe(false);
    expect(expansion.stateOf(0)).toBe("owned");
    expect(expansion.ownedIndices()).toEqual([0]);
  });

  it("uses neutral locked and gold affordable pads, then hides the owned pad", () => {
    const expansion = new TycoonExpansion({ groundAt: () => 0 });
    const ring = expansion.group.getObjectByName("expansion-ring-0") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const disc = expansion.group.getObjectByName("expansion-disc-0") as THREE.Mesh;

    expect(ring.material.color.getHex()).toBe(0x526675);
    expansion.refresh(EXPANSION_SLOTS[0].cost);
    expect(ring.material.color.getHex()).toBe(0xf6c445);
    expansion.claim(0);
    expect(ring.visible).toBe(false);
    expect(disc.visible).toBe(false);
    expansion.refresh(0);
    expect(expansion.stateOf(0)).toBe("owned");
  });

  it("restores owned circles from a save", () => {
    const expansion = new TycoonExpansion({ groundAt: () => 0, render: false });
    expansion.restore([1, 3]);
    expect(expansion.ownedIndices()).toEqual([1, 3]);
    expect(expansion.stateOf(0)).toBe("locked");
  });

  it("builds each owned module once, grows new purchases, and collides only with modules", () => {
    const parts = {
      clonePart: () => new THREE.Group().add(
        new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
      ),
    };
    const expansion = new TycoonExpansion({ groundAt: () => 0 });
    expansion.bindFactoryParts(parts);
    expansion.claim(0);
    expansion.update(0.3);

    const growing = expansion.group.getObjectByName("expansion-module-0")!;
    expect(growing.visible).toBe(true);
    expect(growing.scale.x).toBeGreaterThan(0);
    expect(growing.scale.x).toBeLessThan(1);
    expansion.update(0.3);
    expect(growing.scale.x).toBe(1);
    expect(expansion.getCollisionBodies()).toHaveLength(1);

    expansion.bindFactoryParts(parts);
    expansion.restore([0]);
    expansion.refresh(0);
    expansion.update(1);
    expect(expansion.group.children.filter((child) => child.name === "expansion-module-0")).toHaveLength(1);
    expect(expansion.stateOf(0)).toBe("owned");
  });

  it("restores modules at final scale without replaying their build animation", () => {
    const parts = {
      clonePart: () => new THREE.Group().add(
        new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
      ),
    };
    const expansion = new TycoonExpansion({ groundAt: () => 0 });
    expansion.restore([0]);

    expansion.bindFactoryParts(parts);

    const restored = expansion.group.getObjectByName("expansion-module-0")!;
    expect(restored.scale.x).toBe(1);
    expect(expansion.getCollisionBodies()).toHaveLength(1);
  });
});
