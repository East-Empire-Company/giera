import { describe, expect, it } from "vitest";
import { PROTAGONISTS } from "../../src/client/entities/player";

describe("protagonist identities", () => {
  it("keeps player names and roles distinct", () => {
    expect(PROTAGONISTS.p1.name).toBe("Ziemek");
    expect(PROTAGONISTS.p1.role).toContain("Starszy brat");
    expect(PROTAGONISTS.p2.name).toBe("Gniewko");
    expect(PROTAGONISTS.p2.role).toContain("Młodszy brat");
  });
});
