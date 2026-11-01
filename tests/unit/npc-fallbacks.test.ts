import { describe, expect, it } from "vitest";
import { NPC_FALLBACK_LINES, fallbackLine, fallbackReplyContent } from "../../src/shared/npc-fallbacks";

describe("pre-generated NPC fallback lines", () => {
  it("keeps every line inside the persona word budget", () => {
    for (const [npcId, lines] of Object.entries(NPC_FALLBACK_LINES)) {
      for (const line of lines) {
        const words = line.trim().split(/\s+/).length;
        const budget = npcId === "ciocia" ? 6 : 12;
        expect(words, `${npcId}: ${line}`).toBeLessThanOrEqual(budget);
      }
    }
  });

  it("picks the same line for the same question", () => {
    expect(fallbackLine("tata", "Co mam zrobić?")).toBe(fallbackLine("tata", "Co mam zrobić?"));
  });

  it("uses persona-specific lines for each NPC", () => {
    const tata = fallbackLine("tata", "hej");
    const mama = fallbackLine("mama", "hej");
    expect(NPC_FALLBACK_LINES.tata).toContain(tata);
    expect(NPC_FALLBACK_LINES.mama).toContain(mama);
  });

  it("falls back to a generic line for unknown NPCs", () => {
    const line = fallbackLine("nieznany", "hej");
    expect(line.length).toBeGreaterThan(0);
    expect(line.trim().split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it("emits a brain-reply JSON payload without tool or walk_to", () => {
    const parsed = JSON.parse(fallbackReplyContent("mama", "Zrób mi kilof")) as {
      say: string;
      tool: string | null;
      walk_to: unknown;
    };
    expect(parsed.say.length).toBeGreaterThan(0);
    expect(parsed.tool).toBeNull();
    expect(parsed.walk_to).toBeNull();
  });
});
