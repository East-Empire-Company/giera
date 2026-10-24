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
});
