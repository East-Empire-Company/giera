// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { GameHUD } from "../../src/client/game/hud";
import { GameInventory } from "../../src/client/game/inventory";
import { ObjectiveManager } from "../../src/client/game/objectives";

describe("GameHUD child-friendly visual interface", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  it("renders large image icons for every hotbar slot without requiring reading", () => {
    const inventory = new GameInventory();
    const objectives = new ObjectiveManager();
    const hud = new GameHUD({ inventory, objectives });

    const slots = document.querySelectorAll(".hud-hotbar-slot");
    expect(slots.length).toBe(9);

    const firstIcon = slots[0].querySelector("img.hud-slot-icon") as HTMLImageElement;
    expect(firstIcon).not.toBeNull();
    expect(firstIcon.src).toContain(".png");
  });

  it("provides visual Xbox controller mapping modal", () => {
    const inventory = new GameInventory();
    const objectives = new ObjectiveManager();
    const hud = new GameHUD({ inventory, objectives });

    expect(hud.controlsBtn).toBeDefined();
    hud.toggleControlsModal();
    expect(hud.isControlsModalOpen()).toBe(true);

    const card = document.querySelector(".hud-controls-card");
    expect(card).not.toBeNull();
    expect(card?.innerHTML).toContain("RT");
    expect(card?.innerHTML).toContain("LT");
    expect(card?.innerHTML).toContain("A");
    expect(card?.innerHTML).toContain("X");
  });

  it("renders visual resource icons and recipe equations in inventory modal", () => {
    const inventory = new GameInventory();
    inventory.addMinedBlock("oak_log", 4);
    const objectives = new ObjectiveManager();
    const hud = new GameHUD({ inventory, objectives });

    hud.setInventoryOpen(true, inventory);

    const invIcon = document.querySelector("img.hud-inv-item-icon") as HTMLImageElement;
    expect(invIcon).not.toBeNull();
    expect(invIcon.src).toContain("oak_log_side.png");

    const recipeEquations = document.querySelectorAll(".hud-recipe-visual-equation");
    expect(recipeEquations.length).toBeGreaterThanOrEqual(5);

    const recipeIcons = document.querySelectorAll("img.hud-recipe-icon");
    expect(recipeIcons.length).toBeGreaterThan(0);
  });

  it("renders visual star spans in objective ribbon without requiring reading", () => {
    const inventory = new GameInventory();
    const objectives = new ObjectiveManager();
    const hud = new GameHUD({ inventory, objectives });

    const stars = document.querySelectorAll(".hud-star");
    expect(stars.length).toBe(4); // Step 0 has 4 wood target
    const objIcon = document.querySelector("img.hud-objective-icon") as HTMLImageElement;
    expect(objIcon).not.toBeNull();
    expect(objIcon.src).toContain("oak_log_side.png");
  });

  it("shows tycoon star count and tier in the HUD chip", () => {
    const inventory = new GameInventory();
    const objectives = new ObjectiveManager();
    const hud = new GameHUD({ inventory, objectives });

    const chip = document.querySelector(".hud-tycoon-chip");
    expect(chip).not.toBeNull();
    const chipIcon = chip?.querySelector("img") as HTMLImageElement;
    expect(chipIcon.src).toContain("star.png");

    hud.updateTycoon(7, 2);

    expect(document.querySelector(".hud-tycoon-stars")?.textContent).toBe("7");
    expect(document.querySelector(".hud-tycoon-tier")?.textContent).toBe("Poziom 2");

    hud.updateTycoon(7, 2);
    expect(document.querySelector(".hud-tycoon-stars")?.textContent).toBe("7");
    expect(document.querySelector(".hud-tycoon-tier")?.textContent).toBe("Poziom 2");
  });
});
