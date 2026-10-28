import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomState } from "../../server/room";
import {
  MAX_ANIM_LENGTH,
  MAX_FIRST_INPUT_DISTANCE,
  MAX_COORD,
  MAX_EDITS_PER_ROOM,
  MAX_NAME_LENGTH,
  MAX_ROOM_CODE_LENGTH,
  createRoomRegistry,
  createWsConnection,
  handleWsClose,
  handleWsMessage,
  normalizeRoomCode,
  type WsDeps,
  type WsSocket,
} from "../../server/ws-handler";
import { BLOCK_ID } from "../../src/shared/blocks";
import { decodeBinaryChunkFrame, MAX_PLAYER_SPEED } from "../../src/shared/lan-protocol";
import { decodeRLE, getBlockIndex } from "../../src/shared/chunk";
import { generateChunk } from "../../src/shared/worldgen";

type Harness = {
  deps: WsDeps;
  published: { topic: string; msg: any }[];
  clock: { now: number };
  connect(id: string): WsSocket & { sent: (string | Uint8Array)[]; subscriptions: string[] };
  room(code: string): RoomState;
};

function harness(maxRooms = 64): Harness {
  const clock = { now: 1_000_000 };
  const published: { topic: string; msg: any }[] = [];
  const rooms = createRoomRegistry(maxRooms, (code) => new RoomState(code, 777, 2));
  const deps: WsDeps = {
    rooms,
    publish: (topic, payload) => published.push({ topic, msg: JSON.parse(payload) }),
    now: () => clock.now,
  };
  return {
    deps,
    published,
    clock,
    connect(id) {
      const sent: (string | Uint8Array)[] = [];
      const subscriptions: string[] = [];
      return {
        data: createWsConnection(id, clock.now),
        send: (p) => sent.push(p),
        subscribe: (t) => subscriptions.push(t),
        sent,
        subscriptions,
      };
    },
    room: (code) => rooms.get(code)!,
  };
}

const send = (ws: WsSocket, deps: WsDeps, msg: unknown) => handleWsMessage(ws, JSON.stringify(msg), deps);
const hello = (room = "dom1", name = "Ziemek") => ({ t: "hello", name, room });
const input = (x: number, y: number, z: number) => ({ t: "input", seq: 1, x, y, z, yaw: 0.5, pitch: -0.25, anim: "walk" });

function join(h: Harness, id = "p1", room = "DOM1") {
  const ws = h.connect(id);
  send(ws, h.deps, hello(room));
  h.published.length = 0;
  return ws;
}

afterEach(() => vi.unstubAllGlobals());

describe("ws hello", () => {
  it("normalizes the room code, welcomes the player with the room seed and publishes join", () => {
    const h = harness();
    const ws = h.connect("p1");
    send(ws, h.deps, hello("  k7qx ", "Ziemek"));

    expect(ws.subscriptions).toEqual(["room:K7QX"]);
    const welcome = JSON.parse(ws.sent[0] as string);
    expect(welcome).toMatchObject({ t: "welcome", id: "p1", seed: 777, players: [] });
    expect(welcome.spawn).toHaveLength(3);
    expect(h.published).toEqual([{ topic: "room:K7QX", msg: { t: "join", id: "p1", name: "Ziemek" } }]);
    expect(h.room("K7QX").getPlayerCount()).toBe(1);
  });

  it("falls back to room DOM1 and name Gracz when both are blank", () => {
    const h = harness();
    const ws = h.connect("p1");
    send(ws, h.deps, { t: "hello", name: "", room: "   " });
    expect(ws.data.roomCode).toBe("DOM1");
    expect(ws.data.name).toBe("Gracz");
  });

  it("lists players already in the room in the welcome", () => {
    const h = harness();
    join(h, "p1");
    const ws = h.connect("p2");
    send(ws, h.deps, hello("DOM1", "Gniewko"));
    const welcome = JSON.parse(ws.sent[0] as string);
    expect(welcome.players.map((p: { id: string }) => p.id)).toEqual(["p1"]);
  });

  it("truncates over-long names and replaces non-string names with Gracz", () => {
    const h = harness();
    const a = h.connect("a");
    send(a, h.deps, hello("DOM1", "N".repeat(MAX_NAME_LENGTH + 20)));
    expect(a.data.name).toBe("N".repeat(MAX_NAME_LENGTH));
    const b = h.connect("b");
    send(b, h.deps, { t: "hello", name: { evil: 1 }, room: "DOM1" });
    expect(b.data.name).toBe("Gracz");
  });

  it.each([
    ["non-string room", 42],
    ["null room", null],
    ["object room", { a: 1 }],
    ["path traversal", "../../etc/passwd"],
    ["lower-case slash", "a/b"],
    ["unicode", "ŻÓŁW"],
    ["over-long", "A".repeat(MAX_ROOM_CODE_LENGTH + 1)],
    ["whitespace inside", "AB CD"],
  ])("rejects hello with %s without creating a room or player", (_name, room) => {
    const h = harness();
    const ws = h.connect("p1");
    send(ws, h.deps, { t: "hello", name: "x", room });
    expect(ws.sent).toEqual([]);
    expect(ws.subscriptions).toEqual([]);
    expect(ws.data.joined).toBe(false);
    expect([...h.deps.rooms.entries()]).toEqual([]);
    expect(h.published).toEqual([]);
  });

  it("accepts room codes at the maximum length", () => {
    expect(normalizeRoomCode("a".repeat(MAX_ROOM_CODE_LENGTH))).toBe("A".repeat(MAX_ROOM_CODE_LENGTH));
  });

  it("ignores a second hello from an already joined socket", () => {
    const h = harness();
    const ws = join(h, "p1", "AAA");
    send(ws, h.deps, hello("BBB"));
    expect(ws.data.roomCode).toBe("AAA");
    expect(h.deps.rooms.get("BBB")).toBeUndefined();
    expect(h.room("AAA").getPlayerCount()).toBe(1);
  });

  it("refuses to create a room beyond the room cap but still lets players join existing rooms", () => {
    const h = harness(2);
    join(h, "a", "R1");
    join(h, "b", "R2");
    const c = h.connect("c");
    send(c, h.deps, hello("R3"));
    expect(c.sent).toEqual([]);
    expect(c.data.joined).toBe(false);
    expect(h.deps.rooms.get("R3")).toBeUndefined();

    const d = h.connect("d");
    send(d, h.deps, hello("R1"));
    expect(JSON.parse(d.sent[0] as string).t).toBe("welcome");
    expect(h.room("R1").getPlayerCount()).toBe(2);
  });

  it("subscribes the joining socket only after publishing its join so it never receives its own join", () => {
    const order: string[] = [];
    const rooms = createRoomRegistry(4, (code) => new RoomState(code, 1, 2));
    const deps: WsDeps = { rooms, publish: (_t, p) => order.push(`publish:${JSON.parse(p).t}`), now: () => 0 };
    const ws: WsSocket = {
      data: createWsConnection("p1", 0),
      send: (p) => order.push(`send:${JSON.parse(p as string).t}`),
      subscribe: () => order.push("subscribe"),
    };
    send(ws, deps, hello());
    expect(order).toEqual(["send:welcome", "publish:join", "subscribe"]);
  });

  it("keeps an idle room in memory and refuses the newcomer when saving it before eviction fails", () => {
    let allowSave = false;
    const rooms = createRoomRegistry(1, (code) => new RoomState(code, 1, 2), () => allowSave);
    const h = harness();
    const deps: WsDeps = { ...h.deps, rooms };
    const a = h.connect("a");
    send(a, deps, hello("R1"));
    rooms.get("R1")!.setBlock(1, 50, 1, BLOCK_ID.stone);
    handleWsClose(a, deps);

    const b = h.connect("b");
    send(b, deps, hello("R2"));
    expect(b.data.joined).toBe(false);
    expect(rooms.get("R1")!.getBlock(1, 50, 1)).toBe(BLOCK_ID.stone);
    expect(rooms.get("R2")).toBeUndefined();

    allowSave = true;
    send(b, deps, hello("R2"));
    expect(b.data.joined).toBe(true);
    expect(rooms.get("R1")).toBeUndefined();
  });

  it("evicts an empty room (saving it first) to make space, but never a room with players", () => {
    const evicted: string[] = [];
    const rooms = createRoomRegistry(2, (code) => new RoomState(code, 1, 2), (code, room) => {
      expect(room.getPlayerCount()).toBe(0);
      evicted.push(code);
      return true;
    });
    const h = harness();
    const deps: WsDeps = { ...h.deps, rooms };
    const a = h.connect("a");
    send(a, deps, hello("R1"));
    const b = h.connect("b");
    send(b, deps, hello("R2"));

    const c = h.connect("c");
    send(c, deps, hello("R3"));
    expect(c.data.joined).toBe(false);
    expect(evicted).toEqual([]);

    handleWsClose(a, deps);
    send(c, deps, hello("R3"));
    expect(c.data.joined).toBe(true);
    expect(evicted).toEqual(["R1"]);
    expect(rooms.get("R1")).toBeUndefined();
    expect(rooms.get("R2")).toBeDefined();
    expect(rooms.get("R3")).toBeDefined();
  });
});

describe("ws malformed traffic", () => {
  it.each(["not json", "{", "null", "42", "\"hello\"", "[1,2]", "{}", JSON.stringify({ t: 5 }), JSON.stringify({ t: "unknown" })])(
    "ignores message %s without throwing or state change",
    (raw) => {
      const h = harness();
      const ws = join(h);
      expect(() => handleWsMessage(ws, raw, h.deps)).not.toThrow();
      expect(h.published).toEqual([]);
      expect(ws.sent).toHaveLength(1);
      expect(h.room("DOM1").getEditCount()).toBe(0);
    },
  );

  it("ignores binary and non-string payloads", () => {
    const h = harness();
    const ws = join(h);
    handleWsMessage(ws, new Uint8Array([1, 2, 3]), h.deps);
    handleWsMessage(ws, undefined, h.deps);
    expect(h.published).toEqual([]);
  });

  it("ignores block, input and need before hello and creates no room", () => {
    const h = harness();
    const ws = h.connect("p1");
    send(ws, h.deps, { t: "block", x: 1, y: 2, z: 3, id: BLOCK_ID.stone });
    send(ws, h.deps, input(1, 2, 3));
    send(ws, h.deps, { t: "need", cx: 0, cy: 2, cz: 0 });
    expect(ws.sent).toEqual([]);
    expect(h.published).toEqual([]);
    expect([...h.deps.rooms.entries()]).toEqual([]);
  });
});

describe("ws input", () => {
  it("accepts a first input near spawn, stores it and publishes the player state", () => {
    const h = harness();
    const ws = join(h);
    send(ws, h.deps, input(300, 60, -300));
    expect(h.room("DOM1").getPlayer("p1")).toMatchObject({ x: 300, y: 60, z: -300, yaw: 0.5, pitch: -0.25, anim: "walk" });
    expect(h.published).toEqual([
      { topic: "room:DOM1", msg: { t: "player", id: "p1", name: "Ziemek", x: 300, y: 60, z: -300, yaw: 0.5, pitch: -0.25, anim: "walk" } },
    ]);
    expect(ws.data.hadInput).toBe(true);
  });

  it("drops a first input that teleports far from spawn, then accepts a legal one", () => {
    const h = harness();
    const ws = join(h);
    const spawn = { ...h.room("DOM1").getPlayer("p1")! };
    send(ws, h.deps, input(spawn.x + MAX_FIRST_INPUT_DISTANCE + 1, spawn.y, spawn.z));
    expect(h.published).toEqual([]);
    expect(ws.data.hadInput).toBe(false);
    expect(h.room("DOM1").getPlayer("p1")).toEqual(spawn);

    send(ws, h.deps, input(spawn.x + MAX_FIRST_INPUT_DISTANCE, spawn.y, spawn.z));
    expect(h.published).toHaveLength(1);
    expect(ws.data.hadInput).toBe(true);
  });

  it("lets a first input far from spawn through once enough time has passed to have walked there", () => {
    const h = harness();
    const ws = join(h);
    const spawn = { ...h.room("DOM1").getPlayer("p1")! };
    const far = MAX_FIRST_INPUT_DISTANCE + MAX_PLAYER_SPEED * 50;

    h.clock.now += 49_000;
    send(ws, h.deps, input(spawn.x + far, spawn.y, spawn.z));
    expect(h.published).toEqual([]);

    h.clock.now += 1_001;
    send(ws, h.deps, input(spawn.x + far, spawn.y, spawn.z));
    expect(h.published).toHaveLength(1);
    expect(h.room("DOM1").getPlayer("p1")!.x).toBe(spawn.x + far);
  });

  it("accepts a legal move and drops a teleport after the first input", () => {
    const h = harness();
    const ws = join(h);
    send(ws, h.deps, input(0, 60, 0));
    h.published.length = 0;

    h.clock.now += 1000;
    send(ws, h.deps, input(MAX_PLAYER_SPEED, 60, 0));
    expect(h.published).toHaveLength(1);

    h.clock.now += 1000;
    send(ws, h.deps, input(MAX_PLAYER_SPEED + 500, 60, 0));
    expect(h.published).toHaveLength(1);
    expect(h.room("DOM1").getPlayer("p1")!.x).toBe(MAX_PLAYER_SPEED);
  });

  it("self-recovers: a rejected jump becomes acceptable once enough real time has passed since the last accepted input", () => {
    const h = harness();
    const ws = join(h);
    send(ws, h.deps, input(0, 60, 0));
    const acceptedAt = ws.data.lastAcceptTime;
    h.published.length = 0;

    h.clock.now += 1000;
    send(ws, h.deps, input(100, 60, 0));
    expect(h.published).toEqual([]);
    expect(ws.data.lastAcceptTime).toBe(acceptedAt);

    h.clock.now += 9000;
    send(ws, h.deps, input(100, 60, 0));
    expect(h.published).toHaveLength(1);
    expect(h.room("DOM1").getPlayer("p1")!.x).toBe(100);
    expect(ws.data.lastAcceptTime).toBe(h.clock.now);
  });

  it("uses the 10 ms floor for dt so back-to-back inputs cannot divide by zero", () => {
    const h = harness();
    const ws = join(h);
    send(ws, h.deps, input(0, 60, 0));
    h.published.length = 0;
    send(ws, h.deps, input(0.12, 60, 0));
    expect(h.published).toHaveLength(1);
    send(ws, h.deps, input(0.12 + 0.13, 60, 0));
    expect(h.published).toHaveLength(1);
  });

  it.each([
    ["NaN x", { x: NaN }],
    ["null x via JSON", { x: null }],
    ["string x", { x: "5" }],
    ["out-of-bounds x", { x: MAX_COORD + 1 }],
    ["out-of-bounds z", { z: -MAX_COORD - 1 }],
    ["non-numeric yaw", { yaw: "0" }],
    ["null pitch", { pitch: null }],
    ["non-string anim", { anim: 7 }],
    ["over-long anim", { anim: "a".repeat(MAX_ANIM_LENGTH + 1) }],
  ])("drops input with %s, including as the first input", (_n, patch) => {
    const h = harness();
    const ws = join(h);
    const before = { ...h.room("DOM1").getPlayer("p1")! };
    send(ws, h.deps, { ...input(1, 60, 1), ...patch });
    expect(h.published).toEqual([]);
    expect(h.room("DOM1").getPlayer("p1")).toEqual(before);
    expect(ws.data.hadInput).toBe(false);
  });

  it("drops Infinity written as an out-of-range JSON number", () => {
    const h = harness();
    const ws = join(h);
    handleWsMessage(ws, '{"t":"input","seq":1,"x":1e999,"y":60,"z":0,"yaw":0,"pitch":0,"anim":"idle"}', h.deps);
    expect(h.published).toEqual([]);
  });
});

describe("ws block", () => {
  it("applies a valid edit, stores it and broadcasts with the sender id", () => {
    const h = harness();
    const ws = join(h);
    send(ws, h.deps, { t: "block", x: -3, y: 50, z: 12, id: BLOCK_ID.stone });
    expect(h.room("DOM1").getBlock(-3, 50, 12)).toBe(BLOCK_ID.stone);
    expect(h.published).toEqual([{ topic: "room:DOM1", msg: { t: "block", x: -3, y: 50, z: 12, id: BLOCK_ID.stone, by: "p1" } }]);
  });

  it("accepts removing a block (air id) and the full vertical range edges", () => {
    const h = harness();
    const ws = join(h);
    send(ws, h.deps, { t: "block", x: 0, y: 0, z: 0, id: BLOCK_ID.air });
    send(ws, h.deps, { t: "block", x: 0, y: 127, z: 0, id: BLOCK_ID.stone });
    expect(h.room("DOM1").getBlock(0, 0, 0)).toBe(BLOCK_ID.air);
    expect(h.room("DOM1").getBlock(0, 127, 0)).toBe(BLOCK_ID.stone);
    expect(h.published).toHaveLength(2);
  });

  it.each([
    ["fractional x", { x: 1.5 }],
    ["NaN y", { y: NaN }],
    ["string z", { z: "3" }],
    ["y below world", { y: -1 }],
    ["y at world height", { y: 128 }],
    ["x beyond bound", { x: MAX_COORD + 1 }],
    ["z beyond bound", { z: -MAX_COORD - 1 }],
    ["unknown block id", { id: 9999 }],
    ["negative id", { id: -1 }],
    ["fractional id", { id: 2.5 }],
    ["string id", { id: "2" }],
    ["inherited-key id", { id: "toString" }],
    ["null id", { id: null }],
    ["missing id", { id: undefined }],
  ])("rejects block with %s and leaves room state and subscribers untouched", (_n, patch) => {
    const h = harness();
    const ws = join(h);
    send(ws, h.deps, { t: "block", x: 1, y: 50, z: 1, id: BLOCK_ID.stone, ...patch });
    expect(h.room("DOM1").getEditCount()).toBe(0);
    expect(h.published).toEqual([]);
  });

  it("stops accepting new positions at the per-room edit cap but still allows changing an existing one", () => {
    const h = harness();
    const ws = join(h);
    const room = h.room("DOM1");
    for (let i = 0; i < MAX_EDITS_PER_ROOM; i++) room.setBlock(i, 50, 0, BLOCK_ID.stone);
    h.published.length = 0;

    send(ws, h.deps, { t: "block", x: 0, y: 51, z: 0, id: BLOCK_ID.stone });
    expect(room.getEditCount()).toBe(MAX_EDITS_PER_ROOM);
    expect(h.published).toEqual([]);

    send(ws, h.deps, { t: "block", x: 5, y: 50, z: 0, id: BLOCK_ID.air });
    expect(room.getBlock(5, 50, 0)).toBe(BLOCK_ID.air);
    expect(room.getEditCount()).toBe(MAX_EDITS_PER_ROOM);
    expect(h.published).toHaveLength(1);
  });
});

describe("ws need", () => {
  it("replies with a binary frame whose chunk matches worldgen plus exactly the edited block", () => {
    const h = harness();
    const ws = join(h);
    send(ws, h.deps, { t: "block", x: 1, y: 40, z: 2, id: BLOCK_ID.planks });
    ws.sent.length = 0;
    send(ws, h.deps, { t: "need", cx: 0, cy: 2, cz: 0 });

    expect(ws.sent).toHaveLength(1);
    const [packet] = decodeBinaryChunkFrame(ws.sent[0] as Uint8Array);
    expect(packet).toMatchObject({ cx: 0, cy: 2, cz: 0 });
    const expected = generateChunk(0, 2, 0, 777, 2);
    expected[getBlockIndex(1, 8, 2)] = BLOCK_ID.planks;
    expect(Array.from(decodeRLE(packet.rleData))).toEqual(Array.from(expected));
  });

  it.each([
    ["fractional", { cx: 0.5, cy: 2, cz: 0 }],
    ["cy below range", { cx: 0, cy: -1, cz: 0 }],
    ["cy above range", { cx: 0, cy: 8, cz: 0 }],
    ["huge cx", { cx: 1e9, cy: 2, cz: 0 }],
    ["string", { cx: "0", cy: 2, cz: 0 }],
    ["NaN", { cx: 0, cy: NaN, cz: 0 }],
  ])("sends nothing for %s chunk coordinates", (_n, coords) => {
    const h = harness();
    const ws = join(h);
    ws.sent.length = 0;
    send(ws, h.deps, { t: "need", ...coords });
    expect(ws.sent).toEqual([]);
  });
});

describe("ws close", () => {
  it("removes the player and publishes leave", () => {
    const h = harness();
    const ws = join(h);
    handleWsClose(ws, h.deps);
    expect(h.room("DOM1").getPlayerCount()).toBe(0);
    expect(h.published).toEqual([{ topic: "room:DOM1", msg: { t: "leave", id: "p1" } }]);
  });

  it("does nothing for a socket that never joined", () => {
    const h = harness();
    join(h, "other");
    h.published.length = 0;
    handleWsClose(h.connect("ghost"), h.deps);
    expect(h.room("DOM1").getPlayerCount()).toBe(1);
    expect(h.published).toEqual([]);
  });
});
