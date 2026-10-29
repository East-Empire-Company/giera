import { describe, expect, it } from "vitest";
import { TycoonManager } from "../../src/client/game/tycoon";

describe("TycoonManager", () => {
  it("initializes with 0 collected coins and active tier 1 dropper", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    expect(tycoon.collectedStars).toBe(0);
    expect(tycoon.dropperTier).toBe(1);
    expect(tycoon.vaultCoins).toBe(0);
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
      tycoon.updateSecondaryTrampoline(1 / 60, onPad, () => {
        bounces++;
      });
    }
    expect(bounces).toBe(1);
    tycoon.updateSecondaryTrampoline(0.6, onPad, () => {
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
    tycoon.updateSecondaryTrampoline(0.1, onPad, () => {
      secondary++;
    });
    expect([primary, secondary]).toEqual([1, 1]);
  });

  it("does not bounce a second player who is off the pad", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    let bounces = 0;
    tycoon.updateSecondaryTrampoline(0.1, { x: 10, y: 50, z: 10 }, () => {
      bounces++;
    });
    expect(bounces).toBe(0);
  });

  it("does not advance the shared economy when the second player is processed", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    for (let i = 0; i < 100; i++) tycoon.updateSecondaryTrampoline(0.1, { x: 10, y: 50, z: 10 }, () => {});
    expect(tycoon.vaultCoins).toBe(0);
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
    tycoon.updateSecondaryTrampoline(0.1, onPad, () => {
      bounces++;
    });
    tycoon.updateSecondaryTrampoline(0.7, onPad, () => {
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
});
