import type { ExpansionSlot, ExpansionState } from "./tycoon-expansion";

export type RecommendedTycoonAction = "collect" | "upgrade" | "expand" | "save";

export type TycoonPresentationState = {
  vaultCoins: number;
  collectedStars: number;
  dropperTier: number;
  upgradeCost: number;
  collectorReady: boolean;
  upgradeAffordable: boolean;
  recommendedAction: RecommendedTycoonAction;
  expansions: readonly { index: number; cost: number; state: ExpansionState }[];
};

export function selectTycoonPresentation(input: {
  vaultCoins: number;
  collectedStars: number;
  dropperTier: number;
  slots: readonly ExpansionSlot[];
  owned: readonly number[];
}): TycoonPresentationState {
  const upgradeCost = input.dropperTier * 5;
  const owned = new Set(input.owned);
  const expansions = input.slots.map((slot) => ({
    index: slot.index,
    cost: slot.cost,
    state: owned.has(slot.index)
      ? ("owned" as const)
      : input.collectedStars >= slot.cost
        ? ("affordable" as const)
        : ("locked" as const),
  }));
  const collectorReady = input.vaultCoins > 0;
  const upgradeAffordable = input.collectedStars >= upgradeCost;
  const nextExpansion = expansions.find((slot) => slot.state !== "owned");
  const recommendedAction: RecommendedTycoonAction = collectorReady
    ? "collect"
    : upgradeAffordable
      ? "upgrade"
      : nextExpansion?.state === "affordable"
        ? "expand"
        : "save";

  return {
    vaultCoins: input.vaultCoins,
    collectedStars: input.collectedStars,
    dropperTier: input.dropperTier,
    upgradeCost,
    collectorReady,
    upgradeAffordable,
    recommendedAction,
    expansions,
  };
}
