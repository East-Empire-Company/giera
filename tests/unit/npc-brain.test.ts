import { describe, expect, it } from "vitest";
import { fallbackSay, parseBrainReply } from "../../src/client/entities/npc-brain";

describe("parseBrainReply", () => {
  it("parses a clean JSON reply with tool and args", () => {
    const reply = parseBrainReply('{"say": "Proszę, 4 deski!", "tool": "give_block", "args": {"block_type": "planks", "count": 4}}');
    expect(reply.say).toBe("Proszę, 4 deski!");
    expect(reply.tool).toBe("give_block");
    expect(reply.args).toEqual({ block_type: "planks", count: 4 });
  });

  it("parses JSON wrapped in a code fence", () => {
    const reply = parseBrainReply('```json\n{"say": "Cześć!", "tool": null}\n```');
    expect(reply.say).toBe("Cześć!");
    expect(reply.tool).toBeNull();
  });

  it("extracts JSON embedded in chatter", () => {
    const reply = parseBrainReply('Odpowiedź: {"say": "Idź na północ", "tool": null} — koniec.');
    expect(reply.say).toBe("Idź na północ");
  });

  it("falls back to raw text on malformed JSON", () => {
    const reply = parseBrainReply('{"say": "złamany json", "tool":');
    expect(reply.say).toBe('{"say": "złamany json", "tool":');
    expect(reply.tool).toBeNull();
  });

  it("falls back to raw text when say is missing", () => {
    const reply = parseBrainReply('{"tool": "give_block"}');
    expect(reply.say).toBe('{"tool": "give_block"}');
    expect(reply.tool).toBeNull();
  });

  it("returns ellipsis for empty input", () => {
    expect(parseBrainReply("").say).toBe("...");
  });

  it("rejects array args", () => {
    const reply = parseBrainReply('{"say": "hej", "tool": "give_block", "args": [1,2]}');
    expect(reply.args).toEqual({});
  });

  it("parses walk_to coordinates", () => {
    const reply = parseBrainReply('{"say": "Idę do drzew!", "tool": null, "walk_to": {"x": 0, "z": -10}}');
    expect(reply.walk_to).toEqual({ x: 0, z: -10 });
  });

  it("ignores malformed walk_to", () => {
    expect(parseBrainReply('{"say": "hej", "tool": null, "walk_to": {"x": "north", "z": 1}}').walk_to).toBeNull();
    expect(parseBrainReply('{"say": "hej", "tool": null, "walk_to": [1,2]}').walk_to).toBeNull();
    expect(parseBrainReply('{"say": "hej", "tool": null}').walk_to).toBeNull();
  });
});

describe("fallbackSay", () => {
  it("echoes the player text in the deterministic kid-friendly format", () => {
    expect(fallbackSay("Co mam zrobić?")).toBe('Słyszę Cię! "Co mam zrobić?". Wspaniale, że jesteś!');
  });
});
