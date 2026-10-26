import { describe, expect, it, beforeEach } from "vitest";
import { handleNpcReason, resetNpcRateLimits } from "../../server/npc-reason";

type ProxyCall = { ip: string };

function request(body: unknown, ip = "10.0.0.1"): Request {
  return new Request("http://localhost:8080/npc/reason", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function fallbackBody(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("server NPC reason resilience", () => {
  beforeEach(() => resetNpcRateLimits());

  it("passes a successful upstream reply through untouched", async () => {
    const content = '{"say": "Idź na północ", "tool": null}';
    const res = await handleNpcReason(request({ npcId: "mina", message: "hej" }), {
      proxyFn: async () => fallbackBody(content),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { choices: { message: { content: string } }[]; fallback?: boolean };
    expect(body.choices[0].message.content).toBe(content);
    expect(body.fallback).toBeFalsy();
  });

  it("answers with a pre-generated line when the LLM is rate limited", async () => {
    let proxyCalls = 0;
    const res = await handleNpcReason(request({ npcId: "staszek", message: "zrób kilof" }), {
      proxyFn: async () => {
        proxyCalls++;
        return new Response("rate limited", { status: 429 });
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { choices: { message: { content: string } }[]; fallback?: boolean };
    const parsed = JSON.parse(body.choices[0].message.content) as { say: string; tool: string | null };
    expect(parsed.say.length).toBeGreaterThan(0);
    expect(parsed.tool).toBeNull();
    expect(body.fallback).toBe(true);
    expect(proxyCalls).toBe(1);
  });

  it("answers with a pre-generated line when the LLM fails", async () => {
    const res = await handleNpcReason(request({ npcId: "papuga", message: "hej" }), {
      proxyFn: async () => new Response("boom", { status: 500 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { choices: { message: { content: string } }[]; fallback?: boolean };
    expect(body.fallback).toBe(true);
    expect(JSON.parse(body.choices[0].message.content).say.length).toBeGreaterThan(0);
  });
  it("answers with a pre-generated line when the upstream connection throws", async () => {
    const res = await handleNpcReason(request({ npcId: "mina", message: "hei" }), {
      proxyFn: async () => { throw new Error("socket hang up"); },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fallback?: boolean; choices: { message: { content: string } }[] };
    expect(body.fallback).toBe(true);
    expect(JSON.parse(body.choices[0].message.content).tool).toBeNull();
  });

  it("keeps the per-IP limiter but serves pre-generated lines instead of errors", async () => {
    let proxyCalls = 0;
    const proxyFn = async () => {
      proxyCalls++;
      return fallbackBody('{"say": "ok", "tool": null}');
    };
    for (let i = 0; i < 10; i++) {
      const res = await handleNpcReason(request({ npcId: "mina", message: `pytanie ${i}` }), { proxyFn });
      expect(res.status).toBe(200);
    }
    const limited = await handleNpcReason(request({ npcId: "mina", message: "za dużo" }), { proxyFn });
    expect(limited.status).toBe(200);
    const body = (await limited.json()) as { fallback?: boolean };
    expect(body.fallback).toBe(true);
    expect(proxyCalls).toBe(10);
  });

  it("still rejects malformed requests", async () => {
    const badJson = await handleNpcReason(
      new Request("http://localhost:8080/npc/reason", { method: "POST", body: "not json" }),
      { proxyFn: async () => fallbackBody("{}") }
    );
    expect(badJson.status).toBe(400);
    const empty = await handleNpcReason(request({ npcId: "mina", message: "  " }), {
      proxyFn: async () => fallbackBody("{}"),
    });
    expect(empty.status).toBe(400);
  });
});
