import { describe, expect, it } from "vitest";
import { selectTycoonPresentation } from "../../src/client/game/tycoon-presentation";

const slots = [{ index: 0, x: 0, z: 0, cost: 20 }];

describe("selectTycoonPresentation", () => {
  it("prioritizes a non-empty vault without mutating input", () => {
    const input = { vaultCoins: 2, collectedStars: 30, dropperTier: 1, slots, owned: [] as number[] };
    const before = JSON.stringify(input);

    const view = selectTycoonPresentation(input);

    expect(view.recommendedAction).toBe("collect");
    expect(view.collectorReady).toBe(true);
    expect(view.upgradeCost).toBe(5);
    expect(view.expansions[0].state).toBe("affordable");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("prioritizes an affordable upgrade over an expansion", () => {
    const view = selectTycoonPresentation({ vaultCoins: 0, collectedStars: 30, dropperTier: 1, slots, owned: [] });

    expect(view.recommendedAction).toBe("upgrade");
    expect(view.upgradeAffordable).toBe(true);
  });

  it("recommends an affordable expansion when the upgrade is not affordable", () => {
    const view = selectTycoonPresentation({ vaultCoins: 0, collectedStars: 20, dropperTier: 5, slots, owned: [] });

    expect(view.recommendedAction).toBe("expand");
    expect(view.expansions[0].state).toBe("affordable");
  });

  it("recommends saving when no purchase is affordable", () => {
    const view = selectTycoonPresentation({ vaultCoins: 0, collectedStars: 4, dropperTier: 4, slots, owned: [] });

    expect(view.recommendedAction).toBe("save");
    expect(view.expansions[0].state).toBe("locked");
  });

  it("keeps owned expansions owned after the balance falls", () => {
    const view = selectTycoonPresentation({ vaultCoins: 0, collectedStars: 0, dropperTier: 1, slots, owned: [0] });

    expect(view.expansions[0].state).toBe("owned");
    expect(view.recommendedAction).toBe("save");
  });
});
