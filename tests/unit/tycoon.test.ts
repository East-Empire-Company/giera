import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TycoonManager } from "../../src/client/game/tycoon";
import { tycoonTheme } from "../../src/shared/tycoon-slots";

describe("TycoonManager", () => {
  it("initializes with 0 collected coins and active tier 1 dropper", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    expect(tycoon.collectedStars).toBe(0);
    expect(tycoon.dropperTier).toBe(1);
    expect(tycoon.vaultCoins).toBe(0);
  });

  it("exposes read-only presentation state without changing progression", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.restore({ vaultCoins: 2, collectedStars: 20, dropperTier: 4, expansions: [0] });

    const view = tycoon.getPresentationState();

    expect(view.recommendedAction).toBe("collect");
    expect(view.upgradeCost).toBe(20);
    expect(view.expansions).toHaveLength(6);
    expect(view.expansions[0]).toEqual({ index: 0, cost: 20, state: "owned" });
    expect(tycoon.toJSON()).toEqual({ vaultCoins: 2, collectedStars: 20, dropperTier: 4, expansions: [0] });
  });

  it("restores durable tycoon progress", () => {
    const saved = { vaultCoins: 3, collectedStars: 17, dropperTier: 4, expansions: [0] };
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });

    tycoon.restore(saved);

    expect(tycoon.toJSON()).toEqual(saved);
    expect(tycoon.upgradeCost).toBe(20);
    tycoon.update(0.63, { x: 0, y: 50, z: 0 });
    expect(tycoon.vaultCoins).toBe(4);
  });

  it("drops exactly one coin per 2.5s at tier 1", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.update(2.49, { x: 0, y: 50, z: 0 });
    expect(tycoon.vaultCoins).toBe(0);
    tycoon.update(0.02, { x: 0, y: 50, z: 0 });
    expect(tycoon.vaultCoins).toBe(1);
  });

  it("pays the vault onto the collector pad and empties it", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.update(2.5, { x: 0, y: 50, z: 0 });
    let collected = 0;
    tycoon.update(0.1, { x: -3, y: 50, z: 6 }, (stars: number) => {
      collected = stars;
    });
    expect(collected).toBe(1);
    expect(tycoon.collectedStars).toBe(1);
    expect(tycoon.vaultCoins).toBe(0);
  });

  it("refuses an upgrade the player cannot afford", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.addStars(4);
    let upgraded = false;
    tycoon.update(0.1, { x: -1, y: 50, z: 6 }, () => {}, () => {
      upgraded = true;
    });
    expect(upgraded).toBe(false);
    expect(tycoon.dropperTier).toBe(1);
    expect(tycoon.collectedStars).toBe(4);
    expect(tycoon.upgradeCost).toBe(5);
  });

  it("charges tier times 5 and raises the next cost", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.addStars(10);
    tycoon.update(0.1, { x: -1, y: 50, z: 6 });
    expect(tycoon.dropperTier).toBe(2);
    expect(tycoon.collectedStars).toBe(5);
    expect(tycoon.upgradeCost).toBe(10);
  });

  it("paints its pads from the slot theme", () => {
    const scene = new THREE.Scene();
    const theme = tycoonTheme(2);
    const tycoon = new TycoonManager({ x: 0, y: 50, z: 0 }, scene, { theme });
    const pads = (tycoon.object?.children ?? []).filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
    const colors = pads.map((pad) => (pad.material as THREE.MeshStandardMaterial).color.getHex());

    expect(colors.slice(0, 2)).toEqual([theme.collector, theme.upgrade]);
    expect(colors[2]).toBe(theme.trampoline);
  });

  it("keeps the default theme on the original pad colours", () => {
    const scene = new THREE.Scene();
    const tycoon = new TycoonManager({ x: 0, y: 50, z: 0 }, scene);
    const pads = (tycoon.object?.children ?? []).filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
    const colors = pads.map((pad) => (pad.material as THREE.MeshStandardMaterial).color.getHex());

    expect(colors).toEqual([0x38a169, 0xd69e2e, 0xe53e3e, 0xf6e05e]);
  });

  it("pulses only the recommended pad without moving either trigger", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 }, new THREE.Scene());
    const pads = (tycoon.object?.children ?? []).filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
    const [collector, upgrade] = pads;

    tycoon.updateVisuals(1 / 60);
    expect(collector.scale.x).toBe(1);
    expect(upgrade.scale.x).toBe(1);

    tycoon.restore({ vaultCoins: 2, collectedStars: 0, dropperTier: 1 });
    tycoon.updateVisuals(1 / 60);
    expect(collector.scale.x).toBeGreaterThan(1);
    expect(upgrade.scale.x).toBe(1);
    expect(tycoon.collectorPadPos.toArray()).toEqual([-3, 50, 6]);
    expect(tycoon.upgradePadPos.toArray()).toEqual([-1, 50, 6]);
  });

  it("registers shadow materials for pads, plot and expansions", () => {
    const scene = new THREE.Scene();
    const tycoon = new TycoonManager({ x: 0, y: 50, z: 0 }, scene);
    const registered: THREE.Material[] = [];
    tycoon.registerShadowMaterials((mat) => registered.push(mat));

    // 4 pad/trampoline meshes + expansion meshes + plot materials
    expect(registered.length).toBeGreaterThanOrEqual(4);
    const padColors = registered
      .filter((m): m is THREE.MeshStandardMaterial => m instanceof THREE.MeshStandardMaterial)
      .map((m) => m.color.getHex());
    expect(padColors).toContain(0x38a169); // collector pad
    expect(padColors).toContain(0xd69e2e); // upgrade pad
    expect(padColors).toContain(0xf6e05e); // trampoline mesh
  });

  it("animates a remote player's plot without producing or banking coins", () => {
    const scene = new THREE.Scene();
    const tycoon = new TycoonManager({ x: 0, y: 50, z: 0 }, scene);
    tycoon.updateVisuals(10);

    expect([tycoon.vaultCoins, tycoon.collectedStars]).toEqual([0, 0]);
  });

  it("animates menu previews without producing or banking stars", () => {
    const tycoon = new TycoonManager({ x: 0, y: 50, z: 0 }, new THREE.Scene());
    tycoon.updateMenuVisuals(10);
    expect([tycoon.vaultCoins, tycoon.collectedStars, tycoon.dropperTier]).toEqual([0, 0, 1]);
  });

  it("lets the second player collect the shared vault", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.restore({ vaultCoins: 4, collectedStars: 2, dropperTier: 1 });
    let collected = 0;

    tycoon.updateSecondary(0.1, { x: -3, y: 50, z: 6 }, (coins) => {
      collected = coins;
    });

    expect([collected, tycoon.vaultCoins, tycoon.collectedStars]).toEqual([4, 0, 6]);
  });

  it("lets the second player buy an upgrade with the same callback", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.addStars(10);
    let upgrades = 0;

    tycoon.updateSecondary(0.1, { x: -1, y: 50, z: 6 }, undefined, () => {
      upgrades++;
    });

    expect([upgrades, tycoon.dropperTier, tycoon.collectedStars, tycoon.upgradeCost]).toEqual([1, 2, 5, 10]);
  });

  it("does not advance the shared drop timer for the second player", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    const offPad = { x: 10, y: 50, z: 10 };

    tycoon.updateSecondary(1.26, offPad);
    tycoon.update(1.24, offPad);
    expect(tycoon.vaultCoins).toBe(0);

    tycoon.update(1.26, offPad);
    expect(tycoon.vaultCoins).toBe(1);
  });

  it("bounces once then waits out the 0.6s cooldown", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    let bounces = 0;
    const onPad = { x: -5, y: 50, z: 6 };
    tycoon.update(0.1, onPad, undefined, undefined, () => {
      bounces++;
    });
    tycoon.update(0.2, onPad, undefined, undefined, () => {
      bounces++;
    });
    expect(bounces).toBe(1);
    tycoon.update(0.5, onPad, undefined, undefined, () => {
      bounces++;
    });
    expect(bounces).toBe(2);
  });

  it("bounces a second player once per cooldown instead of every frame", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    let bounces = 0;
    const onPad = { x: -5, y: 50, z: 6 };
    for (let frame = 0; frame < 30; frame++) {
      tycoon.updateSecondary(1 / 60, onPad, undefined, undefined, () => {
        bounces++;
      });
    }
    expect(bounces).toBe(1);
    tycoon.updateSecondary(0.6, onPad, undefined, undefined, () => {
      bounces++;
    });
    expect(bounces).toBe(2);
  });

  it("keeps each player's trampoline cooldown independent", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    const onPad = { x: -5, y: 50, z: 6 };
    let primary = 0;
    let secondary = 0;
    tycoon.update(0.1, onPad, undefined, undefined, () => {
      primary++;
    });
    tycoon.updateSecondary(0.1, onPad, undefined, undefined, () => {
      secondary++;
    });
    expect([primary, secondary]).toEqual([1, 1]);
  });

  it("does not bounce a second player who is off the pad", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    let bounces = 0;
    tycoon.updateSecondary(0.1, { x: 10, y: 50, z: 10 }, undefined, undefined, () => {
      bounces++;
    });
    expect(bounces).toBe(0);
  });

  it("does not re-launch a player who is still rising from the previous bounce", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    let bounces = 0;
    const onPad = { x: -5, y: 50, z: 6 };
    tycoon.update(0.1, onPad, undefined, undefined, () => {
      bounces++;
    });
    tycoon.update(0.7, onPad, undefined, undefined, () => {
      bounces++;
    }, 2.8);
    expect(bounces).toBe(1);
  });

  it("applies the same rising-player gate to the second player", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    let bounces = 0;
    const onPad = { x: -5, y: 50, z: 6 };
    tycoon.updateSecondary(0.1, onPad, undefined, undefined, () => {
      bounces++;
    });
    tycoon.updateSecondary(0.7, onPad, undefined, undefined, () => {
      bounces++;
    }, 2.8);
    expect(bounces).toBe(1);
  });

  it("bounces again once the player is descending back onto the pad", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    let bounces = 0;
    const onPad = { x: -5, y: 50, z: 6 };
    tycoon.update(0.1, onPad, undefined, undefined, () => {
      bounces++;
    });
    tycoon.update(0.7, onPad, undefined, undefined, () => {
      bounces++;
    }, -6);
    expect(bounces).toBe(2);
  });

  it("is independent of the pad's recorded height, which is sampled at a different column", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    let bounces = 0;
    tycoon.update(0.1, { x: -5, y: 57, z: 6 }, undefined, undefined, () => {
      bounces++;
    });
    expect(bounces).toBe(1);
  });

  it("still bounces a grounded player standing on the pad", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    let bounces = 0;
    tycoon.update(0.1, { x: -5, y: 50.4, z: 6 }, undefined, undefined, () => {
      bounces++;
    }, 0);
    expect(bounces).toBe(1);
  });

  it("charges stars for an expansion circle and keeps it owned", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.addStars(25);
    expect(tycoon.buyExpansion(0)).toBe(true);
    expect(tycoon.collectedStars).toBe(5);
    expect(tycoon.toJSON().expansions).toEqual([0]);
    expect(tycoon.buyExpansion(0)).toBe(false);
    expect(tycoon.collectedStars).toBe(5);
  });

  it("refuses an expansion circle the player cannot afford", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.addStars(4);
    expect(tycoon.buyExpansion(0)).toBe(false);
    expect(tycoon.collectedStars).toBe(4);
  });

  it("buys expansion circles in order", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.addStars(60);
    expect(tycoon.buyNextExpansion()).toBe(true);
    expect(tycoon.toJSON().expansions).toEqual([0]);
    expect(tycoon.buyNextExpansion()).toBe(true);
    expect(tycoon.toJSON().expansions).toEqual([0, 1]);
  });

  it("buys an expansion circle when the player walks onto it", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.addStars(25);
    const slot = tycoon.expansionSlots[0];
    let expanded = -1;
    tycoon.update(
      0.1,
      { x: -3 + slot.x, y: 50, z: 8 + slot.z },
      undefined,
      undefined,
      undefined,
      0,
      (index) => {
        expanded = index;
      }
    );
    expect(expanded).toBe(0);
    expect(tycoon.collectedStars).toBe(5);
  });

  it("restores saves made before expansion circles existed", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.restore({ vaultCoins: 1, collectedStars: 2, dropperTier: 3 });
    expect(tycoon.toJSON().expansions).toEqual([]);
    expect(tycoon.collectedStars).toBe(2);
  });

  it("prices the next expansion before it is bought", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.addStars(60);
    expect(tycoon.nextExpansionSlot?.cost).toBe(20);
    expect(tycoon.buyExpansion(tycoon.nextExpansionSlot!.index)).toBe(true);
    expect(tycoon.nextExpansionSlot?.cost).toBe(30);
    tycoon.addStars(1000);
    for (const slot of tycoon.expansionSlots) tycoon.buyExpansion(slot.index);
    expect(tycoon.nextExpansionSlot).toBeUndefined();
  });

  it("reports the paid price of the expansion it bought", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.addStars(60);
    expect(tycoon.buyNextExpansionWithPrice()).toEqual({ bought: true, stars: 40, cost: 20 });
    expect(tycoon.buyNextExpansionWithPrice()).toEqual({ bought: true, stars: 10, cost: 30 });
    tycoon.addStars(1000);
    for (const slot of tycoon.expansionSlots) tycoon.buyExpansion(slot.index);
    expect(tycoon.buyNextExpansionWithPrice()).toEqual({ bought: false, stars: 790, cost: 0 });
  });

  it("reports the price of an expansion the player cannot afford", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.addStars(5);
    expect(tycoon.buyNextExpansionWithPrice()).toEqual({ bought: false, stars: 5, cost: 20 });
  });

  it("includes solid expansion modules in one persistent collision array", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.expansion.bindFactoryParts({
      clonePart: () => new THREE.Group().add(
        new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
      ),
    });
    tycoon.addStars(20);
    expect(tycoon.buyExpansion(0)).toBe(true);
    tycoon.updateVisuals(0.6);

    const bodies = tycoon.getCollisionBodies();
    expect(bodies).toHaveLength(1);
    expect(tycoon.getCollisionBodies()).toBe(bodies);
    expect(tycoon.collectedStars).toBe(0);
    expect(tycoon.toJSON().expansions).toEqual([0]);
  });
});
