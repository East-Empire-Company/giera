import { describe, expect, it } from "vitest";
import { COMPANION_LINES, interpretCompanionUtterance } from "../../src/shared/companion-speech";

describe("companion speech", () => {
  it("provides a fixed child-safe line for every event", () => {
    expect(Object.keys(COMPANION_LINES).sort()).toEqual([
      "building", "built", "follow", "found", "scouting", "spawn", "stopped", "stuck",
    ]);
    expect(Object.values(COMPANION_LINES).every((line) => line.length > 0 && line.length <= 48)).toBe(true);
  });

  it("maps only exact normalized Polish commands", () => {
    expect(interpretCompanionUtterance("  CHODŹ   ZA MNĄ ")).toEqual({ task: "follow" });
    expect(interpretCompanionUtterance("Szukaj")).toEqual({ task: "scout" });
    expect(interpretCompanionUtterance("zbuduj domek")).toEqual({ task: "build" });
    expect(interpretCompanionUtterance("stop")).toEqual({ task: "stop" });
    expect(interpretCompanionUtterance("szukaj kamieni")).toBeNull();
    expect(interpretCompanionUtterance("stop!")).toBeNull();
  });
});
