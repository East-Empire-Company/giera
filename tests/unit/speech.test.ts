import { describe, expect, it } from "vitest";
import { SpeechService, type SpeechDeps, type SpeechResult } from "../../src/client/audio/speech";

type PlayedEntry = { buffer: { duration: number }; volume: number; rate: number; complete: () => void };
type SpokenEntry = { text: string; volume: number; complete: () => void };

type Harness = {
  service: SpeechService;
  played: PlayedEntry[];
  spoken: SpokenEntry[];
  fetches: { url: string; init: RequestInit }[];
  decode: { fail: boolean };
  speechVolume: { value: number };
  contextState: { value: "running" | "suspended" };
  browserVoice: { present: boolean };
  respondNext: (make: () => Response | Error) => Promise<void>;
  events: { type: string; detail: Record<string, unknown> }[];
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};

const buildService = (): Harness => {
  const played: PlayedEntry[] = [];
  const spoken: SpokenEntry[] = [];
  const fetches: { url: string; init: RequestInit }[] = [];
  const resolvers: { promise: Promise<Response>; resolve: (value: Response) => void; reject: (reason: unknown) => void }[] = [];
  const decode = { fail: false };
  const speechVolume = { value: 1 };
  const contextState = { value: "running" as "running" | "suspended" };
  const browserVoice = { present: false };
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    fetches.push({ url: String(url), init: init ?? {} });
    const { promise, resolve, reject } = Promise.withResolvers<Response>();
    resolvers.push({ promise, resolve, reject });
    return promise;
  }) as unknown as typeof fetch;
  const deps: SpeechDeps = {
    getSpeechVolume: () => speechVolume.value,
    getContext: () => ({ state: contextState.value }) as AudioContext,
    hasBrowserVoice: () => browserVoice.present,
    decode: async () => {
      if (decode.fail) throw new Error("corrupt");
      return { duration: 2 } as AudioBuffer;
    },
    loadBuffer: async (clipId) => (clipId === "missing_clip" ? null : ({ duration: 1.5 } as AudioBuffer)),
    playBuffer: (buffer, options) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      played.push({ buffer: buffer as { duration: number }, volume: options.volume, rate: options.rate, complete: resolve });
      return promise;
    },
    speakWithBrowserVoice: (text, volume) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      spoken.push({ text, volume, complete: resolve });
      return promise;
    },
    fetchFn,
  };
  const service = new SpeechService(deps);
  const events: { type: string; detail: Record<string, unknown> }[] = [];
  for (const type of ["speech:request", "speech:ready", "speech:failed", "speech:ended"]) {
    service.addEventListener(type, (event: Event) => {
      events.push({ type, detail: (event as CustomEvent).detail as Record<string, unknown> });
    });
  }
  return {
    service,
    played,
    spoken,
    fetches,
    decode,
    speechVolume,
    contextState,
    browserVoice,
    events,
    respondNext: async (make) => {
      await flush();
      const pending = resolvers.shift();
      if (!pending) throw new Error("no pending fetch");
      const made = make();
      if (made instanceof Error) pending.reject(made);
      else pending.resolve(made);
      await flush();
    },
  };
};

const text = (t: string, volume = 1) => ({ kind: "text", speakerId: "tata", text: t, volume } as const);
const clip = (clipId: string, volume = 1) => ({ kind: "clip", speakerId: "game", clipId, volume, rate: 1 } as const);
const audioResponse = (bytes: number[], status = 200) => new Response(new Uint8Array(bytes), { status });

describe("SpeechService", () => {
  it("correlates request and ready events and resolves done with the same result", async () => {
    const h = buildService();
    const pending = h.service.request(text("Cześć"));
    const requestEvent = h.events.find((e) => e.type === "speech:request");
    expect(requestEvent?.detail.id).toBe(pending.id);
    expect(requestEvent?.detail.request).toMatchObject({ kind: "text", text: "Cześć" });

    await h.respondNext(() => audioResponse([1, 2, 3]));
    h.played[0].complete();
    await flush();

    const ready = h.events.find((e) => e.type === "speech:ready");
    expect(ready?.detail.id).toBe(pending.id);
    const result = ready?.detail.result as SpeechResult;
    expect(result).toMatchObject({ backend: "elevenlabs" });
    const done = await pending.done;
    expect(done).toBe(result);
    expect(h.fetches[0].url).toBe("/speech/tts");
    expect(JSON.parse(String(h.fetches[0].init.body))).toEqual({ speakerId: "tata", text: "Cześć" });
    expect(h.played[0].volume).toBe(1);
  });

  it("falls back to the Polish browser voice on endpoint failure and reports unavailable without Web Speech", async () => {
    const h = buildService();
    h.browserVoice.present = true;
    const fallback = h.service.request(text("Zabawa!"));
    await h.respondNext(() => new Response("no", { status: 503 }));
    await flush();
    expect(h.spoken).toHaveLength(1);
    h.spoken[0].complete();
    await flush();
    const done = await fallback.done;
    expect(done).toMatchObject({ backend: "browser", text: "Zabawa!" });

    const h2 = buildService();
    const unavailable = h2.service.request(text("Cokolwiek"));
    await h2.respondNext(() => new Response("no", { status: 503 }));
    await flush();
    const failed = await unavailable.done;
    expect(failed).toMatchObject({ reason: "unavailable" });
    expect(h2.events.some((e) => e.type === "speech:failed")).toBe(true);
  });

  it("falls back to the browser voice on corrupt audio", async () => {
    const h = buildService();
    h.decode.fail = true;
    h.browserVoice.present = true;
    const pending = h.service.request(text("Brudzi"));
    await h.respondNext(() => audioResponse([1]));
    await flush();
    h.spoken[0].complete();
    const done = await pending.done;
    expect(done).toMatchObject({ backend: "browser", text: "Brudzi" });
    expect(h.played).toHaveLength(0);
  });

  it("serializes playback in request order even when fetches finish out of order", async () => {
    const h = buildService();
    h.browserVoice.present = true;
    const first = h.service.request(text("Pierwsza"));
    const second = h.service.request(text("Druga"));
    expect(second.id).toBe(first.id + 1);

    await h.respondNext(() => new Response("no", { status: 503 }));
    await flush();
    h.spoken[0].complete();
    await flush();
    expect(h.spoken).toHaveLength(1);

    await h.respondNext(() => audioResponse([1]));
    await flush();
    expect(h.played).toHaveLength(1);
    h.played[0].complete();
    await flush();
    expect((await first.done)).toMatchObject({ backend: "browser" });
    expect((await second.done)).toMatchObject({ backend: "elevenlabs" });
    expect(h.spoken.map((s) => s.text)).toEqual(["Pierwsza"]);
  });

  it("cancels pending requests when the page hides and never plays late results", async () => {
    const h = buildService();
    const pending = h.service.request(text("W locie"));
    await flush();
    h.service.cancelPending();
    await flush();
    const done = await pending.done;
    expect(done).toMatchObject({ reason: "cancelled" });
    await h.respondNext(() => audioResponse([1]));
    await flush();
    expect(h.played).toHaveLength(0);
    expect(h.events.filter((e) => e.type === "speech:ready")).toHaveLength(0);
    expect(h.events.filter((e) => e.type === "speech:failed")).toHaveLength(1);
  });

  it("suppresses text and clip requests for hidden, muted, quiet, or locked contexts", async () => {
    const h = buildService();
    h.speechVolume.value = 0.04;
    const muted = h.service.request(text("Cicho"));
    expect((await muted.done)).toMatchObject({ reason: "suppressed" });
    const clipMuted = h.service.request(clip("celebrate_win"));
    expect((await clipMuted.done)).toMatchObject({ reason: "suppressed" });
    expect(h.fetches).toHaveLength(0);

    const h2 = buildService();
    h2.contextState.value = "suspended";
    const locked = h2.service.request(text("Zamknięte"));
    expect((await locked.done)).toMatchObject({ reason: "suppressed" });

    const h3 = buildService();
    const quietVolume = h3.service.request(text("Cicho", 0.02));
    expect((await quietVolume.done)).toMatchObject({ reason: "suppressed" });
    expect(h3.fetches).toHaveLength(0);
  });

  it("plays bundled clips in order and routes them through speech mute", async () => {
    const h = buildService();
    const first = h.service.request(clip("celebrate_win", 0.8));
    const second = h.service.request(clip("celebrate_collect", 0.4));
    await flush();
    expect(h.played).toHaveLength(1);
    expect(h.played[0].buffer).toMatchObject({ duration: 1.5 });
    expect(h.played[0].volume).toBe(0.8);
    h.played[0].complete();
    await flush();
    expect(h.played).toHaveLength(2);
    expect(h.played[1].volume).toBe(0.4);
    h.played[1].complete();
    expect((await first.done)).toMatchObject({ backend: "asset" });
    expect((await second.done)).toMatchObject({ backend: "asset" });

    const muted = buildService();
    muted.speechVolume.value = 0.02;
    const clipPending = muted.service.request(clip("celebrate_win"));
    expect((await clipPending.done)).toMatchObject({ reason: "suppressed" });
    expect(muted.played).toHaveLength(0);
  });

  it("fails a clip when its buffer is missing", async () => {
    const h = buildService();
    const pending = h.service.request(clip("missing_clip"));
    const done = await pending.done;
    expect(done).toMatchObject({ reason: "unavailable" });
    expect(h.played).toHaveLength(0);
  });

  it("marks a stream ready once, ignores duplicate callbacks, and ends it", async () => {
    const h = buildService();
    const stream = h.service.request({ kind: "stream", speakerId: "tata" });
    h.service.streamReady(stream.id);
    h.service.streamReady(stream.id);
    await flush();
    const readyEvents = h.events.filter((e) => e.type === "speech:ready");
    expect(readyEvents).toHaveLength(1);
    expect(readyEvents[0].detail.result).toMatchObject({ backend: "agent-stream" });
    expect(await stream.done).toMatchObject({ backend: "agent-stream" });

    h.service.endStream(stream.id, false);
    h.service.endStream(stream.id, false);
    await flush();
    const ended = h.events.filter((e) => e.type === "speech:ended");
    expect(ended).toHaveLength(1);
    expect(ended[0].detail).toMatchObject({ id: stream.id, failed: false });
  });

  it("fails a stream that closes before it was ready", async () => {
    const h = buildService();
    const clean = h.service.request({ kind: "stream", speakerId: "tata" });
    h.service.endStream(clean.id, false);
    const failed = await clean.done;
    expect(failed).toMatchObject({ reason: "cancelled" });

    const h2 = buildService();
    const errored = h2.service.request({ kind: "stream", speakerId: "tata" });
    h2.service.endStream(errored.id, true);
    expect(await errored.done).toMatchObject({ reason: "unavailable" });
    expect(h2.events.some((e) => e.type === "speech:failed")).toBe(true);
  });

  it("ignores callbacks for unknown ids and cancel only affects the named request", async () => {
    const h = buildService();
    h.service.streamReady(999);
    h.service.endStream(999, false);
    const first = h.service.request(text("Znosi"));
    const second = h.service.request(text("Zostaje"));
    h.service.cancel(first.id);
    expect(await first.done).toMatchObject({ reason: "cancelled" });
    await h.respondNext(() => audioResponse([1]));
    await flush();
    h.played[0].complete();
    expect((await second.done)).toMatchObject({ backend: "elevenlabs" });
    expect(h.played[0].buffer).toMatchObject({ duration: 2 });
  });

  it("never plays a decoded buffer that arrives after the page hid", async () => {
    const h = buildService();
    const pending = h.service.request(text("Za późno"));
    await flush();
    h.service.cancelPending();
    await h.respondNext(() => audioResponse([1]));
    await flush();
    expect((await pending.done)).toMatchObject({ reason: "cancelled" });
    expect(h.played).toHaveLength(0);
  });
});
