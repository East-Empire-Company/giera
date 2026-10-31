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

  it("grows the claimed circle after the purchase", () => {
    const expansion = new TycoonExpansion({ groundAt: () => 0 });
    const ring = expansion.group.getObjectByName("expansion-ring-0") as THREE.Mesh;
    expansion.claim(0);
    expansion.update(0.3);
    expect(ring.scale.x).toBeGreaterThan(1);
    expect(ring.scale.x).toBeLessThan(1.35);
    expansion.update(1);
    expect(ring.scale.x).toBeCloseTo(1.35, 5);
  });

  it("restores owned circles from a save", () => {
    const expansion = new TycoonExpansion({ groundAt: () => 0, render: false });
    expansion.restore([1, 3]);
    expect(expansion.ownedIndices()).toEqual([1, 3]);
    expect(expansion.stateOf(0)).toBe("locked");
  });
});
