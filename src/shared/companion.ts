export type CompanionProfileId = "staszek" | "mina";
export type CompanionModel = "ranger" | "mage";
export type CompanionProfile = {
  model: CompanionModel;
  targetHeight: number;
  voice: "buddy";
};

export const COMPANION_PROFILES: Record<CompanionProfileId, CompanionProfile> = {
  staszek: { model: "ranger", targetHeight: 1.8, voice: "buddy" },
  mina: { model: "mage", targetHeight: 1.8, voice: "buddy" },
};

export const COMPANION_MODEL_PATHS: Record<CompanionModel, string> = {
  ranger: "/assets/models/kaykit/ranger.glb",
  mage: "/assets/models/kaykit/mage.glb",
};

export const COMPANION_ANIM_CLIPS = {
  idle: { file: "/assets/models/kaykit/anims/Rig_Medium_General.glb", clip: "Idle_A" },
  walk: { file: "/assets/models/kaykit/anims/Rig_Medium_MovementBasic.glb", clip: "Walking_A" },
} as const;

export type CompanionAnim = "idle" | "walk" | "jump" | "mine";

export const MISSING_COMPANION_ASSET_MESSAGE = "Kompanioka nie może się dołączyć — brak modelu lub animacji.";
