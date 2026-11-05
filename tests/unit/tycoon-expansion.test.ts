import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TycoonExpansion, EXPANSION_SLOTS } from "../../src/client/game/tycoon-expansion";
import { createHeadquartersArt } from "../../src/client/game/tycoon-headquarters-art";

describe("TycoonExpansion", () => {
  it("starts locked and turns gold when stars cover the cost", () => {
    const expansion = new TycoonExpansion({ groundAt: () => 0, render: false });
    expect(expansion.stateOf(0)).toBe("locked");
    expansion.refresh(EXPANSION_SLOTS[0].cost);
    expect(expansion.stateOf(0)).toBe("affordable");
    expansion.refresh(EXPANSION_SLOTS[0].cost - 1);
    expect(expansion.stateOf(0)).toBe("locked");
  });

  it("builds a purchased HQ stage once and restores it without growth replay", () => {
    const calls: [number, boolean][] = [];
    const expansion = new TycoonExpansion({
      groundAt: () => 0,
      preflight: () => true,
      build: (index, restored) => calls.push([index, restored]),
    });

    expect(expansion.claim(0)).toBe(true);
    expect(expansion.claim(0)).toBe(false);
    expansion.restore([0]);

    expect(calls).toEqual([[0, false], [0, true]]);
    expect(expansion.getCollisionBodies()).toHaveLength(0);
    expect(expansion.group.getObjectByName("hq-kiosk-0")).toBeDefined();
    expect(expansion.group.getObjectByName("expansion-ring-0")).toBeUndefined();
  });

  it("does not claim an obstructed stage", () => {
    const expansion = new TycoonExpansion({ groundAt: () => 0, preflight: () => false });
    expect(expansion.claim(0)).toBe(false);
    expect(expansion.stateOf(0)).toBe("locked");
  });

  it("uses neutral locked and gold affordable kiosks, then hides the owned kiosk", () => {
    const expansion = new TycoonExpansion({ groundAt: () => 0 });
    const kiosk = expansion.group.getObjectByName("hq-kiosk-0") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const hologram = expansion.group.getObjectByName("hq-hologram-0") as THREE.Mesh;

    expect(kiosk.material.color.getHex()).toBe(0x526675);
    expansion.refresh(EXPANSION_SLOTS[0].cost);
    expect(kiosk.material.color.getHex()).toBe(0xf6c445);
    expect(hologram.visible).toBe(true);
    expansion.claim(0);
    expect(kiosk.visible).toBe(false);
    expect(hologram.visible).toBe(false);
    expansion.refresh(0);
    expect(expansion.stateOf(0)).toBe("owned");
  });

  it("restores owned headquarters stages from a save", () => {
    const expansion = new TycoonExpansion({ groundAt: () => 0, render: false });
    expansion.restore([1, 3]);
    expect(expansion.ownedIndices()).toEqual([1, 3]);
    expect(expansion.stateOf(0)).toBe("locked");
  });

  it("attaches staged art to ownership, animation, restoration, and disposal", () => {
    const art = createHeadquartersArt();
    const expansion = new TycoonExpansion({ groundAt: () => 0, art });
    expect(expansion.group.getObjectByName("hq-headquarters-art")).toBe(art.root);

    expansion.claim(3);
    expect(art.root.getObjectByName("hq-stage-3")!.visible).toBe(true);
    expansion.restore([0, 3, 5]);
    expect(art.root.getObjectByName("hq-stage-1")!.visible).toBe(false);
    expect(art.root.getObjectByName("hq-stage-5")!.visible).toBe(true);
    expansion.update(0.5);
    expect(art.root.getObjectByName("hq-rooftop-antenna")!.rotation.y).toBeGreaterThan(0);

    expansion.dispose();
    expect(art.root.parent).toBeNull();
  });

  it("keeps one stable empty collision array because HQ architecture uses voxels", () => {
    const expansion = new TycoonExpansion({ groundAt: () => 0 });
    expansion.claim(0);
    expansion.update(0.3);
    expansion.restore([0]);
    expansion.update(0.3);

    const bodies = expansion.getCollisionBodies();
    expect(bodies).toHaveLength(0);
    expect(expansion.getCollisionBodies()).toBe(bodies);
    expect(expansion.group.children.filter((child) => child.name === "hq-kiosk-0")).toHaveLength(1);
  });
});
