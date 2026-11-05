import { describe, expect, it } from "vitest";
import { BLOCK_ID, isStoneFamily } from "../../src/shared/blocks";
import { GameInventory } from "../../src/client/game/inventory";

describe("GameInventory", () => {
  it("initializes 9 empty hotbar slots by default", () => {
    const inv = new GameInventory();
    expect(inv.hotbar.length).toBe(9);
    expect(inv.hotbar.every((slot) => slot === 0)).toBe(true);
    expect(inv.activeBlockId).toBe(0);
  });

  it("fills hotbar slots when gathering materials", () => {
    const inv = new GameInventory();
    inv.addMinedBlock("oak_log", 1);
    expect(inv.hotbar[0]).toBe(7); // oak_log block id = 7
    inv.addMinedBlock("stone", 1);
    expect(inv.hotbar[1]).toBe(2); // stone block id = 2
    // duplicate mined block does not occupy another hotbar slot
    inv.addMinedBlock("oak_log", 3);
    expect(inv.hotbar[0]).toBe(7);
    expect(inv.hotbar[1]).toBe(2);
    expect(inv.hotbar[2]).toBe(0);
  });

  it("swaps items between hotbar slots", () => {
    const inv = new GameInventory({ hotbar: [7, 2, 0, 0, 0, 0, 0, 0, 0] as any });
    inv.swapHotbarSlots(0, 1);
    expect(inv.hotbar[0]).toBe(2);
    expect(inv.hotbar[1]).toBe(7);
  });

  it("clears a hotbar slot (dragging out)", () => {
    const inv = new GameInventory({ hotbar: [7, 2, 0, 0, 0, 0, 0, 0, 0] as any });
    inv.clearHotbarSlot(0);
    expect(inv.hotbar[0]).toBe(0);
  });

  it("syncs hotbar with available blocks after crafting or state updates", () => {
    const inv = new GameInventory({
      creative: false,
      hotbar: [7, 0, 0, 0, 0, 0, 0, 0, 0] as any,
      blocks: { oak_log: 0, planks: 4 },
    });
    // oak_log count is 0, planks count is 4 (BLOCK_ID.planks is 9)
    inv.syncHotbarWithBlocks();
    expect(inv.hotbar[0]).toBe(9); // planks filled into empty slot, depleted oak_log removed
  });

  it("equips and un-equips wearable tools or weapons", () => {
    const inv = new GameInventory({
      items: { wooden_pickaxe: 1 },
    });
    expect(inv.equippedTool).toBeNull();
    const ok = inv.equipTool("wooden_pickaxe");
    expect(ok).toBe(true);
    expect(inv.equippedTool).toBe("wooden_pickaxe");

    // Unequip
    inv.equipTool(null);
    expect(inv.equippedTool).toBeNull();

    // Cannot equip unowned tool
    const fail = inv.equipTool("iron_sword");
    expect(fail).toBe(false);
    expect(inv.equippedTool).toBeNull();
  });

  it("computes mining speed multiplier from equipped tool and owned tools", () => {
    const inv = new GameInventory({
      items: { wooden_pickaxe: 1, iron_axe: 1 },
    });
    // stone block (id 2) -> wooden_pickaxe has 1.8x speed on stone
    expect(inv.getMiningSpeedMultiplier(2)).toBe(1.8);
    // oak_log block (id 7) -> iron_axe has 4x speed on wood
    expect(inv.getMiningSpeedMultiplier(7)).toBe(4);
    // dirt block (id 4) -> 1.0x
    expect(inv.getMiningSpeedMultiplier(4)).toBe(1);

    // If iron_pickaxe is added and equipped, stone gets 3.5x
    inv.items.iron_pickaxe = 1;
    inv.equipTool("iron_pickaxe");
    expect(inv.getMiningSpeedMultiplier(2)).toBe(3.5);
  });
  it("uses exact HQ mining and combat multipliers without changing older tools", () => {
    const inv = new GameInventory({
      items: { star_pickaxe: 1, star_axe: 1, pulse_sword: 1, wooden_sword: 1 },
    });
    expect(inv.getMiningSpeedMultiplier(BLOCK_ID.stone)).toBe(5);
    expect(inv.getMiningSpeedMultiplier(BLOCK_ID.oak_log)).toBe(5);
    expect(inv.getCombatMultiplier()).toBe(4.5);

    inv.equipTool("wooden_sword");
    expect(inv.getCombatMultiplier()).toBe(2);
    inv.equipTool("pulse_sword");
    expect(inv.getCombatMultiplier()).toBe(4.5);
    expect(new GameInventory().getCombatMultiplier()).toBe(1);
  });

  it("puts each rewarded HQ block into an empty hotbar slot", () => {
    const inv = new GameInventory();
    for (const [index, key] of ["hero_floor", "hero_wall", "hero_glass", "neon_block"].entries()) {
      inv.addMinedBlock(key, 8);
      expect(inv.getBlockCount(key)).toBe(8);
      expect(inv.hotbar[index]).toBe(BLOCK_ID[key as keyof typeof BLOCK_ID]);
    }
  });

  it("treats city construction blocks as non-stone mining targets", () => {
    const inv = new GameInventory({ items: { wooden_pickaxe: 1 } });

    for (const blockId of [15, 16, 17, 18, 19]) {
      expect(inv.getMiningSpeedMultiplier(blockId)).toBe(1);
    }
    for (const blockId of [BLOCK_ID.stone, BLOCK_ID.cobblestone, BLOCK_ID.coal_ore, BLOCK_ID.iron_ore, BLOCK_ID.gold_ore]) {
      expect(inv.getMiningSpeedMultiplier(blockId)).toBe(1.8);
    }
  });

  it("classifies only stone, cobblestone, and current ores as stone family", () => {
    for (const blockId of [BLOCK_ID.stone, BLOCK_ID.cobblestone, BLOCK_ID.coal_ore, BLOCK_ID.iron_ore, BLOCK_ID.gold_ore]) {
      expect(isStoneFamily(blockId)).toBe(true);
    }
    for (const blockId of [BLOCK_ID.asphalt, BLOCK_ID.paving, BLOCK_ID.brick, BLOCK_ID.plaster, BLOCK_ID.roof_tile]) {
      expect(isStoneFamily(blockId)).toBe(false);
    }
  });

  it("cycles hotbar slots via scroll or direct selection", () => {
    const inv = new GameInventory();
    inv.selectSlot(3);
    expect(inv.activeSlot).toBe(3);

    inv.cycleSlot(1);
    expect(inv.activeSlot).toBe(4);

    inv.cycleSlot(-1);
    expect(inv.activeSlot).toBe(3);

    inv.selectSlot(8);
    inv.cycleSlot(1);
    expect(inv.activeSlot).toBe(0);
  });

  it("adds mined blocks to inventory", () => {
    const inv = new GameInventory();
    inv.addMinedBlock("oak_log", 2);
    expect(inv.getBlockCount("oak_log")).toBe(2);

    inv.addMinedBlock("oak_log", 3);
    expect(inv.getBlockCount("oak_log")).toBe(5);
  });

  it("handles creative placement without reducing count", () => {
    const inv = new GameInventory({ creative: true });
    inv.addMinedBlock("stone", 1);
    const placed = inv.consumeBlockForPlacement("stone");
    expect(placed).toBe(true);
    expect(inv.getBlockCount("stone")).toBe(1);
  });

  it("syncs crafted TNT onto the hotbar and consumes it in survival", () => {
    const inv = new GameInventory({ creative: false });
    inv.addMinedBlock("tnt", 3);
    inv.syncHotbarWithBlocks();
    expect(inv.hotbar.some((slot) => slot === BLOCK_ID.tnt)).toBe(true);
    expect(inv.consumeBlockForPlacement("tnt")).toBe(true);
    expect(inv.getBlockCount("tnt")).toBe(2);
    inv.consumeBlockForPlacement("tnt");
    inv.consumeBlockForPlacement("tnt");
    expect(inv.getBlockCount("tnt")).toBe(0);
    inv.syncHotbarWithBlocks();
    expect(inv.hotbar.some((slot) => slot === BLOCK_ID.tnt)).toBe(false);
  });

  it("tracks and limits chunk block edits to 20,000", () => {
    const inv = new GameInventory();
    const chunkKey = "0,0";
    expect(inv.canEditChunk(chunkKey)).toBe(true);

    inv.recordChunkEdit(chunkKey, 19999);
    expect(inv.canEditChunk(chunkKey)).toBe(true);

    inv.recordChunkEdit(chunkKey, 1);
    expect(inv.canEditChunk(chunkKey)).toBe(false);
  });

  it("serializes to and from JSON", () => {
    const inv = new GameInventory();
    inv.addMinedBlock("dirt", 12);
    inv.selectSlot(4);
    const snapshot = inv.toJSON();

    const restored = GameInventory.fromJSON(snapshot);
    expect(restored.getBlockCount("dirt")).toBe(12);
    expect(restored.activeSlot).toBe(4);
  });
});
