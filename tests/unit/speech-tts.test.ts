import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, statSync, readdirSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enforceSpeechTtsDiskBound, handleSpeechTts, resetSpeechTtsState, SPEECH_VOICES } from "../../server/speech-tts";

const call = async (body: unknown, options: Parameters<typeof handleSpeechTts>[1] = {}) =>
  handleSpeechTts(new Request("http://x/speech/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), options);

const audio = (bytes: number[]) => new Response(new Uint8Array(bytes), { status: 200 });

type Provider = {
  calls: { url: string; init: RequestInit }[];
  called: Promise<void>;
  next: (response: Response | Error) => void;
  fetchFn: typeof fetch;
};

const heldProvider = (): Provider => {
  const calls: { url: string; init: RequestInit }[] = [];
  const resolvers: { promise: Promise<Response>; resolve: (value: Response) => void; reject: (reason: unknown) => void }[] = [];
  const { promise: called, resolve: markCalled } = Promise.withResolvers<void>();
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    markCalled();
    const { promise, resolve, reject } = Promise.withResolvers<Response>();
    resolvers.push({ promise, resolve, reject });
    return promise;
  }) as unknown as typeof fetch;
  return {
    calls,
    called,
    next: (response) => {
      const pending = resolvers.shift();
      if (!pending) throw new Error("no pending provider call");
      if (response instanceof Error) pending.reject(response);
      else pending.resolve(response);
    },
    fetchFn,
  };
};

const immediateProvider = (payloads: Uint8Array[] = []) => {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fetchFn = (async (url: string | URL) => {
    calls.push({ url: String(url), init: {} });
    return audio([...(payloads[i++] ?? new Uint8Array([9]))]);
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
};

const scriptedProvider = (responses: Array<Response | Error>) => {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[i++] ?? new Response("nope", { status: 500 });
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
};

describe("handleSpeechTts", () => {
  let cacheDir = "";
  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "giera-speech-"));
    resetSpeechTtsState();
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("answers 405 for non-POST and 400 for invalid JSON, unknown speaker, and empty text", async () => {
    expect((await handleSpeechTts(new Request("http://x/speech/tts"), { cacheDir })).status).toBe(405);
    expect((await call("not json", { cacheDir })).status).toBe(400);
    expect((await call({ speakerId: "zzz", text: "hej" }, { apiKey: "k", cacheDir })).status).toBe(400);
    expect((await call({ speakerId: "tata", text: "   " }, { apiKey: "k", cacheDir })).status).toBe(400);
  });

  it("synthesizes once for identical concurrent requests and reuses the voice mapping", async () => {
    const provider = heldProvider();
    const options = { apiKey: "k", cacheDir, fetchFn: provider.fetchFn, clientIp: "9.9.9.9" };
    const pending = Promise.all(
      Array.from({ length: 8 }, () => call({ speakerId: "mama", text: "Cześć, zbuduj domek!" }, options)),
    );
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    expect(provider.calls[0].url).toContain("/v1/text-to-speech/0zoGygYjh97gnqQuHI0b");
    expect(JSON.parse(String(provider.calls[0].init.body)).language_code).toBe("pl");
    provider.next(audio([1, 2, 3]));
    const responses = await pending;
    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("audio/mpeg");
      expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
    }
    expect(provider.calls).toHaveLength(1);
  });

  it("allows 30 unique misses per peer then 429, without consuming slots for cache hits or followers", async () => {
    const provider = heldProvider();
    const options = { apiKey: "k", cacheDir, fetchFn: provider.fetchFn, clientIp: "9.9.9.9" };
    const identical = Promise.all(
      Array.from({ length: 40 }, () => call({ speakerId: "ciocia", text: "ta sama linia" }, options)),
    );
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    provider.next(audio([5]));
    for (const res of await identical) expect(res.status).toBe(200);

    const sequential = immediateProvider();
    const seqOptions = { apiKey: "k", cacheDir, fetchFn: sequential.fetchFn, clientIp: "9.9.9.9" };
    for (let i = 0; i < 29; i++) {
      const res = await call({ speakerId: "tata", text: `linia ${i}` }, seqOptions);
      expect(res.status).toBe(200);
    }
    expect((await call({ speakerId: "tata", text: "linia 29" }, seqOptions)).status).toBe(429);
    expect(sequential.calls).toHaveLength(29);
  });

  it("rejects the 65th same-key follower with 429", async () => {
    const provider = heldProvider();
    const options = { apiKey: "k", cacheDir, fetchFn: provider.fetchFn, clientIp: "9.9.9.9" };
    const pending = Array.from({ length: 65 }, () => call({ speakerId: "tata", text: "kolejka" }, options));
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    provider.next(audio([7]));
    const responses: Response[] = await Promise.all(pending);
    expect(responses.filter((r: Response) => r.status === 200)).toHaveLength(64);
    expect(responses.filter((r: Response) => r.status === 429)).toHaveLength(1);
  });

  it("queues at most 16 distinct keys behind an active synthesis and overflows with 503", async () => {
    const calls: string[] = [];
    const { promise: held, resolve: releaseHeld } = Promise.withResolvers<Response>();
    held.catch(() => undefined);
    let immediate = false;
    const fetchFn = (async (url: string | URL) => {
      calls.push(String(url));
      if (!immediate) return held;
      return audio([1]);
    }) as unknown as typeof fetch;
    const options = { apiKey: "k", cacheDir, fetchFn, clientIp: "9.9.9.9" };
    const active = call({ speakerId: "tata", text: "aktywne" }, options);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const queued = Array.from({ length: 16 }, (_, i) => call({ speakerId: "tata", text: `kolejka ${i}` }, options));
    expect((await call({ speakerId: "tata", text: "nadmiar" }, options)).status).toBe(503);
    immediate = true;
    releaseHeld(audio([1]));
    const responses: Response[] = await Promise.all([active, ...queued]);
    expect(responses.every((r: Response) => r.status === 200)).toBe(true);
    expect(calls).toHaveLength(17);
  });

  it("returns 503 when the queued job misses its deadline and allows a fresh submission", async () => {
    vi.useFakeTimers();
    const provider = heldProvider();
    const options = { apiKey: "k", cacheDir, fetchFn: provider.fetchFn, clientIp: "9.9.9.9" };
    const first = call({ speakerId: "tata", text: "aktywne" }, options);
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    const queued = call({ speakerId: "tata", text: "w kolejce" }, options);
    await vi.advanceTimersByTimeAsync(10_500);
    expect((await queued).status).toBe(503);
    expect((await first).status).toBe(503);
    provider.next(audio([2]));
    await vi.advanceTimersByTimeAsync(31_000);
    const fresh = immediateProvider();
    const ok = await call({ speakerId: "tata", text: "w kolejce" }, { apiKey: "k", cacheDir, fetchFn: fresh.fetchFn, clientIp: "9.9.9.9" });
    expect(ok.status).toBe(200);
  });

  it("drops an aborted follower without dropping another", async () => {
    const controller = new AbortController();
    const provider = heldProvider();
    const options = { apiKey: "k", cacheDir, fetchFn: provider.fetchFn, clientIp: "9.9.9.9" };
    const first = handleSpeechTts(new Request("http://x/speech/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ speakerId: "tata", text: "przerwanie" }),
      signal: controller.signal,
    }), options);
    const second = call({ speakerId: "tata", text: "przerwanie" }, options);
    await provider.called;
    controller.abort();
    await expect(first).rejects.toThrow();
    provider.next(audio([4]));
    const res = await second;
    expect(res.status).toBe(200);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([4]);
    expect(provider.calls).toHaveLength(1);
  });

  it("keeps an active job joinable when its last waiter aborts, so a resubmission causes no second provider call", async () => {
    const controller = new AbortController();
    const provider = heldProvider();
    const options = { apiKey: "k", cacheDir, fetchFn: provider.fetchFn, clientIp: "9.9.9.9" };
    const first = handleSpeechTts(new Request("http://x/speech/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ speakerId: "tata", text: "solo" }),
      signal: controller.signal,
    }), options);
    await provider.called;
    controller.abort();
    await expect(first).rejects.toThrow();
    const resubmission = call({ speakerId: "tata", text: "solo" }, options);
    provider.next(audio([8]));
    expect((await resubmission).status).toBe(200);
    expect(provider.calls).toHaveLength(1);
  });

  it("rejects oversized bodies with 413 including chunked streams", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ speakerId: "tata", text: "x" }) + "y".repeat(5000)));
        controller.close();
      },
    });
    const res = await handleSpeechTts(new Request("http://x/speech/tts", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit), { apiKey: "k", cacheDir });
    expect(res.status).toBe(413);
    expect((await call({ speakerId: "tata", text: "y".repeat(5000) }, { apiKey: "k", cacheDir })).status).toBe(413);
  });

  it("ignores spoofed forwarding headers and budgets the real peer", async () => {
    const provider = immediateProvider();
    const options = { apiKey: "k", cacheDir, fetchFn: provider.fetchFn, clientIp: "9.9.9.9" };
    for (let i = 0; i < 30; i++) {
      const res = await handleSpeechTts(new Request("http://x/speech/tts", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "8.8.8.8" },
        body: JSON.stringify({ speakerId: "tata", text: `fałszywy ${i}` }),
      }), options);
      expect(res.status).toBe(200);
    }
    const res = await handleSpeechTts(new Request("http://x/speech/tts", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "8.8.8.8" },
      body: JSON.stringify({ speakerId: "tata", text: "fałszywy limit" }),
    }), options);
    expect(res.status).toBe(429);
    expect(provider.calls).toHaveLength(30);
  });

  it("retries a retryable 429 once the short delay passes and then succeeds", async () => {
    vi.useFakeTimers();
    const { calls, fetchFn } = scriptedProvider([
      new Response(JSON.stringify({ detail: { status: "rate_limit_exceeded" } }), { status: 429 }),
      audio([6]),
    ]);
    const pending = call({ speakerId: "tata", text: "pauza" }, { apiKey: "k", cacheDir, fetchFn, clientIp: "9.9.9.9" });
    await vi.advanceTimersByTimeAsync(300);
    const res = await pending;
    expect(res.status).toBe(200);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([6]);
    expect(calls).toHaveLength(2);
  });

  it("answers 429 immediately when Retry-After exceeds the remaining deadline", async () => {
    vi.useFakeTimers();
    const { calls, fetchFn } = scriptedProvider([
      new Response(JSON.stringify({ detail: { status: "rate_limit_exceeded" } }), { status: 429, headers: { "retry-after": "9999" } }),
    ]);
    const res = await call({ speakerId: "tata", text: "dluga pauza" }, { apiKey: "k", cacheDir, fetchFn, clientIp: "9.9.9.9" });
    expect(res.status).toBe(429);
    expect(calls).toHaveLength(1);
  });

  it("does not retry quota_exceeded or 5xx or auth failures", async () => {
    const quota = scriptedProvider([new Response(JSON.stringify({ detail: { status: "quota_exceeded" } }), { status: 429 })]);
    expect((await call({ speakerId: "tata", text: "quota" }, { apiKey: "k", cacheDir, fetchFn: quota.fetchFn, clientIp: "9.9.9.9" })).status).toBe(429);
    expect(quota.calls).toHaveLength(1);

    const serverError = scriptedProvider([new Response("boom", { status: 500 })]);
    expect((await call({ speakerId: "tata", text: "blad serwera" }, { apiKey: "k", cacheDir, fetchFn: serverError.fetchFn, clientIp: "9.9.9.9" })).status).toBe(502);
    expect(serverError.calls).toHaveLength(1);

    const unauthorized = scriptedProvider([new Response("no", { status: 401 })]);
    expect((await call({ speakerId: "tata", text: "brak autoryzacji" }, { apiKey: "k", cacheDir, fetchFn: unauthorized.fetchFn, clientIp: "9.9.9.9" })).status).toBe(502);
    expect(unauthorized.calls).toHaveLength(1);
  });

  it("rejects the key for 30 seconds after a network failure and recovers afterwards", async () => {
    vi.useFakeTimers();
    let fail = true;
    const calls: string[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      calls.push(String(url));
      if (fail) throw new Error("network down");
      return audio([3]);
    }) as unknown as typeof fetch;
    const options = { apiKey: "k", cacheDir, fetchFn, clientIp: "9.9.9.9" };
    expect((await call({ speakerId: "tata", text: "sieć" }, options)).status).toBe(502);
    expect(calls).toHaveLength(1);
    expect((await call({ speakerId: "tata", text: "sieć" }, options)).status).toBe(502);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_500);
    fail = false;
    const res = await call({ speakerId: "tata", text: "sieć" }, options);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("times out an active provider request, cools the key down, and recovers", async () => {
    vi.useFakeTimers();
    let hang = true;
    const calls: { url: string; signal: AbortSignal | null }[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      const signal = init?.signal ?? null;
      calls.push({ url: String(url), signal });
      if (hang) {
        await new Promise<void>((_, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("provider timeout")), { once: true });
        });
      }
      return audio([11]);
    }) as unknown as typeof fetch;
    const options = { apiKey: "k", cacheDir, fetchFn, clientIp: "9.9.9.9" };
    const pending = call({ speakerId: "tata", text: "zwis" }, options);
    await vi.advanceTimersByTimeAsync(10_500);
    expect((await pending).status).toBe(503);
    expect((await call({ speakerId: "tata", text: "zwis" }, options)).status).toBe(502);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(31_000);
    hang = false;
    const res = await call({ speakerId: "tata", text: "zwis" }, options);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("serves a cache hit without an API key and treats an empty disk file as a miss", async () => {
    const first = immediateProvider([new Uint8Array([1, 2, 3])]);
    const ok = await call({ speakerId: "buddy", text: "postsynthesis" }, { apiKey: "", cacheDir, fetchFn: first.fetchFn, clientIp: "9.9.9.9" });
    expect(ok.status).toBe(503);
    expect(first.calls).toHaveLength(0);

    const provider = immediateProvider([new Uint8Array([1, 2, 3])]);
    await call({ speakerId: "buddy", text: "hej" }, { apiKey: "k", cacheDir, fetchFn: provider.fetchFn, clientIp: "9.9.9.9" });
    resetSpeechTtsState();
    const cached = await call({ speakerId: "buddy", text: "hej" }, { apiKey: "", cacheDir, fetchFn: provider.fetchFn, clientIp: "9.9.9.9" });
    expect(cached.status).toBe(200);
    expect([...new Uint8Array(await cached.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(provider.calls).toHaveLength(1);

    const emptyProvider = immediateProvider([new Uint8Array([])]);
    const empty = await call({ speakerId: "buddy", text: "pusty" }, { apiKey: "k", cacheDir, fetchFn: emptyProvider.fetchFn, clientIp: "9.9.9.9" });
    expect(empty.status).toBe(502);
    const again = await call({ speakerId: "buddy", text: "pusty" }, { apiKey: "k", cacheDir, fetchFn: emptyProvider.fetchFn, clientIp: "9.9.9.9" });
    expect(again.status).toBe(502);
    expect(emptyProvider.calls).toHaveLength(1);
  });

  it("evicts memory entries beyond 128 without reusing disk", async () => {
    vi.useFakeTimers();
    const readOnly = mkdtempSync(join(tmpdir(), "giera-speech-ro-"));
    writeFileSync(join(readOnly, "blocker"), "");
    const blockedDir = join(readOnly, "blocker");
    const provider = immediateProvider();
    const options = { apiKey: "k", cacheDir: blockedDir, fetchFn: provider.fetchFn };
    const keyText = (i: number) => ({ speakerId: "tata", text: `ewiction-${i}` });
    for (let i = 0; i < 60; i++) await call(keyText(i), options);
    await vi.advanceTimersByTimeAsync(61_000);
    for (let i = 60; i < 120; i++) await call(keyText(i), options);
    await vi.advanceTimersByTimeAsync(61_000);
    for (let i = 120; i < 129; i++) await call(keyText(i), options);
    const before = provider.calls.length;
    const res = await call(keyText(0), options);
    expect(res.status).toBe(200);
    expect(provider.calls.length).toBe(before + 1);
    rmSync(readOnly, { recursive: true, force: true });
  });

  it("bounds the disk cache to the configured size and never touches foreign files or symlinks", () => {
    const blockA = Buffer.alloc(30 * 1024 * 1024, 1);
    const blockB = Buffer.alloc(30 * 1024 * 1024, 2);
    const blockC = Buffer.alloc(10 * 1024 * 1024, 3);
    writeFileSync(join(cacheDir, "a".repeat(40) + ".mp3"), blockA);
    writeFileSync(join(cacheDir, "b".repeat(40) + ".mp3"), blockB);
    writeFileSync(join(cacheDir, "c".repeat(40) + ".mp3"), blockC);
    writeFileSync(join(cacheDir, "notes.txt"), "keep");
    mkdirSync(join(cacheDir, "0".repeat(40) + ".mp3"));
    const outside = join(mkdtempSync(join(tmpdir(), "giera-speech-out-")), "target.mp3");
    writeFileSync(outside, "target");
    symlinkSync(outside, join(cacheDir, "d".repeat(40) + ".mp3"));

    enforceSpeechTtsDiskBound(cacheDir, 64 * 1024 * 1024);

    const remaining = readdirSync(cacheDir);
    expect(remaining).toContain("notes.txt");
    expect(remaining).toContain("0".repeat(40) + ".mp3");
    expect(statSync(join(cacheDir, "b".repeat(40) + ".mp3")).size).toBe(30 * 1024 * 1024);
    expect(statSync(join(cacheDir, "c".repeat(40) + ".mp3")).size).toBe(10 * 1024 * 1024);
    expect(remaining).not.toContain("a".repeat(40) + ".mp3");
    expect(statSync(outside).size).toBe(6);
    unlinkSync(outside);
    rmSync(join(tmpdir(), "giera-speech-out-"), { recursive: true, force: true });
  });

  it("maps buddy and keeps existing speakers on their current voices", async () => {
    const provider = immediateProvider();
    const options = { apiKey: "k", cacheDir, fetchFn: provider.fetchFn, clientIp: "9.9.9.9" };
    await call({ speakerId: "buddy", text: "jestem" }, options);
    await call({ speakerId: "tata", text: "jestem" }, options);
    expect(provider.calls[0].url).toContain(`/v1/text-to-speech/${SPEECH_VOICES.buddy}`);
    expect(provider.calls[1].url).toContain(`/v1/text-to-speech/${SPEECH_VOICES.tata}`);
  });
});
