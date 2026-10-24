import { describe, expect, it } from "vitest";
import { TycoonManager } from "../../src/client/game/tycoon";

describe("TycoonManager", () => {
  it("initializes with 0 collected coins and active tier 1 dropper", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    expect(tycoon.collectedStars).toBe(0);
    expect(tycoon.dropperTier).toBe(1);
    expect(tycoon.vaultCoins).toBe(0);
  });

  it("drops coins over time into the vault", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    // Advance 3 seconds
    tycoon.update(3.0, { x: 0, y: 50, z: 0 });
    expect(tycoon.vaultCoins).toBeGreaterThanOrEqual(1);
  });

  it("collects vault coins when player steps on collector pad", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.update(3.0, { x: 0, y: 50, z: 0 });
    const coinsBefore = tycoon.vaultCoins;

    // Step on collector pad at (-3, 50, 6)
    let collected = 0;
    tycoon.update(0.1, { x: -3, y: 50, z: 6 }, (stars: number) => {
      collected = stars;
    });

    expect(collected).toBe(coinsBefore);
    expect(tycoon.collectedStars).toBe(coinsBefore);
    expect(tycoon.vaultCoins).toBe(0);
  });

  it("purchases upgrade when player with enough stars steps on purchase pad", () => {
    const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 });
    tycoon.addStars(10);

    // Step on upgrade pad at (-1, 50, 6) (Cost 5 stars)
    let upgraded = false;
    tycoon.update(0.1, { x: -1, y: 50, z: 6 }, () => {}, () => {
      upgraded = true;
    });

    expect(upgraded).toBe(true);
    expect(tycoon.dropperTier).toBe(2);
    expect(tycoon.collectedStars).toBe(5);
  });
});
