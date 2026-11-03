import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearGameState, loadGameState, saveGameState } from "../../src/client/persist/db";
import { ACTIVE_LAN_ROOM_KEY } from "../../src/client/game/save-session";
import { clearProgress, createBackup, readBackups, restoreBackup } from "../../src/client/concierge/backups";

vi.mock("../../src/client/persist/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/persist/db")>();
  return {
    ...actual,
    clearGameState: vi.fn(),
    loadGameState: vi.fn(),
    saveGameState: vi.fn(),
  };
});

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const session = new MemoryStorage();
const storage = new MemoryStorage();
const roomKey = "room:ws://host.test:8080:family";
const state = { seed: 42, edits: [], savedAt: "2026-11-02T00:00:00.000Z" };

beforeEach(() => {
  session.removeItem(ACTIVE_LAN_ROOM_KEY);
  storage.removeItem("giera_concierge_backups");
  storage.removeItem(`giera_concierge_backups:${roomKey}`);
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session });
  vi.mocked(loadGameState).mockReset().mockResolvedValue(state as never);
  vi.mocked(saveGameState).mockReset().mockResolvedValue(true);
  vi.mocked(clearGameState).mockReset().mockResolvedValue(undefined);
});

describe("concierge backups per save session", () => {
  it("creates, lists, restores, and clears only active room progress", async () => {
    session.setItem(ACTIVE_LAN_ROOM_KEY, JSON.stringify({ url: "ws://host.test:8080/ws", room: "Family" }));
    const backup = await createBackup("room copy", new Date("2026-11-02T00:00:00.000Z"), storage as never);
    expect(loadGameState).toHaveBeenCalledWith(roomKey);
    expect(storage.getItem("giera_concierge_backups")).toBeNull();
    expect(readBackups(storage as never)).toHaveLength(1);
    expect(await restoreBackup(backup!.id, storage as never)).toBe(true);
    expect(saveGameState).toHaveBeenCalledWith(state, roomKey);
    await clearProgress();
    expect(clearGameState).toHaveBeenCalledWith(roomKey);
    session.removeItem(ACTIVE_LAN_ROOM_KEY);
    expect(readBackups(storage as never)).toHaveLength(0);
  });

  it("keeps legacy offline backup list under its original key", () => {
    storage.setItem("giera_concierge_backups", JSON.stringify([{ id: "offline", label: "offline", createdAt: "now", state }]));
    expect(readBackups(storage as never).map((entry) => entry.id)).toEqual(["offline"]);
  });
});
