import { describe, expect, it } from "vitest";
import { handleNemotronProxyRequest, validateProxyAuth } from "../../server/nemotron-proxy";

describe("Nemotron Proxy for ElevenLabs Agents", () => {
  it("rejects unauthorized requests with 401", async () => {
    const secret = "valid-eleven-workspace-secret";
    expect(validateProxyAuth("Bearer wrong-secret", secret)).toBe(false);
    expect(validateProxyAuth(null, secret)).toBe(false);
    expect(validateProxyAuth("Bearer valid-eleven-workspace-secret", secret)).toBe(true);

    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer invalid" },
      body: JSON.stringify({ messages: [] }),
    });

    const res = await handleNemotronProxyRequest(req, { expectedSecret: secret });
    expect(res.status).toBe(401);
  });
  it("normalizes request payload to force nemotron-bolt model and 300 max_tokens limit", async () => {
    let capturedBody: { model?: string; max_tokens?: number } = {};
    const mockFetch = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (typeof init?.body === "string") {
        capturedBody = JSON.parse(init.body) as { model?: string; max_tokens?: number };
      }
      return new Response(JSON.stringify({ id: "chatcmpl-test", choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer valid-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4-unsupported",
        max_tokens: 2000,
        messages: [{ role: "user", content: "Cześć Mina!" }],
      }),
    });

    const res = await handleNemotronProxyRequest(req, {
      expectedSecret: "valid-secret",
      nexgateUrl: "http://mock-nexgate/v1/chat/completions",
      fetchFn: mockFetch as typeof fetch,
    });

    expect(res.status).toBe(200);
    expect(capturedBody.model).toBe("nemotron-bolt");
    expect(capturedBody.max_tokens).toBe(300);
  });

  it("allows requests when no secret is configured (open LAN mode)", async () => {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    const res = await handleNemotronProxyRequest(req, {
      expectedSecret: "",
      nexgateUrl: "http://mock-nexgate/v1/chat/completions",
      fetchFn: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
  });

  it("honors an explicit model override", async () => {
    let capturedBody: { model?: string } = {};
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    await handleNemotronProxyRequest(req, {
      expectedSecret: "",
      model: "qwen36-modal",
      nexgateUrl: "http://mock-nexgate/v1/chat/completions",
      fetchFn: (async (_url: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body)) as { model?: string };
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    expect(capturedBody.model).toBe("qwen36-modal");
  });

  it("falls back to NEXGATE_URL env when no explicit url is given", async () => {
    const prev = process.env.NEXGATE_URL;
    process.env.NEXGATE_URL = "http://env-nexgate/v1/chat/completions";
    let capturedUrl = "";
    try {
      const req = new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [] }),
      });
      await handleNemotronProxyRequest(req, {
        expectedSecret: "",
        fetchFn: (async (url: RequestInfo | URL) => {
          capturedUrl = String(url);
          return new Response("{}", { status: 200 });
        }) as typeof fetch,
      });
    } finally {
      if (prev === undefined) delete process.env.NEXGATE_URL;
      else process.env.NEXGATE_URL = prev;
    }
    expect(capturedUrl).toBe("http://env-nexgate/v1/chat/completions");
  });
});
