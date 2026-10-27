import { describe, expect, it } from "vitest";
import { BASE_LOOK_RADIANS_PER_PIXEL, lookGain } from "../../src/shared/look-sensitivity";

describe("lookGain", () => {
  it("amplifies slow trackpad movements more than fast flicks", () => {
    expect(lookGain(1, 0)).toBeGreaterThan(lookGain(8, 0));
    expect(lookGain(8, 0)).toBeGreaterThan(lookGain(40, 0));
  });

  it("settles to the base rate for fast mouse movement and is faster than the old fixed 0.0025 everywhere", () => {
    expect(lookGain(60, 0)).toBeCloseTo(BASE_LOOK_RADIANS_PER_PIXEL, 4);
    for (const speed of [1, 3, 10, 30, 80]) expect(lookGain(speed, 0)).toBeGreaterThan(0.0025);
  });

  it("depends on total speed, not axis", () => {
    expect(lookGain(3, 4)).toBeCloseTo(lookGain(5, 0), 10);
  });
});
