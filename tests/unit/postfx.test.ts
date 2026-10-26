import { describe, expect, it } from "vitest";
import { evaluatePostQuality, postWindowAdvance } from "../../src/client/render/postfx";
import { paletteColor, variationColor } from "../../src/client/render/ground-decor";

describe("postfx auto-degrade ladder", () => {
  it("keeps GTAO at or above 50 fps", () => {
    expect(evaluatePostQuality({ gtao: true }, 55)).toEqual({ gtao: true });
    expect(evaluatePostQuality({ gtao: true }, 50)).toEqual({ gtao: true });
  });

  it("drops GTAO below 50 fps", () => {
    expect(evaluatePostQuality({ gtao: true }, 49)).toEqual({ gtao: false });
    expect(evaluatePostQuality({ gtao: true }, 1)).toEqual({ gtao: false });
  });

  it("never re-enables GTAO from fps alone", () => {
    expect(evaluatePostQuality({ gtao: false }, 120)).toEqual({ gtao: false });
  });

  it("closes the fps window at 5 seconds and resets it", () => {
    expect(postWindowAdvance(0, 1)).toEqual({ total: 1, due: false });
    expect(postWindowAdvance(4.5, 0.5)).toEqual({ total: 5, due: true });
  });
});

describe("decor tint helpers", () => {
  const item = { x: 12, y: 0, z: -4, kind: "tuft" as const, scale: 1, rotation: 0 };
  it("derives deterministic grayscale variation from position and seed", () => {
    const a = variationColor(4242, item);
    const b = variationColor(4242, item);
    expect(a.getHex()).toBe(b.getHex());
    expect(a.r).toBe(a.g);
    expect(a.g).toBe(a.b);
    const other = variationColor(987654, item);
    expect(other.getHex()).not.toBe(a.getHex());
  });

  it("picks palette entries deterministically", () => {
    const palette = [0x8d8d8d, 0x9b9b8f];
    expect(paletteColor(item, palette, 7)).toBe(paletteColor(item, palette, 7));
    expect([0x8d8d8d, 0x9b9b8f]).toContain(paletteColor(item, palette, 7));
  });
});
