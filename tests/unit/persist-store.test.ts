// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatSaveData,
  loadGameState,
  parseSaveData,
  saveGameState,
  type SavedGameState,
} from "../../src/client/persist/db";

const state: SavedGameState = {
  seed: 424242,
  inventory: {
    creative: false,
    activeSlot: 4,
    hotbar: [3, 9, 4, 10, 7, 6, 8, 2, 5],
    blocks: { oak_log: 5, stone: 12 },
    items: { stick: 4 },
    chunkEdits: { "0,0,0": 9 },
  },
  objectives: { stepIndex: 2, currentProgress: 1 },
  edits: { "0,0,0": 9 },
  savedAt: "2026-10-24T18:30:00.000Z",
};

describe("save store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a save through the storage fallback", async () => {
    await saveGameState(state);

    const loaded = await loadGameState();
    expect(loaded?.seed).toBe(424242);
    expect(loaded?.inventory.activeSlot).toBe(4);
    expect(loaded?.inventory.chunkEdits["0,0,0"]).toBe(9);
    expect(loaded?.edits["0,0,0"]).toBe(9);
  });

  it("returns null when nothing was saved", async () => {
    expect(await loadGameState()).toBeNull();
  });

  it("does not throw when no storage backend exists", async () => {
    vi.stubGlobal("localStorage", undefined);

    await expect(saveGameState(state)).resolves.toBeUndefined();
    expect(await loadGameState()).toBeNull();
  });

  it("rejects malformed and incomplete save payloads", () => {
    expect(parseSaveData("{not json")).toBeNull();
    expect(parseSaveData(JSON.stringify({ inventory: state.inventory }))).toBeNull();
    expect(parseSaveData(JSON.stringify({ seed: "424242", inventory: state.inventory }))).toBeNull();
    expect(parseSaveData(JSON.stringify({ seed: 1 }))).toBeNull();
  });

  it("serializes save state to JSON", () => {
    const raw = formatSaveData(state);
    expect(JSON.parse(raw).seed).toBe(424242);
    expect(parseSaveData(raw)?.objectives.stepIndex).toBe(2);
  });
});
