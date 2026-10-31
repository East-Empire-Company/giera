import { describe, expect, it } from "vitest";
import { daylightAt } from "../../src/client/render/day-cycle";

describe("thirty-minute day cycle", () => {
  it("starts in daylight and reaches darkness at midnight", () => {
    expect(daylightAt(150).daylight).toBeCloseTo(1);
    expect(daylightAt(1350).daylight).toBe(0);
  });

  it("wraps deterministically after 1800 seconds", () => {
    expect(daylightAt(1950)).toEqual(daylightAt(150));
  });
});
