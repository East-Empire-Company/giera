import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearGameState, loadGameState, roomSaveKey, saveGameState, type SavedGameState } from "../../src/client/persist/db";

type PendingRequest = { key: string; value?: unknown; ok: boolean };
class FakeStore {
  entries = new Map<string, unknown>();
  mode: "open" | "fail" = "open";
  request(pending: PendingRequest) {
    let result: unknown;
    const ok = pending.ok && this.mode === "open";
    if (ok) {
      if (pending.value !== undefined) this.entries.set(pending.key, pending.value);
      else result = this.entries.get(pending.key);
    }
    return {
      result,
      set onsuccess(cb: () => void) {
        if (ok) queueMicrotask(cb);
      },
      set onerror(cb: () => void) {
        if (!ok) queueMicrotask(cb);
      },
    };
  }
  remove(key: string) {
    let result: unknown;
    const ok = this.mode === "open";
    if (ok) this.entries.delete(key);
    return {
      result,
      set onsuccess(cb: () => void) {
        if (ok) queueMicrotask(cb);
      },
      set onerror(cb: () => void) {
        if (!ok) queueMicrotask(cb);
      },
    };
  }
}

const store = new FakeStore();
const localStorageBacking = new Map<string, string>();

const state = (seed: number): SavedGameState => ({
  seed,
  inventory: { creative: true, activeSlot: 0, hotbar: [0, 0, 0, 0, 0, 0, 0, 0, 0], blocks: {}, items: {}, chunkEdits: {} },
  objectives: { stepIndex: 0, currentProgress: 0 },
  edits: {},
  savedAt: "2026-11-02T00:00:00.000Z",
});

beforeEach(() => {
  store.entries.clear();
  store.mode = "open";
  localStorageBacking.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => localStorageBacking.get(k) ?? null,
    setItem: (k: string, v: string) => {
      localStorageBacking.set(k, v);
    },
    removeItem: (k: string) => {
      localStorageBacking.delete(k);
    },
  });
  vi.stubGlobal("indexedDB", {
    open: () => ({
      set onsuccess(cb: () => void) {
        queueMicrotask(cb);
      },
      set onerror(_cb: () => void) {},
      result: {
        objectStoreNames: { contains: () => true },
        transaction: (_name: string, _mode: string) => ({
          objectStore: () => ({
            put: (value: unknown, key: string) => store.request({ key, value, ok: store.mode === "open" }),
            get: (key: string) => store.request({ key, ok: store.mode === "open" }),
            delete: (key: string) => store.remove(key),
          }),
        }),
      },
    }),
  });
});

describe("keyed game persistence", () => {
  it("derives a normalized per-room save key", () => {
    expect(roomSaveKey("ws://192.168.1.5:8080", "Dom 1")).toBe("room:ws://192.168.1.5:8080:dom1");
  });

  it("isolates saves per key and reports success after the transaction completes", async () => {
    expect(await saveGameState(state(111), "room:a:x")).toBe(true);
    expect(await saveGameState(state(222), "room:b:y")).toBe(true);
    expect((await loadGameState("room:a:x"))?.seed).toBe(111);
    expect((await loadGameState("room:b:y"))?.seed).toBe(222);
    expect((await loadGameState("last_save")) ?? null).toBeNull();
  });

  it("falls back to localStorage and still reports success", async () => {
    store.mode = "fail";
    expect(await saveGameState(state(333), "room:c:z")).toBe(true);
    expect(localStorageBacking.get("room:c:z")).toContain("333");
    expect((await loadGameState("room:c:z"))?.seed).toBe(333);
  });

  it("reports failure when neither store persists", async () => {
    store.mode = "fail";
    vi.stubGlobal("localStorage", undefined);
    expect(await saveGameState(state(444), "room:d:w")).toBe(false);
  });

  it("clears only the named key", async () => {
    await saveGameState(state(1), "room:a:x");
    await saveGameState(state(2), "room:b:y");
    await clearGameState("room:a:x");
    expect((await loadGameState("room:a:x")) ?? null).toBeNull();
    expect((await loadGameState("room:b:y"))?.seed).toBe(2);
  });
});
