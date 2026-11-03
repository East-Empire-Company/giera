import { beforeEach, describe, expect, it } from "vitest";
import { handleCompanionPlan, resetCompanionPlanState } from "../../server/companion-plan";

const request = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost:8080/npc/companion", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

const completion = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("handleCompanionPlan", () => {
  beforeEach(() => resetCompanionPlanState());

  it("returns a selected task without consulting the model", async () => {
    let calls = 0;
    const response = await handleCompanionPlan(request('{"task":"follow"}'), {
      clientIp: "10.0.0.1",
      fetchFn: async () => {
        calls++;
        return completion('{"task":"stop"}');
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ task: "follow" });
    expect(calls).toBe(0);
  });

  it("asks the model to classify only a transcript into a task", async () => {
    let sent: Record<string, unknown> | undefined;
    const response = await handleCompanionPlan(request('{"transcript":"chodź za mną"}'), {
      clientIp: "10.0.0.2",
      fetchFn: async (_url, init) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return completion('{"task":"follow"}');
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ task: "follow" });
    const messages = sent?.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain('{"task":"follow"|"scout"|"build"|"stop"}');
    expect(messages[1]).toEqual({ role: "user", content: "chodź za mną" });
  });

  it("returns null for model output outside the task enum", async () => {
    const response = await handleCompanionPlan(request('{"transcript":"zrób coś"}'), {
      clientIp: "10.0.0.3",
      fetchFn: async () => completion('{"task":"mine","command":"hack"}'),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ task: null });
  });

  it.each([
    ["invalid JSON", "{"],
    ["unknown fields", '{"task":"follow","transcript":"chodź"}'],
    ["unknown task", '{"task":"mine"}'],
    ["oversized transcript", JSON.stringify({ transcript: "x".repeat(301) })],
  ])("rejects %s", async (_label, body) => {
    const response = await handleCompanionPlan(request(body), { clientIp: "10.0.0.4" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ task: null });
  });

  it("rejects a request body above 4096 bytes", async () => {
    const response = await handleCompanionPlan(request('{"task":"follow"}' + " ".repeat(4096)), {
      clientIp: "10.0.0.5",
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ task: null });
  });
  it("rejects oversized declared bodies without pulling the stream", async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(4097));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const req = new Request("http://localhost:8080/npc/companion", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "4097" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const pullsBeforeHandling = pulls;
    const response = await handleCompanionPlan(req, { clientIp: "10.0.0.7" });

    expect(response.status).toBe(413);
    expect(pulls).toBe(pullsBeforeHandling);
  });


  it("limits each real peer to 10 requests per minute", async () => {
    const options = { clientIp: "10.0.0.6" };
    for (let i = 0; i < 10; i++) {
      const response = await handleCompanionPlan(
        request('{"task":"follow"}', { "x-forwarded-for": `spoof-${i}` }),
        options,
      );
      expect(response.status).toBe(200);
    }
    const limited = await handleCompanionPlan(
      request('{"task":"follow"}', { "x-forwarded-for": "different-spoof" }),
      options,
    );
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ task: null });
  });
});
