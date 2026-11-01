import { describe, expect, it } from "vitest";
import { ALLOWED_NPC_BLOCKS, NPC_ALLOWED_TOOLS, executeNpcClientTool } from "../../server/npc-bridge";

const newInventory = () => ({ blocks: {} as Record<string, number>, items: {} as Record<string, number> });

describe("NPC bridge give_block", () => {
  it.each([1, 8, 16])("gives exactly %i blocks", (count) => {
    const inv = newInventory();
    const res = executeNpcClientTool("tata", "give_block", { block_type: "planks", count }, inv);
    expect(res.success).toBe(true);
    expect(inv.blocks).toEqual({ planks: count });
    expect(inv.items).toEqual({});
  });

  it("adds to an existing stack", () => {
    const inv = newInventory();
    inv.blocks.planks = 5;
    executeNpcClientTool("tata", "give_block", { block_type: "planks", count: 3 }, inv);
    expect(inv.blocks.planks).toBe(8);
  });

  it.each([
    ["zero", 0],
    ["above max", 17],
    ["fractional", 1.5],
    ["negative", -1],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["numeric string", "8"],
    ["hex string", "0x10"],
    ["boolean", true],
    ["null", null],
    ["array", [4]],
    ["missing", undefined],
  ])("rejects count %s and leaves the inventory untouched", (_name, count) => {
    const inv = newInventory();
    inv.blocks.planks = 2;
    const res = executeNpcClientTool("tata", "give_block", { block_type: "planks", count }, inv);
    expect(res.success).toBe(false);
    expect(inv).toEqual({ blocks: { planks: 2 }, items: {} });
  });

  it.each(["bedrock", "stone", "", "constructor", "PLANKS"])("rejects block_type %j", (blockType) => {
    const inv = newInventory();
    const res = executeNpcClientTool("tata", "give_block", { block_type: blockType, count: 1 }, inv);
    expect(res.success).toBe(false);
    expect(inv).toEqual(newInventory());
  });

  it.each([undefined, null, 5, ["planks"], { toString: () => "planks" }])("rejects non-string block_type %j", (blockType) => {
    const inv = newInventory();
    const res = executeNpcClientTool("tata", "give_block", { block_type: blockType, count: 1 }, inv);
    expect(res.success).toBe(false);
    expect(inv).toEqual(newInventory());
  });

  it.each(ALLOWED_NPC_BLOCKS)("allows %s", (blockType) => {
    const inv = newInventory();
    expect(executeNpcClientTool("tata", "give_block", { block_type: blockType, count: 2 }, inv).success).toBe(true);
    expect(inv.blocks[blockType]).toBe(2);
  });
});

describe("NPC bridge give_quest", () => {
  it.each(["gather_wood", "craft_planks", "craft_sticks", "find_stone", "craft_tool", "build_house"])("sets step %s", (step) => {
    const seen: string[] = [];
    const res = executeNpcClientTool("tata", "give_quest", { step_id: step }, undefined, (s) => seen.push(s));
    expect(res.success).toBe(true);
    expect(seen).toEqual([step]);
  });

  it.each(["", "fly_to_moon", "CRAFT_PLANKS", "constructor", 3, null, undefined, ["craft_planks"]])(
    "rejects step %j without invoking the callback",
    (step) => {
      const seen: string[] = [];
      const res = executeNpcClientTool("tata", "give_quest", { step_id: step }, undefined, (s) => seen.push(s));
      expect(res.success).toBe(false);
      expect(seen).toEqual([]);
    },
  );
});

describe("NPC bridge permissions and unknown tools", () => {
  it("rejects an unknown tool", () => {
    const inv = newInventory();
    expect(executeNpcClientTool("tata", "delete_world", {}, inv).success).toBe(false);
    expect(inv).toEqual(newInventory());
  });

  it("lets every NPC use exactly the tools it is configured with", () => {
    const allTools = ["give_block", "give_quest", "share_map_hint"];
    for (const [npc, allowed] of Object.entries(NPC_ALLOWED_TOOLS)) {
      for (const tool of allTools) {
        const inv = newInventory();
        const quests: string[] = [];
        const res = executeNpcClientTool(
          npc,
          tool,
          { block_type: "planks", count: 1, step_id: "craft_planks", topic: "drzewa" },
          inv,
          (s) => quests.push(s),
        );
        expect(res.success, `${npc}/${tool}`).toBe(allowed.includes(tool));
        if (!allowed.includes(tool)) {
          expect(inv).toEqual(newInventory());
          expect(quests).toEqual([]);
        }
      }
    }
  });

  it("denies give_quest to ciocia and share_map_hint to ciocia", () => {
    expect(executeNpcClientTool("ciocia", "give_quest", { step_id: "craft_planks" }).success).toBe(false);
    expect(executeNpcClientTool("ciocia", "share_map_hint", { topic: "drzewa" }).success).toBe(false);
  });

  it.each(["unknown_npc", "", "constructor", "__proto__", "toString"])("denies every tool to NPC id %j", (npc) => {
    const inv = newInventory();
    expect(executeNpcClientTool(npc, "give_block", { block_type: "planks", count: 1 }, inv).success).toBe(false);
    expect(inv).toEqual(newInventory());
  });
});

describe("NPC bridge share_map_hint", () => {
  it.each([
    ["drzewa", "drzew"],
    ["kamień", "skał"],
    ["woda", "woda"],
    ["dom", "polana"],
  ])("answers a topic hint for %s", (topic, fragment) => {
    const res = executeNpcClientTool("tata", "share_map_hint", { topic });
    expect(res.success).toBe(true);
    expect(res.hint?.toLowerCase()).toContain(fragment);
  });

  it("falls back to a generic hint for unknown or missing topics", () => {
    const generic = executeNpcClientTool("tata", "share_map_hint", { topic: "xyz" }).hint;
    expect(generic).toBeTruthy();
    expect(executeNpcClientTool("tata", "share_map_hint", {}).hint).toBe(generic);
  });
});
