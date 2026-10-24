import { describe, expect, it } from "vitest";
import { daylightAt } from "../../src/client/render/day-cycle";

describe("ten-minute day cycle", () => {
  it("reaches daylight at noon and darkness at midnight", () => {
    expect(daylightAt(150).daylight).toBeCloseTo(1);
    expect(daylightAt(450).daylight).toBe(0);
  });

  it("wraps deterministically after 600 seconds", () => {
    expect(daylightAt(750)).toEqual(daylightAt(150));
  });
});
