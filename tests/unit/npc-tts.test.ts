import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleNpcTts, resetNpcTtsState } from "../../server/npc-tts";

const request = (body: unknown, ip = "1.2.3.4") =>
  new Request("http://x/npc/tts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });

describe("handleNpcTts", () => {
  let cacheDir = "";
  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "giera-tts-"));
    resetNpcTtsState();
  });
  afterEach(() => rmSync(cacheDir, { recursive: true, force: true }));

  it("synthesizes once per voice+text and serves repeats from cache", async () => {
    const calls: { url: string; body: { text: string; language_code: string } }[] = [];
    const fetchFn = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as unknown as typeof fetch;
    const options = { apiKey: "k", cacheDir, fetchFn };
    const first = await handleNpcTts(request({ npcId: "mama", text: "Cześć, zbuduj domek!" }), options);
    expect(first.headers.get("content-type")).toBe("audio/mpeg");
    expect([...new Uint8Array(await first.arrayBuffer())]).toEqual([1, 2, 3]);
    resetNpcTtsState();
    const second = await handleNpcTts(request({ npcId: "mama", text: "Cześć, zbuduj domek!" }), options);
    expect([...new Uint8Array(await second.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/v1/text-to-speech/0zoGygYjh97gnqQuHI0b");
    expect(calls[0].body.language_code).toBe("pl");
  });

  it("answers 503 when no API key is configured and 400 for empty text", async () => {
    const noKey = await handleNpcTts(request({ npcId: "tata", text: "hej" }), { apiKey: "", cacheDir });
    expect(noKey.status).toBe(503);
    const empty = await handleNpcTts(request({ npcId: "tata", text: "   " }), { apiKey: "k", cacheDir });
    expect(empty.status).toBe(400);
  });

  it("returns 502 when the provider fails and never caches the failure", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;
    const options = { apiKey: "k", cacheDir, fetchFn };
    expect((await handleNpcTts(request({ npcId: "tata", text: "hej" }), options)).status).toBe(502);
    expect((await handleNpcTts(request({ npcId: "tata", text: "hej" }), options)).status).toBe(502);
    expect(calls).toBe(2);
  });

  it("rate limits uncached synthesis per IP", async () => {
    const fetchFn = (async () => new Response(new Uint8Array([9]), { status: 200 })) as unknown as typeof fetch;
    const options = { apiKey: "k", cacheDir, fetchFn };
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      const res = await handleNpcTts(request({ npcId: "ciocia", text: `linia ${i}` }, "9.9.9.9"), options);
      if (res.status === 429) limited++;
    }
    expect(limited).toBe(10);
  });
});
