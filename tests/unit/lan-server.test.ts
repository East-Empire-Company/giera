import { describe, expect, it } from "vitest";
import { RoomState } from "../../server/room";

describe("RoomState", () => {
  it("initializes room with seed and empty edits", () => {
    const room = new RoomState("K7QX", 9999);
    expect(room.code).toBe("K7QX");
    expect(room.seed).toBe(9999);
    expect(room.getPlayerCount()).toBe(0);
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

  it("generates and encodes chunk RLE on demand", () => {
    const room = new RoomState("K7QX", 9999);
    const rle = room.getChunkRLE(0, 2, 0);
    expect(rle.length).toBeGreaterThan(0);
  });
});
