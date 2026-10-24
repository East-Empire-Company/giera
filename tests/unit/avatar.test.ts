import { describe, expect, it } from "vitest";
import { PROTAGONISTS } from "../../src/client/entities/player";

describe("protagonist definitions", () => {
  it("configures Ziemek with pixel teal hoodie and charcoal cargo pants", () => {
    const ziemek = PROTAGONISTS.p1;
    expect(ziemek.name).toBe("Ziemek");
    expect(ziemek.avatarId).toBe("playerOne");
    expect(ziemek.accentColor).toBe("#2ca999");
    expect(ziemek.scale).toBeCloseTo(0.68, 2);
    expect(ziemek.clothing?.torso).toBe("#22998a");
    expect(ziemek.clothing?.legs).toBe("#24272e");
  });

  it("configures Gniewko with white polo and navy trousers", () => {
    const gniewko = PROTAGONISTS.p2;
    expect(gniewko.name).toBe("Gniewko");
    expect(gniewko.avatarId).toBe("playerTwo");
    expect(gniewko.accentColor).toBe("#ffffff");
    expect(gniewko.scale).toBeCloseTo(0.63, 2);
    expect(gniewko.clothing?.torso).toBe("#f6f8fb");
    expect(gniewko.clothing?.legs).toBe("#1d2d48");
  });
});
