import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanClient } from "../../src/client/net/client";
import { roomSaveKey } from "../../src/client/persist/db";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  emit(data: unknown): void {
    this.onmessage?.({ data });
  }
  parsedSent(): Record<string, unknown>[] {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }
}

const makeClient = (callbacks: ConstructorParameters<typeof LanClient>[0]["callbacks"]) => {
  const client = new LanClient({ url: "ws://127.0.0.1:8080/ws", room: "DOM1", playerName: "Ziemek", callbacks });
  client.connect();
  FakeWebSocket.instances[0].open();
  return client;
};

describe("LanClient companion transport", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  it("sends companion lifecycle and build messages", () => {
    const client = makeClient({});
    client.sendCompanionSpawn("mina");
    client.sendCompanionState({ id: "cmp_1", profile: "mina", x: 1.5, y: 41, z: 2.5, yaw: 0, anim: "walk" });
    client.sendCompanionRemove("cmp_1");
    client.sendCompanionCommand("follow", 3);
    client.sendCompanionStop();
    client.sendCompanionPlace("cmp_1", "bp_1", 4);
    client.sendCompanionSay("cmp_1", "found_stone", { block: "3", x: 1, y: 2, z: 3 });
    client.sendBuildPreview(7);
    client.sendBuildConfirm("bp_1");
    client.roomSyncAck("sync_1", 0);
    client.roomSyncStart();
    client.roomSyncAbort("sync_1");

    expect(FakeWebSocket.instances[0].parsedSent().slice(1)).toEqual([
      { t: "companion_spawn", profile: "mina" },
      { t: "companion_state", companion: { id: "cmp_1", profile: "mina", x: 1.5, y: 41, z: 2.5, yaw: 0, anim: "walk" } },
      { t: "companion_remove", id: "cmp_1" },
      { t: "companion_command", task: "follow", expectedGeneration: 3 },
      { t: "companion_stop" },
      { t: "companion_place", id: "cmp_1", planId: "bp_1", blockIndex: 4 },
      { t: "companion_say", id: "cmp_1", line: "found_stone", evidence: { block: "3", x: 1, y: 2, z: 3 } },
      { t: "build_preview", requestId: expect.any(String), expectedGeneration: 7 },
      { t: "build_confirm", planId: "bp_1" },
      { t: "room_sync_ack", syncId: "sync_1", index: 0 },
      { t: "room_sync_start" },
      { t: "room_sync_abort", syncId: "sync_1" },
    ]);
  });

  it("dispatches companion and sync messages to callbacks", () => {
    const seen: Record<string, unknown>[] = [];
    const client = makeClient({
      onCompanionState: (m) => seen.push(m),
      onCompanionRemove: (m) => seen.push(m),
      onCompanionCommand: (m) => seen.push(m),
      onOwnerChanged: (m) => seen.push(m),
      onCompanionError: (m) => seen.push(m),
      onCompanionSay: (m) => seen.push(m),
      onBuildPreview: (m) => seen.push(m),
      onBuildReserved: (m) => seen.push(m),
      onBuildCancelled: (m) => seen.push(m),
      onRoomSyncBegin: (m) => seen.push(m),
      onRoomSyncPage: (m) => seen.push(m),
      onRoomSyncEnd: (m) => seen.push(m),
    });
    const sock = FakeWebSocket.instances[0];
    sock.emit(JSON.stringify({ t: "companion_state", companion: { id: "c1" } }));
    sock.emit(JSON.stringify({ t: "companion_remove", id: "c1" }));
    sock.emit(JSON.stringify({ t: "companion_command", task: "scout", by: "p2", generation: 2 }));
    sock.emit(JSON.stringify({ t: "owner_changed", ownerId: "p2" }));
    sock.emit(JSON.stringify({ t: "companion_error", message: "nie" }));
    sock.emit(JSON.stringify({ t: "companion_say", id: "c1", line: "follow" }));
    sock.emit(JSON.stringify({ t: "build_preview", requestId: "r", planId: "bp", blocks: [] }));
    sock.emit(JSON.stringify({ t: "build_reserved", planId: "bp", blocks: [] }));
    sock.emit(JSON.stringify({ t: "build_cancelled", planId: "bp", reason: "x" }));
    sock.emit(JSON.stringify({ t: "room_sync_begin", syncId: "s" }));
    sock.emit(JSON.stringify({ t: "room_sync_page", syncId: "s", index: 0, edits: [{ x: 1, y: 2, z: 3, id: 4 }] }));
    sock.emit(JSON.stringify({ t: "room_sync_end", syncId: "s" }));

    expect(seen.map((m) => m.t)).toEqual([
      "companion_state", "companion_remove", "companion_command", "owner_changed", "companion_error",
      "companion_say", "build_preview", "build_reserved", "build_cancelled", "room_sync_begin", "room_sync_page", "room_sync_end",
    ]);
  });

  it("builds the per-room save key from the websocket origin", () => {
    expect(roomSaveKey("ws://192.168.1.5:8080", "Dom 1")).toBe("room:ws://192.168.1.5:8080:dom1");
    expect(roomSaveKey("wss://giera.example", "K7QX")).toBe("room:wss://giera.example:k7qx");
  });
});
