import { describe, expect, it } from "vitest";
import { RECIPES, canCraft, craftRecipe, type InventoryState } from "../../src/client/game/recipes";

describe("crafting recipes", () => {
  it("defines expanded Polish sandbox recipes with correct costs and outputs", () => {
    const ids = RECIPES.map((r) => r.id);
    expect(ids).toContain("stick");
    expect(ids).toContain("planks");
    expect(ids).toContain("stone_pickaxe");
    expect(ids).toContain("stone_axe");
    expect(ids).toContain("iron_pickaxe");
    expect(ids).toContain("iron_axe");
    expect(ids).toContain("iron_sword");
    expect(ids).toContain("wooden_pickaxe");
    expect(ids).toContain("wooden_sword");

    const stick = RECIPES.find((r) => r.id === "stick")!;
    expect(stick.name).toBe("Patyk");
    expect(stick.cost).toEqual({ oak_log: 3 });
    expect(stick.output).toEqual({ item: "stick", count: 4 });

    const planks = RECIPES.find((r) => r.id === "planks")!;
    expect(planks.name).toBe("Deska");
    expect(planks.cost).toEqual({ oak_log: 4 });
    expect(planks.output).toEqual({ item: "planks", count: 4 });

    const axe = RECIPES.find((r) => r.id === "stone_axe")!;
    expect(axe.name).toBe("Kamienny Toporek");
    expect(axe.cost).toEqual({ stick: 2, cobblestone: 3 });
    expect(axe.output).toEqual({ item: "stone_axe", count: 1 });
  });

  it("evaluates canCraft based on current inventory counts", () => {
    const inv: InventoryState = {
      blocks: { oak_log: 3 },
      items: {},
    };
    expect(canCraft(inv, "stick")).toBe(true);
    expect(canCraft(inv, "planks")).toBe(false);
  });

  it("crafts recipe by deducting cost and adding output", () => {
    const inv: InventoryState = {
      blocks: { oak_log: 4 },
      items: {},
    };
    const ok = craftRecipe(inv, "planks");
    expect(ok).toBe(true);
    expect(inv.blocks.oak_log).toBe(0);
    expect(inv.blocks.planks ?? 0).toBe(4);
  });

  it("fails gracefully when resources are insufficient", () => {
    const inv: InventoryState = {
      blocks: { oak_log: 2 },
      items: {},
    };
    const ok = craftRecipe(inv, "stick");
    expect(ok).toBe(false);
    expect(inv.blocks.oak_log).toBe(2);
  });
});
