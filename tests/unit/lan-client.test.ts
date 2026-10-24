import { describe, expect, it } from "vitest";
import { LanClient } from "../../src/client/net/client";

describe("LanClient", () => {
  it("initializes with url, room, and player name", () => {
    const client = new LanClient({
      url: "ws://127.0.0.1:8080/ws",
      room: "DOM1",
      playerName: "Ziemek",
    });
    expect(client).toBeDefined();
  });
});
