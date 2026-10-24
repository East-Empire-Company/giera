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

  musicLabels: ["Drift Phonk", "Sigma Phonk", "Combat Phonk", "Adventure", "Little Farm"],
  musicIdsAfterFirstClick: ["sigma_protocol", "combat_phonk", "adventure_island", "little_farm", "drift_phonk"],

  splitLabelTwoPlayers: "Tryb: 2 Graczy (Ziemek & Gniewko)",
  npcPromptPrefix: "Naciśnij [E]",
} as const;
