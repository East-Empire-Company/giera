import { describe, expect, it } from "vitest";
import { ambientNpcChatterEnabled, chatterDelayMs, fallbackSay, parseBrainReply, reasonNpc } from "../../src/client/entities/npc-brain";

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

describe("client NPC resilience", () => {
  it("retries a rate-limited reply and returns the recovered answer", async () => {
    let attempts = 0;
    const reply = await reasonNpc("mina", "hej", [], "/npc/reason", {
      attempts: 3,
      baseMs: 10,
      jitterRatio: 0,
      sleepFn: async () => {},
      fetchFn: (async () => {
        attempts++;
        if (attempts === 1) return new Response("slow down", { status: 429 });
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"say": "Witaj!", "tool": null}' } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    });
    expect(attempts).toBe(2);
    expect(reply.say).toBe("Witaj!");
    expect(reply.fallback).toBeFalsy();
  });

  it("returns a pre-generated persona line when every retry fails", async () => {
    const reply = await reasonNpc("staszek", "zrób mi kilof", [], "/npc/reason", {
      attempts: 2,
      baseMs: 10,
      jitterRatio: 0,
      sleepFn: async () => {},
      fetchFn: async () => new Response("boom", { status: 500 }),
    });
    expect(reply.fallback).toBe(true);
    expect(reply.tool).toBeNull();
    expect(reply.say.length).toBeGreaterThan(0);
  });

  it("returns a pre-generated persona line when the server is unreachable", async () => {
    const reply = await reasonNpc("papuga", "siema", [], "/npc/reason", {
      attempts: 2,
      baseMs: 10,
      jitterRatio: 0,
      sleepFn: async () => {},
      fetchFn: (async () => {
        throw new Error("offline");
      }),
    });
    expect(reply.fallback).toBe(true);
    expect(reply.say.length).toBeGreaterThan(0);
  });

  it("falls back rather than exceeding the total response deadline", async () => {
    let attempts = 0;
    const reply = await reasonNpc("mina", "hej", [], "/npc/reason", {
      attempts: 3,
      timeoutMs: 5,
      jitterRatio: 0,
      sleepFn: async () => {},
      fetchFn: async () => {
        attempts++;
        return attempts === 1
          ? new Response("busy", { status: 429 })
          : new Response(JSON.stringify({ choices: [{ message: { content: '{"say": "ok"}' } }] }), { status: 200 });
      },
    });
    expect(attempts).toBe(1);
    expect(reply.fallback).toBe(true);
  });
  it("flags replies the server already answered with a fallback", async () => {
    const reply = await reasonNpc("mina", "hej", [], "/npc/reason", {
      attempts: 1,
      sleepFn: async () => {},
      fetchFn: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{"say": "Grrr", "tool": null}' } }], fallback: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(reply.fallback).toBe(true);
    expect(reply.say).toBe("Grrr");
  });

  it("backs ambient chatter off exponentially while the LLM stays down", () => {
    expect(chatterDelayMs(0)).toBe(20_000);
    expect(chatterDelayMs(1)).toBe(40_000);
    expect(chatterDelayMs(2)).toBe(80_000);
    expect(chatterDelayMs(9)).toBe(300_000);
  });

  it("disables ambient chatter only for the explicit capture flag", () => {
    expect(ambientNpcChatterEnabled("?seed=424242")).toBe(true);
    expect(ambientNpcChatterEnabled("?seed=424242&disableAmbientNpcChatter=1")).toBe(false);
    expect(ambientNpcChatterEnabled("?seed=424242&disableAmbientNpcChatter=0")).toBe(true);
  });
});
