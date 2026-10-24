import { describe, expect, it } from "vitest";
import { ObjectiveManager, OBJECTIVE_STEPS } from "../../src/client/game/objectives";

describe("ObjectiveManager", () => {
  it("initializes at step 0 with Polish opening objective", () => {
    const manager = new ObjectiveManager();
    expect(manager.currentStep.id).toBe("gather_wood");
    expect(manager.currentStep.title).toBe("Zbierz drewno (0/4)");
    expect(manager.isComplete).toBe(false);
  });

  it("advances progress upon gathering wood and completes step", () => {
    const manager = new ObjectiveManager();
    manager.recordAction("gather_wood", 2);
    expect(manager.currentStep.title).toBe("Zbierz drewno (2/4)");

    const advanced = manager.recordAction("gather_wood", 2);
    expect(advanced).toBe(true);
    expect(manager.currentStep.id).toBe("craft_planks");
  });

  it("cycles through all 6 tutorial milestones", () => {
    const manager = new ObjectiveManager();
    expect(OBJECTIVE_STEPS.length).toBe(6);
    expect(OBJECTIVE_STEPS.map((s) => s.id)).toEqual([
      "gather_wood",
      "craft_planks",
      "craft_sticks",
      "find_stone",
      "craft_tool",
      "build_house",
    ]);
  });
});
