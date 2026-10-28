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
});
