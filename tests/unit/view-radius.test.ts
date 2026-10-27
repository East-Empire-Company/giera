import { describe, expect, it } from "vitest";
import { FULL_VIEW_RADIUS, LOW_POWER_VIEW_RADIUS, pickViewRadius } from "../../src/shared/view-radius";

const XBOX_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox Series X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edge/120.0.0.0";
const DESKTOP_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

describe("pickViewRadius", () => {
  it("limits Xbox Edge to the low-power radius", () => {
    expect(pickViewRadius(XBOX_EDGE, 8)).toBe(LOW_POWER_VIEW_RADIUS);
  });

  it("limits devices reporting 4 GB or less", () => {
    expect(pickViewRadius(DESKTOP_CHROME, 4)).toBe(LOW_POWER_VIEW_RADIUS);
  });

  it("uses the full radius on a capable desktop and when memory is not reported", () => {
    expect(pickViewRadius(DESKTOP_CHROME, 8)).toBe(FULL_VIEW_RADIUS);
    expect(pickViewRadius(DESKTOP_CHROME, undefined)).toBe(FULL_VIEW_RADIUS);
  });
});
