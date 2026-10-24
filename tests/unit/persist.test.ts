import { describe, expect, it } from "vitest";
import { formatSaveData, parseSaveData, type SavedGameState } from "../../src/client/persist/db";

describe("GameState persistence", () => {
  it("formats and validates game save data structure", () => {
    const state: SavedGameState = {
      seed: 424242,
      inventory: {
        creative: true,
        activeSlot: 2,
        hotbar: [3, 9, 4, 10, 7, 6, 8, 2, 5],
        blocks: { oak_log: 5, stone: 12 },
        items: { stick: 4 },
        chunkEdits: {},
      },
      objectives: {
        stepIndex: 2,
        currentProgress: 1,
      },
      edits: {
        "0,0,0": 9,
      },
      savedAt: "2026-10-24T18:30:00.000Z",
    };

    const serialized = formatSaveData(state);
    expect(typeof serialized).toBe("string");

    const parsed = parseSaveData(serialized);
    expect(parsed?.seed).toBe(424242);
    expect(parsed?.inventory.blocks.oak_log).toBe(5);
    expect(parsed?.objectives.stepIndex).toBe(2);
  });
});
