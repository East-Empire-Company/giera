import { describe, expect, it } from "vitest";
import { resolveWorldSeed } from "../../src/client/startup/world-seed";

describe("world seed selection", () => {
  it("prefers a valid integer seed from the URL", () => {
    expect(resolveWorldSeed("?seed=98765", 12)).toBe(98765);
    expect(resolveWorldSeed("?seed=-4", 12)).toBe(-4);
  });

  it("uses the supplied random seed for malformed or unsafe values", () => {
    expect(resolveWorldSeed("?seed=1.5", 12)).toBe(12);
    expect(resolveWorldSeed("?seed=9007199254740992", 12)).toBe(12);
  });
});
