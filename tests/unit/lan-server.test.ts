import { describe, expect, it } from "vitest";
import { RoomState } from "../../server/room";
import { BLOCK_ID } from "../../src/shared/blocks";
import { buildLanRoomsPayload, buildRoomSummary, handleLanRooms } from "../../server/lan-discovery";
import { createRoomRegistry, createWsConnection, handleWsMessage, type WsDeps, type WsSocket } from "../../server/ws-handler";
import { generateChunk } from "../../src/shared/worldgen";
import { CHUNK_SIZE, decodeRLE, getBlockIndex } from "../../src/shared/chunk";
import { MAX_ROOM_NAME_LENGTH } from "../../src/shared/lan-protocol";

const cases = [
  { name: "positive coords", pos: [10, 45, 12] },
  { name: "negative x/z", pos: [-1, 45, -17] },
  { name: "negative far", pos: [-33, 3, -2] },
  { name: "top chunk", pos: [5, 127, 5] },
] as const;

function readBlock(room: RoomState, x: number, y: number, z: number): number {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  const chunk = decodeRLE(room.getChunkRLE(cx, cy, cz));
  const m = (v: number) => ((v % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return chunk[getBlockIndex(m(x), m(y), m(z))];
}

describe("RoomState chunk cache and edits", () => {
  for (const { name, pos } of cases) {
    const [x, y, z] = pos;
    it(`serves an edit made before the chunk was generated (${name})`, () => {
      const room = new RoomState("K7QX", 9999);
      room.setBlock(x, y, z, 9);
      expect(readBlock(room, x, y, z)).toBe(9);
    });

    it(`serves an edit made after the chunk was cached (${name})`, () => {
      const room = new RoomState("K7QX", 9999);
      readBlock(room, x, y, z);
      room.setBlock(x, y, z, 9);
      expect(readBlock(room, x, y, z)).toBe(9);
      room.setBlock(x, y, z, 0);
      expect(readBlock(room, x, y, z)).toBe(0);
    });
  }

  it("does not alter other cached chunks when editing", () => {
    const room = new RoomState("K7QX", 9999);
    const before = Array.from(decodeRLE(room.getChunkRLE(0, 2, 0)));
    room.getChunkRLE(1, 2, 0);
    room.setBlock(16, 40, 0, 9);
    expect(Array.from(decodeRLE(room.getChunkRLE(0, 2, 0)))).toEqual(before);
  });
});

describe("RoomState", () => {
  it("initializes room with seed and an empty edits snapshot", () => {
    const room = new RoomState("K7QX", 9999);
    expect(room.code).toBe("K7QX");
    expect(room.seed).toBe(9999);
    expect(room.getPlayerCount()).toBe(0);
    expect(room.toJSON().edits).toEqual({});
  });

  it("adds and removes players cleanly", () => {
    const room = new RoomState("K7QX", 9999);
    const p1 = room.addPlayer("socket-1", "Ziemek");
    expect(room.getPlayerCount()).toBe(1);
    expect(p1.name).toBe("Ziemek");

    const p2 = room.addPlayer("socket-2", "Gniewko");
    expect(room.getPlayerCount()).toBe(2);

    room.removePlayer("socket-1");
    expect(room.getPlayerCount()).toBe(1);
    expect(room.getPlayer("socket-2")?.name).toBe("Gniewko");
  });

  it("hands each player their own tycoon slot and reuses freed slots", () => {
    const room = new RoomState("K7QX", 9999);
    const p1 = room.addPlayer("socket-1", "Ziemek");
    const p2 = room.addPlayer("socket-2", "Gniewko");
    const p3 = room.addPlayer("socket-3", "Babcia");
    expect([p1.slot, p2.slot, p3.slot]).toEqual([0, 1, 2]);

    room.removePlayer("socket-2");
    expect(room.addPlayer("socket-4", "Dziadek").slot).toBe(1);
  });

  it("stores and applies block edits", () => {
    const room = new RoomState("K7QX", 9999);
    room.setBlock(10, 45, 12, 9); // planks
    expect(room.getBlock(10, 45, 12)).toBe(9);

    room.setBlock(10, 45, 12, 0); // air
    expect(room.getBlock(10, 45, 12)).toBe(0);
  });

  it("serializes to world JSON snapshot", () => {
    const room = new RoomState("K7QX", 9999);
    room.setBlock(5, 50, 5, 3);
    const json = room.toJSON();
    expect(json.seed).toBe(9999);
    expect(json.edits["5,50,5"]).toBe(3);
  });

  it("serves the worldgen chunk for its seed when there are no edits", () => {
    const room = new RoomState("K7QX", 9999);
    expect(Array.from(decodeRLE(room.getChunkRLE(0, 2, 0)))).toEqual(Array.from(generateChunk(0, 2, 0, 9999)));
  });
  it("serves Warsaw city and connector blocks through block-only RLE", () => {
    const room = new RoomState("K7QX", 9999);
    const city = decodeRLE(room.getChunkRLE(-5, 3, -7));
    const connector = decodeRLE(room.getChunkRLE(0, 3, -1));

    expect(room.getWorldBlock(-80, 58, -112)).toBe(BLOCK_ID.paving);
    expect(city[getBlockIndex(0, 10, 0)]).toBe(BLOCK_ID.paving);
    expect(room.getWorldBlock(4, 60, -16)).toBe(BLOCK_ID.asphalt);
    expect(connector[getBlockIndex(4, 12, 0)]).toBe(BLOCK_ID.asphalt);

    room.setBlock(-80, 58, -112, BLOCK_ID.stone);
    expect(readBlock(room, -80, 58, -112)).toBe(BLOCK_ID.stone);
  });
  it("ignores city fixtures and water when finding the saved room surface", () => {
    const source = new RoomState("K7QX", 9999);
    expect(source.getWorldBlock(-34, 60, -112)).not.toBe(BLOCK_ID.air);
    expect(source.getWorldBlock(-34, 61, -112)).toBe(BLOCK_ID.plaster);
    expect(source.surfaceColumnTop(-34, -112)).toBe(60);

    const waterEdit = RoomState.fromJSON("K7QX", {
      seed: 9999,
      edits: { "-34,65,-112": BLOCK_ID.water },
      savedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(waterEdit.surfaceColumnTop(-34, -112)).toBe(60);

    const solidEdit = RoomState.fromJSON("K7QX", {
      seed: 9999,
      edits: { "-34,66,-112": BLOCK_ID.brick },
      savedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(solidEdit.surfaceColumnTop(-34, -112)).toBe(66);
  });

  it.each([1, 2])("loads existing room edits with current terrain (legacy metadata %i)", (worldgenVersion) => {
    const snapshot = {
      seed: 9999,
      worldgenVersion,
      edits: { "5,40,5": 3 },
      savedAt: "2026-01-01T00:00:00.000Z",
    };
    const legacy = RoomState.fromJSON("K7QX", snapshot);
    const expected = generateChunk(0, 2, 0, 9999);
    expected[getBlockIndex(5, 8, 5)] = 3;

    expect(legacy.seed).toBe(9999);
    expect(legacy.getBlock(5, 40, 5)).toBe(3);
    expect(Array.from(decodeRLE(legacy.getChunkRLE(0, 2, 0)))).toEqual(Array.from(expected));
    expect(legacy.toJSON()).not.toHaveProperty("worldgenVersion");
  });
});

describe("RoomState display name", () => {
  it("defaults the display name to the room code", () => {
    expect(new RoomState("K7QX", 1).getName()).toBe("K7QX");
  });

  it("trims the display name", () => {
    const room = new RoomState("K7QX", 1);
    room.setName("  Pokój Ziemka  ");
    expect(room.getName()).toBe("Pokój Ziemka");
  });

  it("caps the display name at the protocol limit", () => {
    const room = new RoomState("K7QX", 1);
    room.setName("x".repeat(MAX_ROOM_NAME_LENGTH + 10));
    expect(room.getName()).toHaveLength(MAX_ROOM_NAME_LENGTH);
  });

  it.each(["", "   "])("keeps the previous name for the empty value %j", (value) => {
    const room = new RoomState("K7QX", 1);
    room.setName("Dom1");
    room.setName(value);
    expect(room.getName()).toBe("Dom1");
  });

  it("survives a snapshot round trip", () => {
    const room = new RoomState("K7QX", 1);
    room.setName("Dom Ziemka");
    const restored = RoomState.fromJSON("K7QX", room.toJSON());
    expect(restored.getName()).toBe("Dom Ziemka");
  });

  it("falls back to the room code for a snapshot without a name", () => {
    const restored = RoomState.fromJSON("K7QX", { seed: 1, edits: {}, savedAt: "2026-01-01T00:00:00.000Z" });
    expect(restored.getName()).toBe("K7QX");
  });
});

describe("buildLanRoomsPayload", () => {
  function occupied(code: string, name: string): RoomState {
    const room = new RoomState(code, 1);
    room.setName(name);
    room.addPlayer("socket-1", "Ziemek");
    return room;
  }

  it("maps room code, display name and player count", () => {
    expect(buildRoomSummary(occupied("K7QX", "Dom1"))).toEqual({ code: "K7QX", name: "Dom1", players: 1, seed: 1 });
  });

  it("excludes rooms without players", () => {
    const empty = new RoomState("EMPTY", 1);
    const payload = buildLanRoomsPayload([empty, occupied("K7QX", "Dom1")], "host", "10.0.0.2", 8080);
    expect(payload.rooms.map((r) => r.code)).toEqual(["K7QX"]);
  });

  it("sorts rooms by code", () => {
    const payload = buildLanRoomsPayload([occupied("ZZZ", "C"), occupied("AAA", "A"), occupied("MMM", "B")], "host", "10.0.0.2", 8080);
    expect(payload.rooms.map((r) => r.code)).toEqual(["AAA", "MMM", "ZZZ"]);
  });

  it("carries the server metadata", () => {
    const payload = buildLanRoomsPayload([], "macstudio", "10.0.0.2", 8080);
    expect(payload).toEqual({ host: "macstudio", ip: "10.0.0.2", port: 8080, rooms: [] });
  });
});

describe("handleLanRooms", () => {
  const meta = { host: "macstudio", ip: "10.0.0.2", port: 8080 };

  function roomWithPlayer(code: string): RoomState {
    const room = new RoomState(code, 1);
    room.setName("Dom1");
    room.addPlayer("socket-1", "Ziemek");
    return room;
  }

  it("answers GET with a CORS JSON payload", async () => {
    const res = handleLanRooms(new Request("http://10.0.0.2:8080/lan/rooms"), [roomWithPlayer("K7QX")], meta);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = (await res.json()) as { host: string; ip: string; port: number; rooms: { code: string; name: string; players: number }[] };
    expect(body.host).toBe("macstudio");
    expect(body.ip).toBe("10.0.0.2");
    expect(body.port).toBe(8080);
    expect(body.rooms).toEqual([{ code: "K7QX", name: "Dom1", players: 1, seed: 1 }]);
  });

  it("answers OPTIONS with 204 and CORS headers", () => {
    const res = handleLanRooms(new Request("http://10.0.0.2:8080/lan/rooms", { method: "OPTIONS" }), [], meta);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rejects other methods with 405", () => {
    const res = handleLanRooms(new Request("http://10.0.0.2:8080/lan/rooms", { method: "POST" }), [], meta);
    expect(res.status).toBe(405);
  });
});

describe("hello room naming", () => {
  function harness(): { deps: WsDeps; connect(id: string): WsSocket & { sent: string[] }; room(code: string): RoomState } {
    const rooms = createRoomRegistry(8, (code) => new RoomState(code, 777));
    const deps: WsDeps = {
      rooms,
      publish: () => {},
      now: () => 1_000_000,
    };
    return {
      deps,
      connect(id) {
        const sent: string[] = [];
        return {
          data: createWsConnection(id, 1_000_000),
          send: (p) => sent.push(p as string),
          subscribe: () => {},
          sent,
        };
      },
      room: (code) => rooms.get(code)!,
    };
  }

  it("welcomes with the room display name", () => {
    const h = harness();
    const ws = h.connect("p1");
    handleWsMessage(ws, JSON.stringify({ t: "hello", name: "Ziemek", room: "DOM1", roomName: "Dom1", host: true }), h.deps);

    const welcome = JSON.parse(ws.sent[0]);
    expect(welcome.roomName).toBe("Dom1");
    expect(h.room("DOM1").getName()).toBe("Dom1");
  });

  it("keeps the room code as the name for a guest join", () => {
    const h = harness();
    const ws = h.connect("p1");
    handleWsMessage(ws, JSON.stringify({ t: "hello", name: "Ziemek", room: "DOM1" }), h.deps);

    expect(JSON.parse(ws.sent[0]).roomName).toBe("DOM1");
  });

  it("ignores a host room name that is not a string", () => {
    const h = harness();
    const ws = h.connect("p1");
    handleWsMessage(ws, JSON.stringify({ t: "hello", name: "Ziemek", room: "DOM1", roomName: 42, host: true }), h.deps);

    expect(h.room("DOM1").getName()).toBe("DOM1");
  });
});

describe("setSeedIfFresh", () => {
  it("accepts a seed on a fresh room", () => {
    const room = new RoomState("FRESH", 1);
    expect(room.setSeedIfFresh(424242)).toBe(true);
    expect(room.seed).toBe(424242);
  });

  it("refuses after an edit", () => {
    const room = new RoomState("EDIT", 1);
    room.setBlock(5, 50, 5, 3);
    expect(room.setSeedIfFresh(424242)).toBe(false);
    expect(room.seed).toBe(1);
  });

  it("refuses after a player joins", () => {
    const room = new RoomState("PLAY", 1);
    room.addPlayer("socket-1", "Ziemek");
    expect(room.setSeedIfFresh(424242)).toBe(false);
    expect(room.seed).toBe(1);
  });

  it("refuses a non-integer seed", () => {
    const room = new RoomState("BAD", 1);
    expect(room.setSeedIfFresh(4.2)).toBe(false);
    expect(room.seed).toBe(1);
  });
  it("refuses a seed hint on a saved room with no edits", () => {
    const room = RoomState.fromJSON("SAVED", { seed: 9999, edits: {}, savedAt: "2026-01-01T00:00:00.000Z" });
    expect(room.setSeedIfFresh(424242)).toBe(false);
    expect(room.seed).toBe(9999);
  });
});

describe("hello seed hint", () => {
  function harness(): { deps: WsDeps; connect(id: string): WsSocket & { sent: string[] }; room(code: string): RoomState } {
    const rooms = createRoomRegistry(8, (code) => new RoomState(code, 777));
    const deps: WsDeps = {
      rooms,
      publish: () => {},
      now: () => 1_000_000,
    };
    return {
      deps,
      connect(id) {
        const sent: string[] = [];
        return {
          data: createWsConnection(id, 1_000_000),
          send: (p) => sent.push(p as string),
          subscribe: () => {},
          sent,
        };
      },
      room: (code) => rooms.get(code)!,
    };
  }

  it("adopts the host seed on a fresh room", () => {
    const h = harness();
    const ws = h.connect("p1");
    handleWsMessage(ws, JSON.stringify({ t: "hello", name: "Ziemek", room: "DOM1", host: true, seed: 424242 }), h.deps);

    const welcome = JSON.parse(ws.sent[0]);
    expect(welcome.seed).toBe(424242);
    expect(h.room("DOM1").seed).toBe(424242);
  });

  it("ignores the seed hint on a saved room", () => {
    const rooms = createRoomRegistry(8, (code) => RoomState.fromJSON(code, { seed: 9999, edits: { "5,40,5": 3 }, savedAt: "2026-01-01T00:00:00.000Z" }));
    const deps: WsDeps = { rooms, publish: () => {}, now: () => 1_000_000 };
    const sent: string[] = [];
    const ws: WsSocket & { sent: string[] } = {
      data: createWsConnection("p1", 1_000_000),
      send: (p) => sent.push(p as string),
      subscribe: () => {},
      sent,
    };
    handleWsMessage(ws, JSON.stringify({ t: "hello", name: "Ziemek", room: "DOM1", host: true, seed: 424242 }), deps);

    const welcome = JSON.parse(sent[0]);
    expect(welcome.seed).toBe(9999);
  });

  it("ignores the seed hint for a guest join", () => {
    const h = harness();
    const ws = h.connect("p1");
    handleWsMessage(ws, JSON.stringify({ t: "hello", name: "Ziemek", room: "DOM1", seed: 424242 }), h.deps);

    const welcome = JSON.parse(ws.sent[0]);
    expect(welcome.seed).toBe(777);
  });
});
