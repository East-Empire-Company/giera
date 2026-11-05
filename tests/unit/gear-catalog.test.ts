import { describe, expect, it } from "vitest";
import { GEAR_CATALOG, gearBonus } from "../../src/shared/gear-catalog";

describe("gear catalog", () => {
  it("keeps every existing recipe bonus and adds the three HQ rewards", () => {
    expect(gearBonus("wooden_pickaxe")).toEqual({ material: "stone", speedMultiplier: 1.8 });
    expect(gearBonus("wooden_sword")).toEqual({ material: "combat", speedMultiplier: 2 });
    expect(gearBonus("stone_pickaxe")).toEqual({ material: "stone", speedMultiplier: 2.5 });
    expect(gearBonus("stone_axe")).toEqual({ material: "wood", speedMultiplier: 3 });
    expect(gearBonus("iron_pickaxe")).toEqual({ material: "stone", speedMultiplier: 3.5 });
    expect(gearBonus("iron_axe")).toEqual({ material: "wood", speedMultiplier: 4 });
    expect(gearBonus("iron_sword")).toEqual({ material: "combat", speedMultiplier: 3.5 });
    expect(gearBonus("star_pickaxe")).toEqual({ material: "stone", speedMultiplier: 5 });
    expect(gearBonus("star_axe")).toEqual({ material: "wood", speedMultiplier: 5 });
    expect(gearBonus("pulse_sword")).toEqual({ material: "combat", speedMultiplier: 4.5 });
    expect(gearBonus("stick")).toBeUndefined();
    expect(GEAR_CATALOG).toHaveLength(10);
  });

  it("provides equipment metadata from the same definitions", () => {
    expect(GEAR_CATALOG.find((gear) => gear.item === "pulse_sword")).toMatchObject({
      name: "Miecz Pulsujący",
      type: "Broń",
    });
    expect(GEAR_CATALOG.find((gear) => gear.item === "star_pickaxe")).toMatchObject({
      name: "Gwiezdny Kilof",
      type: "Narzędzie",
    });
  });
});
