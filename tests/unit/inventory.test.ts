import { describe, expect, it } from "vitest";
import { GameInventory } from "../../src/client/game/inventory";

describe("GameInventory", () => {
  it("initializes default 9 hotbar slots with starter blocks", () => {
    const inv = new GameInventory({ creative: true });
    expect(inv.hotbar.length).toBe(9);
    expect(inv.activeSlot).toBe(0);
    expect(inv.activeBlockId).toBeGreaterThan(0);
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
