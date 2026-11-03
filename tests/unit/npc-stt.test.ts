import { beforeEach, describe, expect, it } from "vitest";
import { handleNpcStt, resetNpcSttState } from "../../server/npc-stt";

const sttRequest = (form: FormData, ip = "1.2.3.4") =>
  new Request("http://x/npc/stt", { method: "POST", headers: { "x-forwarded-for": ip }, body: form });

const voiceForm = () => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(16)], "voice.webm", { type: "audio/webm" }));
  return form;
};

const jsonFetch = (body: unknown, status = 200) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
};

describe("handleNpcStt", () => {
  beforeEach(() => {
    resetNpcSttState();
  });

  it("rejects non-POST requests", async () => {
    const res = await handleNpcStt(new Request("http://x/npc/stt"), { apiKey: "k" });
    expect(res.status).toBe(405);
    expect(await res.text()).toBe("Method not allowed");
  });

  it("answers 503 when no API key is configured", async () => {
    const res = await handleNpcStt(sttRequest(voiceForm()), { apiKey: "" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "stt_not_configured" });
  });

  it("answers 400 when the multipart body has no file field", async () => {
    const { calls, fetchFn } = jsonFetch({ text: "x" });
    const form = new FormData();
    form.append("other", "x");
    const res = await handleNpcStt(sttRequest(form), { apiKey: "k", fetchFn });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "stt_file_missing" });
    expect(calls).toHaveLength(0);
  });

  it("answers 413 when the uploaded file is too large", async () => {
    const { calls, fetchFn } = jsonFetch({ text: "x" });
    const form = new FormData();
    form.append("file", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.webm", { type: "audio/webm" }));
    const res = await handleNpcStt(sttRequest(form), { apiKey: "k", fetchFn });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "stt_file_too_large" });
    expect(calls).toHaveLength(0);
  });

  it("answers 429 when the request limiter rejects the client", async () => {
    const { calls, fetchFn } = jsonFetch({ text: "x" });
    const res = await handleNpcStt(sttRequest(voiceForm()), { apiKey: "k", fetchFn, allowRequest: () => false });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "stt_rate_limited" });
    expect(calls).toHaveLength(0);
  });

  it("limits each IP to 20 requests per minute", async () => {
    const { fetchFn } = jsonFetch({ text: "ok" });
    const options = { apiKey: "k", fetchFn };
    let limited = 0;
    for (let i = 0; i < 25; i++) {
      const res = await handleNpcStt(sttRequest(voiceForm(), "9.9.9.9"), options);
      if (res.status === 429) limited++;
    }
    expect(limited).toBe(5);
  });

  it("forwards the recording to the ElevenLabs speech-to-text endpoint", async () => {
    const { calls, fetchFn } = jsonFetch({ text: "ok" });
    const res = await handleNpcStt(sttRequest(voiceForm()), { apiKey: "k", fetchFn, clientIp: "peer-a" });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect((calls[0].init.headers as Record<string, string>)["xi-api-key"]).toBe("k");
    const body = calls[0].init.body as FormData;
    expect(body.get("model_id")).toBe("scribe_v1");
    expect(body.get("language_code")).toBe("pl");
    const file = body.get("file") as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.size).toBe(16);
    expect(file.name).toBe("voice.webm");
  });

  it("returns the trimmed transcript", async () => {
    const { fetchFn } = jsonFetch({ text: "  Cześć  " });
    const res = await handleNpcStt(sttRequest(voiceForm()), { apiKey: "k", fetchFn });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "Cześć" });
  });

  it("returns an empty transcript when the upstream text is missing or not a string", async () => {
    const missing = jsonFetch({});
    const res = await handleNpcStt(sttRequest(voiceForm()), { apiKey: "k", fetchFn: missing.fetchFn });
    expect(await res.json()).toEqual({ text: "" });
    const wrongType = jsonFetch({ text: 42 });
    const res2 = await handleNpcStt(sttRequest(voiceForm()), { apiKey: "k", fetchFn: wrongType.fetchFn });
    expect(await res2.json()).toEqual({ text: "" });
  });

  it("answers 429 when the upstream rate limits the key", async () => {
    const { fetchFn } = jsonFetch({ detail: "slow down" }, 429);
    const res = await handleNpcStt(sttRequest(voiceForm()), { apiKey: "k", fetchFn });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "stt_upstream_rate_limited" });
  });

  it("answers 502 when the upstream fails", async () => {
    const { fetchFn } = jsonFetch({ detail: "boom" }, 500);
    const res = await handleNpcStt(sttRequest(voiceForm()), { apiKey: "k", fetchFn });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "stt_upstream_failed", status: 500 });
  });

  it("answers 502 when the upstream is unreachable", async () => {
    const fetchFn = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const res = await handleNpcStt(sttRequest(voiceForm()), { apiKey: "k", fetchFn });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "stt_upstream_unreachable" });
  });
  it("uses the injected peer address instead of forwarded headers", async () => {
    const { fetchFn } = jsonFetch({ text: "ok" });
    let limited = 0;
    for (let i = 0; i < 21; i++) {
      const response = await handleNpcStt(sttRequest(voiceForm(), `spoof-${i}`), {
        apiKey: "k",
        fetchFn,
        clientIp: "real-peer",
      });
      if (response.status === 429) limited++;
    }
    expect(limited).toBe(1);

    const otherPeer = await handleNpcStt(sttRequest(voiceForm(), "spoof-20"), {
      apiKey: "k",
      fetchFn,
      clientIp: "other-real-peer",
    });
    expect(otherPeer.status).toBe(200);
  });

  it("limits all peers to 60 requests per minute", async () => {
    const { calls, fetchFn } = jsonFetch({ text: "ok" });
    for (let i = 0; i < 60; i++) {
      const response = await handleNpcStt(sttRequest(voiceForm()), {
        apiKey: "k",
        fetchFn,
        clientIp: `peer-${i}`,
      });
      expect(response.status).toBe(200);
    }
    const limited = await handleNpcStt(sttRequest(voiceForm()), {
      apiKey: "k",
      fetchFn,
      clientIp: "peer-60",
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "stt_rate_limited" });
    expect(calls).toHaveLength(60);
  });

  it("rejects oversized chunked multipart requests before parsing them", async () => {
    const { calls, fetchFn } = jsonFetch({ text: "ok" });
    const chunk = new Uint8Array(10 * 1024 * 1024 + 64 * 1024 + 1);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const req = new Request("http://x/npc/stt", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body,
      duplex: "half",
    } as RequestInit);
    const response = await handleNpcStt(req, {
      apiKey: "k",
      fetchFn,
      clientIp: "chunked-peer",
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "stt_file_too_large" });
    expect(calls).toHaveLength(0);
  });
});
