import { describe, expect, it } from "vitest";
import { RoomState } from "../../server/room";
import { generateChunk } from "../../src/shared/worldgen";
import { CHUNK_SIZE, decodeRLE, getBlockIndex } from "../../src/shared/chunk";

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
      const room = new RoomState("K7QX", 9999, 2);
      room.setBlock(x, y, z, 9);
      expect(readBlock(room, x, y, z)).toBe(9);
    });

    it(`serves an edit made after the chunk was cached (${name})`, () => {
      const room = new RoomState("K7QX", 9999, 2);
      readBlock(room, x, y, z);
      room.setBlock(x, y, z, 9);
      expect(readBlock(room, x, y, z)).toBe(9);
      room.setBlock(x, y, z, 0);
      expect(readBlock(room, x, y, z)).toBe(0);
    });
  }

  it("does not alter other cached chunks when editing", () => {
    const room = new RoomState("K7QX", 9999, 2);
    const before = Array.from(decodeRLE(room.getChunkRLE(0, 2, 0)));
    room.getChunkRLE(1, 2, 0);
    room.setBlock(16, 40, 0, 9);
    expect(Array.from(decodeRLE(room.getChunkRLE(0, 2, 0)))).toEqual(before);
  });
});

describe("RoomState", () => {
  it("initializes room with seed and an empty edits snapshot", () => {
    const room = new RoomState("K7QX", 9999, 2);
    expect(room.code).toBe("K7QX");
    expect(room.seed).toBe(9999);
    expect(room.getPlayerCount()).toBe(0);
    expect(room.toJSON().edits).toEqual({});
  });

  it("adds and removes players cleanly", () => {
    const room = new RoomState("K7QX", 9999, 2);
    const p1 = room.addPlayer("socket-1", "Ziemek");
    expect(room.getPlayerCount()).toBe(1);
    expect(p1.name).toBe("Ziemek");

    const p2 = room.addPlayer("socket-2", "Gniewko");
    expect(room.getPlayerCount()).toBe(2);

    room.removePlayer("socket-1");
    expect(room.getPlayerCount()).toBe(1);
    expect(room.getPlayer("socket-2")?.name).toBe("Gniewko");
  });

  it("stores and applies block edits", () => {
    const room = new RoomState("K7QX", 9999, 2);
    room.setBlock(10, 45, 12, 9); // planks
    expect(room.getBlock(10, 45, 12)).toBe(9);

    room.setBlock(10, 45, 12, 0); // air
    expect(room.getBlock(10, 45, 12)).toBe(0);
  });

  it("serializes to world JSON snapshot", () => {
    const room = new RoomState("K7QX", 9999, 2);
    room.setBlock(5, 50, 5, 3);
    const json = room.toJSON();
    expect(json.seed).toBe(9999);
    expect(json.edits["5,50,5"]).toBe(3);
  });

  it("serves the worldgen chunk for its seed when there are no edits", () => {
    const room = new RoomState("K7QX", 9999, 2);
    expect(Array.from(decodeRLE(room.getChunkRLE(0, 2, 0)))).toEqual(Array.from(generateChunk(0, 2, 0, 9999, 2)));
  });

  it("round-trips worldgen version and defaults legacy snapshots to v1", () => {
    const room = new RoomState("K7QX", 9999, 2);
    expect(room.toJSON().worldgenVersion).toBe(2);
    const legacy = RoomState.fromJSON("K7QX", { seed: 9999, edits: {}, savedAt: "2026-01-01T00:00:00.000Z" });
    expect(legacy.worldgenVersion).toBe(1);
  });
});
