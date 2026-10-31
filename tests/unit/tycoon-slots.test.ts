import { describe, expect, it } from "vitest";
import {
  MAX_TYCOON_SLOTS,
  TYCOON_SLOT_BASE,
  TYCOON_SLOT_SPACING,
  clampTycoonSlot,
  nextFreeTycoonSlot,
  tycoonSlotOrigin,
  tycoonTheme,
} from "../../src/shared/tycoon-slots";

describe("tycoon slots", () => {
  it("keeps slot 0 on the original plot and steps the rest along +x", () => {
    expect(tycoonSlotOrigin(0)).toEqual({ x: TYCOON_SLOT_BASE.x, z: TYCOON_SLOT_BASE.z });
    expect(tycoonSlotOrigin(1)).toEqual({ x: 12 + TYCOON_SLOT_SPACING, z: 12 });
    expect(tycoonSlotOrigin(3).x - tycoonSlotOrigin(2).x).toBe(TYCOON_SLOT_SPACING);
  });

  it("gives every slot a plot that does not overlap its neighbour", () => {
    const xs = Array.from({ length: MAX_TYCOON_SLOTS }, (_, i) => tycoonSlotOrigin(i).x);
    expect(new Set(xs).size).toBe(MAX_TYCOON_SLOTS);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(14);
  });

  it("clamps bad slot numbers instead of producing NaN origins", () => {
    expect(clampTycoonSlot(-4)).toBe(0);
    expect(clampTycoonSlot(Number.NaN)).toBe(0);
    expect(clampTycoonSlot(1.7)).toBe(1);
    expect(clampTycoonSlot(MAX_TYCOON_SLOTS)).toBe(0);
    expect(clampTycoonSlot(MAX_TYCOON_SLOTS + 3)).toBe(3);
  });

  it("gives every slot a distinct accent colour", () => {
    const accents = Array.from({ length: MAX_TYCOON_SLOTS }, (_, i) => tycoonTheme(i).accent);
    expect(new Set(accents).size).toBe(MAX_TYCOON_SLOTS);
  });

  it("keeps slot 0 on the original green, gold and red pads", () => {
    const theme = tycoonTheme(0);
    expect(theme.collector).toBe(0x38a169);
    expect(theme.upgrade).toBe(0xd69e2e);
    expect(theme.trampoline).toBe(0xe53e3e);
  });

  it("allocates the lowest free slot and reuses slots released by leavers", () => {
    expect(nextFreeTycoonSlot([])).toBe(0);
    expect(nextFreeTycoonSlot([0])).toBe(1);
    expect(nextFreeTycoonSlot([0, 2])).toBe(1);
    expect(nextFreeTycoonSlot([1, 2])).toBe(0);
    expect(nextFreeTycoonSlot([0, 1, 2, 3, 4, 5, 6, 7])).toBe(0);
  });
});