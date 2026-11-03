import { describe, expect, it, vi } from "vitest";
import {
  ACTIVE_LAN_ROOM_KEY,
  activeSaveKey,
  getActiveSaveKey,
  parseLanRoomSession,
  serializeLanRoomSession,
  switchSaveKey,
} from "../../src/client/game/save-session";

describe("save sessions", () => {
  it("uses room origin and normalized room for LAN saves", () => {
    const room = { url: "ws://example.test:8080/ws/path", room: "  My Room ", seed: 314 };
    expect(activeSaveKey(room)).toBe("room:ws://example.test:8080:myroom");
    expect(activeSaveKey(null)).toBe("last_save");
    expect(parseLanRoomSession(serializeLanRoomSession(room))).toEqual({ ...room, url: "ws://example.test:8080/ws/path" });
    expect(ACTIVE_LAN_ROOM_KEY).toBe("giera.activeLanRoom");
  });

  it("uses room-specific backup key through active session storage", () => {
    const storage = { getItem: () => JSON.stringify({ url: "wss://host.test/ws", room: "A B" }) };
    expect(getActiveSaveKey(storage)).toBe("room:wss://host.test:ab");
  });

  it("keeps current key when its save does not complete", async () => {
    const save = vi.fn(async () => false);
    await expect(switchSaveKey("last_save", "room:ws://host:8080:room", save)).resolves.toBe("last_save");
    expect(save).toHaveBeenCalledWith("last_save");
  });

  it("switches only after current save succeeds", async () => {
    const save = vi.fn(async () => true);
    await expect(switchSaveKey("last_save", "room:ws://host:8080:room", save)).resolves.toBe("room:ws://host:8080:room");
  });
});
