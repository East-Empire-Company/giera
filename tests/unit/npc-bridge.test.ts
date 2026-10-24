import { describe, expect, it } from "vitest";
import { executeNpcClientTool } from "../../server/npc-bridge";

describe("NPC Bridge client tool executor", () => {
  it("executes give_block tool safely with validation", () => {
    const inv = { blocks: {} as Record<string, number>, items: {} as Record<string, number> };
    const res = executeNpcClientTool("give_block", { block_type: "planks", count: 8 }, inv);
    expect(res.success).toBe(true);
    expect(inv.blocks.planks).toBe(8);

    const invalid = executeNpcClientTool("give_block", { block_type: "bedrock", count: 8 }, inv);
    expect(invalid.success).toBe(false);
  });

  it("executes give_quest tool", () => {
    let currentQuest = "gather_wood";
    const res = executeNpcClientTool("give_quest", { step_id: "craft_planks" }, undefined, (step) => {
      currentQuest = step;
    });
    expect(res.success).toBe(true);
    expect(currentQuest).toBe("craft_planks");
  });

  it("executes share_map_hint without LLM calls", () => {
    const res = executeNpcClientTool("share_map_hint", { topic: "drzewa" });
    expect(res.success).toBe(true);
    expect(res.hint).toContain("drzew");
  });
});
