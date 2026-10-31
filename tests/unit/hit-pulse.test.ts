import { describe, expect, it } from "vitest";
import { hitPulseScale } from "../../src/client/effects/hit-pulse";

const PEAK_ELAPSED = Math.PI / 2 / 28;

describe("hitPulseScale", () => {
  it("rests at the base scale when the strike just landed", () => {
    expect(hitPulseScale(0, 1)).toEqual({ x: 1.03, y: 1.03, z: 1.03 });
  });

  it("stretches wide and squashes tall at the sine peak", () => {
    const scale = hitPulseScale(PEAK_ELAPSED, 1);
    expect(scale.x).toBeCloseTo(1.08, 6);
    expect(scale.z).toBeCloseTo(1.08, 6);
    expect(scale.y).toBeCloseTo(1.01, 6);
  });

  it("fades the bounce in with mining progress", () => {
    const scale = hitPulseScale(PEAK_ELAPSED, 0.5);
    expect(scale.x).toBeCloseTo(1.055, 6);
    expect(scale.y).toBeCloseTo(1.02, 6);
  });

  it("never dips below the base scale on the negative half of the wave", () => {
    const scale = hitPulseScale(Math.PI / 28, 1);
    expect(scale).toEqual({ x: 1.03, y: 1.03, z: 1.03 });
  });

  it("repeats every 2π/28 seconds", () => {
    const first = hitPulseScale(0.1, 1);
    const later = hitPulseScale(0.1 + (2 * Math.PI) / 28, 1);
    expect(later.x).toBeCloseTo(first.x, 6);
    expect(later.y).toBeCloseTo(first.y, 6);
  });
});