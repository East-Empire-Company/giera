export const SPEC = {
  seed: 424242,
  qaFixedDelta: 1 / 60,

  walkSpeedBlocksPerSec: 4.3,
  walkFrames: 46,
  walkDistanceBand: [3.1, 3.7] as const,

  jumpVyMin: 5,

  trampolineVy: 22,
  trampolineVyTolerance: 0.6,

  upgradeCostPerTier: 5,

  splitLabelTwoPlayers: "Tryb: 2 Graczy (Ziemek & Gniewko)",
  npcPromptPrefix: "Naciśnij [E]",
} as const;
