import { describe, expect, it } from "vitest";
import {
  decodeBinaryChunkFrame,
  encodeBinaryChunkFrame,
  isValidPlayerSpeed,
  type ServerMessage,
  type ClientMessage,
} from "../../src/shared/lan-protocol";

describe("LAN multiplayer protocol", () => {
  it("encodes and decodes binary chunk frames with RLE", () => {
    const chunkA = new Uint8Array(4096);
    chunkA.fill(2, 0, 500); // 500 stone blocks
    const chunks = [
      { cx: 0, cy: 0, cz: 0, rleData: chunkA },
      { cx: 1, cy: 2, cz: -1, rleData: new Uint8Array([5, 10, 0, 20]) },
    ];

    const binary = encodeBinaryChunkFrame(chunks);
    expect(binary[0]).toBe(1); // Type 1: chunk packet

    const decoded = decodeBinaryChunkFrame(binary);
    expect(decoded.length).toBe(2);
    expect(decoded[0].cx).toBe(0);
    expect(decoded[0].cy).toBe(0);
    expect(decoded[0].cz).toBe(0);
    expect(decoded[0].rleData.length).toBe(4096);
    expect(decoded[1].cx).toBe(1);
    expect(decoded[1].cy).toBe(2);
    expect(decoded[1].cz).toBe(-1);
    expect(decoded[1].rleData).toEqual(new Uint8Array([5, 10, 0, 20]));
  });

  it("validates player movement speed sanity check", () => {
    const prev = { x: 0, y: 40, z: 0 };
    // 6 bl/s over 0.05s is 0.3 bl -> valid
    expect(isValidPlayerSpeed(prev, { x: 0.3, y: 40, z: 0 }, 0.05)).toBe(true);

    // 20 bl/s over 0.05s is 1.0 bl (> 12 bl/s limit) -> invalid teleport
    expect(isValidPlayerSpeed(prev, { x: 2.0, y: 40, z: 0 }, 0.05)).toBe(false);
  });
});
