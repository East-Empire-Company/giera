import { describe, expect, it } from "vitest";
import { createRoomSyncBuffer } from "../../src/client/game/room-sync-buffer";

type Edit = { x: number; y: number; z: number; id: number };

const edit = (x: number, id = x): Edit => ({ x, y: 1, z: 2, id });

describe("room sync buffer", () => {
  it("applies only matching pages in order and flushes live edits after sync", () => {
    const sync = createRoomSyncBuffer<Edit>();
    const applied: Edit[] = [];
    sync.start();
    sync.buffer(edit(1));
    expect(sync.begin("sync-1")).toBe(true);
    expect(sync.applyPage("sync-1", 1, [edit(99)], (item) => applied.push(item))).toBe(false);
    expect(sync.applyPage("sync-1", 0, [edit(2)], (item) => applied.push(item))).toBe(true);
    expect(sync.applyPage("sync-1", 0, [edit(3)], (item) => applied.push(item))).toBe(false);
    sync.buffer(edit(4));
    expect(sync.end("wrong", (item) => applied.push(item))).toBe(false);
    expect(sync.end("sync-1", (item) => applied.push(item))).toBe(true);
    expect(applied).toEqual([edit(2), edit(1), edit(4)]);
    expect(sync.syncing).toBe(false);
  });

  it("reports overflow without storing beyond its live-edit cap", () => {
    const sync = createRoomSyncBuffer<Edit>(2);
    sync.start();
    expect(sync.buffer(edit(1))).toBe("buffered");
    expect(sync.buffer(edit(2))).toBe("buffered");
    expect(sync.buffer(edit(3))).toBe("overflow");
    expect(sync.bufferedCount).toBe(2);
  });
});
