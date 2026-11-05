export const MAX_TYCOON_SLOTS = 8;
export const TYCOON_SLOT_SPACING = 14;
export const TYCOON_SLOT_BASE = { x: 12, z: 12 };
export const TYCOON_SITE_BOUNDS = { minX: -7, maxX: 5, minZ: -8, maxZ: 8 } as const;

export type TycoonTheme = {
  accent: number;
  collector: number;
  collectorEmissive: number;
  upgrade: number;
  upgradeEmissive: number;
  trampoline: number;
};

export const TYCOON_THEMES: readonly TycoonTheme[] = [
  { accent: 0x38a169, collector: 0x38a169, collectorEmissive: 0x22543d, upgrade: 0xd69e2e, upgradeEmissive: 0x744210, trampoline: 0xe53e3e },
  { accent: 0x2f9bd6, collector: 0x2f9bd6, collectorEmissive: 0x10364b, upgrade: 0xe0b23c, upgradeEmissive: 0x4e3e15, trampoline: 0xd9534f },
  { accent: 0x8b5cf6, collector: 0x8b5cf6, collectorEmissive: 0x302056, upgrade: 0xe8c04a, upgradeEmissive: 0x51431a, trampoline: 0xe0557a },
  { accent: 0xf07c1f, collector: 0xf07c1f, collectorEmissive: 0x542b0b, upgrade: 0xf3d24a, upgradeEmissive: 0x55491a, trampoline: 0xd94f4f },
  { accent: 0x14b8a6, collector: 0x14b8a6, collectorEmissive: 0x07403a, upgrade: 0xdcc74a, upgradeEmissive: 0x4d451a, trampoline: 0xe06a4f },
  { accent: 0xec4899, collector: 0xec4899, collectorEmissive: 0x521935, upgrade: 0xe9c94a, upgradeEmissive: 0x51461a, trampoline: 0xd4506e },
  { accent: 0x84cc16, collector: 0x84cc16, collectorEmissive: 0x2e4707, upgrade: 0xe3bc3a, upgradeEmissive: 0x4f4114, trampoline: 0xd8595a },
  { accent: 0x6366f1, collector: 0x6366f1, collectorEmissive: 0x222354, upgrade: 0xdfb945, upgradeEmissive: 0x4e4018, trampoline: 0xd65c8a },
];

export function clampTycoonSlot(slot: number): number {
  if (!Number.isFinite(slot)) return 0;
  const s = Math.floor(slot);
  if (s < 0) return 0;
  return s % MAX_TYCOON_SLOTS;
}

export function tycoonTheme(slot: number): TycoonTheme {
  return TYCOON_THEMES[clampTycoonSlot(slot)];
}

export function tycoonSlotOrigin(slot: number): { x: number; z: number } {
  const s = clampTycoonSlot(slot);
  return { x: TYCOON_SLOT_BASE.x + s * TYCOON_SLOT_SPACING, z: TYCOON_SLOT_BASE.z };
}

export function tycoonSiteSlot(x: number, z: number): number | null {
  for (let slot = 0; slot < MAX_TYCOON_SLOTS; slot++) {
    const at = tycoonSlotOrigin(slot);
    if (
      x >= at.x + TYCOON_SITE_BOUNDS.minX && x <= at.x + TYCOON_SITE_BOUNDS.maxX &&
      z >= at.z + TYCOON_SITE_BOUNDS.minZ && z <= at.z + TYCOON_SITE_BOUNDS.maxZ
    ) return slot;
  }
  return null;
}

export function nextFreeTycoonSlot(used: readonly number[]): number {
  for (let i = 0; i < MAX_TYCOON_SLOTS; i++) {
    if (!used.includes(i)) return i;
  }
  return used.length % MAX_TYCOON_SLOTS;
}