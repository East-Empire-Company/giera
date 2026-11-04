// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { GameHUD, getItemIcon } from "../../src/client/game/hud";
import { GameInventory } from "../../src/client/game/inventory";
import { ObjectiveManager } from "../../src/client/game/objectives";
import manifest from "../../src/shared/asset-manifest.json";

describe("GameHUD child-friendly visual interface", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  it.each(["asphalt", "paving", "brick", "plaster", "roof_tile"] as const)("resolves the %s HUD icon to its tile image", (block) => {
    expect(getItemIcon(block)).toBe(`/${manifest.tiles[block]}`);
  });

  it("renders large image icons for occupied hotbar slots without requiring reading", () => {
    const inventory = new GameInventory();
    inventory.addMinedBlock("oak_log", 1);
    const objectives = new ObjectiveManager();
    const hud = new GameHUD({ inventory, objectives });
    const slots = document.querySelectorAll(".hud-hotbar-slot");
    expect(slots.length).toBe(9);

    const firstIcon = slots[0].querySelector("img.hud-slot-icon") as HTMLImageElement;
    expect(firstIcon).not.toBeNull();
    expect(firstIcon.src).toContain(".png");
  });
  it("keeps music controls out of the HUD", () => {
    new GameHUD({ inventory: new GameInventory(), objectives: new ObjectiveManager() });
    expect(document.querySelector(".hud-music-btn")).toBeNull();
  });

  it("opens recipes from a visible backpack button", () => {
    const hud = new GameHUD({ inventory: new GameInventory(), objectives: new ObjectiveManager() });
    const button = document.querySelector<HTMLButtonElement>(".hud-inventory-btn");
    expect(button).not.toBeNull();
    button?.click();

    expect(hud.isInventoryOpen()).toBe(true);
    expect(document.querySelector(".hud-inventory-modal")?.classList.contains("hud-modal-open")).toBe(true);
    expect(document.querySelectorAll(".hud-recipe-row").length).toBeGreaterThan(0);
  });
  it("renders equipment tab in the inventory/crafting modal", () => {
    const inventory = new GameInventory();
    const objectives = new ObjectiveManager();
    const hud = new GameHUD({ inventory, objectives });

    const tabs = document.querySelectorAll(".hud-modal-tab");
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector(".hud-tab-crafting")).not.toBeNull();
    expect(document.querySelector(".hud-tab-equipment")).not.toBeNull();
  });

  it("allows equipping and unequipping wearable tools in the equipment tab", () => {
    const inventory = new GameInventory({ items: { wooden_pickaxe: 1 } });
    const objectives = new ObjectiveManager();
    const hud = new GameHUD({ inventory, objectives });

    hud.setInventoryOpen(true, inventory);
    const equipTab = document.querySelector<HTMLButtonElement>(".hud-tab-equipment");
    equipTab?.click();

    const equipBtn = document.querySelector<HTMLButtonElement>(".hud-equip-btn");
    expect(equipBtn).not.toBeNull();
    expect(equipBtn?.textContent).toBe("Załóż");

    equipBtn?.click();
    expect(inventory.equippedTool).toBe("wooden_pickaxe");
    expect(document.querySelector(".hud-equip-box")?.textContent).toContain("Drewniany Kilof");

    const unequipBtn = document.querySelector<HTMLButtonElement>(".hud-unequip-btn");
    unequipBtn?.click();
    expect(inventory.equippedTool).toBeNull();
    expect(document.querySelector(".hud-equip-box")?.textContent).toContain("Pusta ręka");
  });
  it("supports dragging and dropping items between hotbar slots", () => {
    const inventory = new GameInventory();
    inventory.addMinedBlock("oak_log", 2);
    inventory.addMinedBlock("stone", 2);
    const objectives = new ObjectiveManager();
    const hud = new GameHUD({ inventory, objectives });

    const slots = document.querySelectorAll(".hud-hotbar-slot");
    expect(slots[0].getAttribute("draggable")).toBe("true");

    // Simulate drag start on slot 0 and drop on slot 2
    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(k: string, v: string) { this.data[k] = v; },
      getData(k: string) { return this.data[k]; },
    };

    const dragStartEvent = new Event("dragstart", { bubbles: true }) as any;
    dragStartEvent.dataTransfer = dataTransfer;
    slots[0].dispatchEvent(dragStartEvent);

    const dropEvent = new Event("drop", { bubbles: true }) as any;
    dropEvent.dataTransfer = dataTransfer;
    dropEvent.preventDefault = () => {};
    slots[2].dispatchEvent(dropEvent);

    expect(inventory.hotbar[2]).toBe(7); // oak_log moved to slot 2
    expect(inventory.hotbar[0]).toBe(0); // slot 0 now empty
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

  it("releases keyboard focus after a HUD button click so Enter cannot re-trigger it", () => {
    const inventory = new GameInventory();
    const objectives = new ObjectiveManager();
    let toggles = 0;
    const hud = new GameHUD({ inventory, objectives, onToggleSplitScreen: () => ++toggles % 2 === 1 });
    hud.modeBtn.focus();
    expect(document.activeElement).toBe(hud.modeBtn);
    hud.modeBtn.click();
    expect(toggles).toBe(1);
    expect(document.activeElement).not.toBe(hud.modeBtn);
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

  it("shows tycoon stars, vault coins, next upgrade cost, and tier", () => {
    const inventory = new GameInventory();
    const objectives = new ObjectiveManager();
    const hud = new GameHUD({ inventory, objectives });
    const chip = document.querySelector(".hud-tycoon-chip");
    expect(chip).not.toBeNull();

    expect((chip?.querySelector(".hud-tycoon-stars-icon") as HTMLImageElement).src).toContain("star.png");
    expect((chip?.querySelector(".hud-tycoon-vault-icon") as HTMLImageElement).src).toContain("ore_gold.png");
    expect((chip?.querySelector(".hud-tycoon-upgrade-icon") as HTMLImageElement).src).toContain("star.png");

    hud.updateTycoon(7, 3, 2, 10);

    expect(chip?.querySelector(".hud-tycoon-stars")?.textContent).toBe("7");
    expect(chip?.querySelector(".hud-tycoon-vault")?.textContent).toBe("3");
    expect(chip?.querySelector(".hud-tycoon-upgrade-cost")?.textContent).toBe("10");
    expect(chip?.querySelector(".hud-tycoon-tier")?.textContent).toBe("Poziom 2");

    hud.updateTycoon(7, 3, 2, 10);
    expect(chip?.querySelector(".hud-tycoon-vault")?.textContent).toBe("3");
    expect(chip?.querySelector(".hud-tycoon-upgrade-cost")?.textContent).toBe("10");
  });

  it("shows and positions world-anchored NPC speech bubbles", () => {
    const inventory = new GameInventory();
    const objectives = new ObjectiveManager();
    const hud = new GameHUD({ inventory, objectives });

    hud.showNpcSpeech("tata", "Tata", "Zbierz drewno!");
    const bubble = document.querySelector(".hud-npc-speech")!;
    expect(bubble).not.toBeNull();
    expect(bubble.querySelector(".hud-npc-speech-name")?.textContent).toBe("Tata:");
    expect(bubble.querySelector(".hud-npc-speech-text")?.textContent).toBe("Zbierz drewno!");

    hud.updateNpcSpeech((id) => (id === "tata" ? { x: 120, y: 80, visible: true } : null));
    expect(bubble.classList.contains("visible")).toBe(true);
    expect((bubble as HTMLElement).style.left).toBe("120px");
    expect((bubble as HTMLElement).style.top).toBe("80px");

    hud.updateNpcSpeech(() => null);
    expect(bubble.classList.contains("visible")).toBe(false);

    hud.showNpcSpeech("tata", "Tata", "Nowa wiadomość");
    expect(bubble.querySelector(".hud-npc-speech-text")?.textContent).toBe("Nowa wiadomość");
    expect(document.querySelectorAll(".hud-npc-speech").length).toBe(1);
  });
  it("shows an icon-first wood pickup cue at its projected world position", () => {
    const hud = new GameHUD({ inventory: new GameInventory(), objectives: new ObjectiveManager() });
    hud.showResourceGain("oak_log", 1, { x: 120, y: 80 });
    const cue = document.querySelector<HTMLElement>(".hud-resource-gain")!;
    expect(cue.classList.contains("visible")).toBe(true);
    expect(cue.querySelector("img")?.src).toContain("oak_log_side.png");
    expect(cue.querySelector(".hud-resource-count")?.textContent).toBe("+1");
    expect(cue.style.left).toBe("120px");
    expect(cue.style.top).toBe("80px");
  });
});
