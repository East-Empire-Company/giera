// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MicController,
  shouldCutSegment,
  transcribeAudio,
  type SttFetcher,
} from "../../src/client/audio/mic";
import { MIC_ERROR_MESSAGES, classifyMicError } from "../../src/shared/mic-errors";

class FakeMediaRecorder {
  static isTypeSupported = (): boolean => true;
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    readonly stream: MediaStream,
    readonly options?: { mimeType?: string },
  ) {}

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

const level = { loud: false };

class FakeAudioContext {
  createMediaStreamSource(): { connect: () => void } {
    return { connect: () => {} };
  }

  createAnalyser(): { fftSize: number; getByteTimeDomainData: (data: Uint8Array) => void } {
    return {
      fftSize: 512,
      getByteTimeDomainData: (data: Uint8Array) => data.fill(level.loud ? 200 : 128),
    };
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

const globals = globalThis as unknown as { MediaRecorder?: unknown; AudioContext?: unknown };

const installBrowserStubs = (getUserMedia: () => Promise<MediaStream>): void => {
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  globals.MediaRecorder = FakeMediaRecorder;
  globals.AudioContext = FakeAudioContext;
};

describe("classifyMicError", () => {
  it("maps browser capture failures to actionable reasons", () => {
    expect(classifyMicError({ name: "NotAllowedError" })).toBe("denied");
    expect(classifyMicError({ name: "NotFoundError" })).toBe("missing");
    expect(classifyMicError({ name: "NotReadableError" })).toBe("busy");
    expect(classifyMicError({ name: "SecurityError" })).toBe("insecure");
    expect(classifyMicError(new TypeError("mediaDevices missing"))).toBe("unsupported");
    expect(classifyMicError(new Error("boom"))).toBe("unknown");
  });
});

describe("MicController", () => {
  afterEach(() => {
    globals.MediaRecorder = undefined;
    globals.AudioContext = undefined;
    level.loud = false;
  });

  it("initializes in idle state", () => {
    const mic = new MicController({ lang: "pl-PL" });
    expect(mic.isRecording).toBe(false);
    expect(mic.language).toBe("pl-PL");
    expect(mic.lastError).toBeNull();
  });

  it("reports a denied microphone instead of failing silently", async () => {
    installBrowserStubs(() => Promise.reject({ name: "NotAllowedError" }));
    const errors: string[] = [];
    const mic = new MicController({ onError: (message) => errors.push(message) });

    expect(await mic.start()).toBe(false);
    expect(mic.lastError).toBe(MIC_ERROR_MESSAGES.denied);
    expect(mic.lastErrorCode).toBe("denied");
    expect(errors).toEqual([MIC_ERROR_MESSAGES.denied]);
  });

  it("reports an unsupported browser when recording is unavailable", async () => {
    globals.MediaRecorder = undefined;
    const mic = new MicController();

    expect(await mic.start()).toBe(false);
    expect(mic.lastErrorCode).toBe("unsupported");
  });

  it("posts the captured clip to the speech endpoint and reports the transcript", async () => {
    installBrowserStubs(() => Promise.resolve({ getTracks: () => [] } as unknown as MediaStream));
    level.loud = true;
    const posts: { url: string; body: FormData }[] = [];
    const fetcher: SttFetcher = async (url, init) => {
      posts.push({ url, body: init?.body as FormData });
      return new Response(JSON.stringify({ text: "Cześć" }), { status: 200 });
    };
    const transcripts: string[] = [];
    const mic = new MicController({
      endpoint: "/npc/stt",
      fetchFn: fetcher,
      silenceMs: 30,
      minSegmentMs: 10,
      maxSegmentMs: 500,
      levelPollMs: 5,
      onSpeech: (text) => transcripts.push(text),
    });

    expect(await mic.start()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    level.loud = false;

    await vi.waitFor(() => expect(transcripts).toEqual(["Cześć"]), { timeout: 2000 });
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("/npc/stt");
    expect(posts[0].body.has("file")).toBe(true);
    mic.stop();
  });

  it("keeps recording after a segment ends so the next phrase still reaches the NPC", async () => {
    installBrowserStubs(() => Promise.resolve({ getTracks: () => [] } as unknown as MediaStream));
    level.loud = true;
    const transcripts: string[] = [];
    const mic = new MicController({
      fetchFn: async () => new Response(JSON.stringify({ text: "Dawaj deski" }), { status: 200 }),
      silenceMs: 30,
      minSegmentMs: 10,
      maxSegmentMs: 500,
      levelPollMs: 5,
      onSpeech: (text) => transcripts.push(text),
    });

    await mic.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    level.loud = false;
    await vi.waitFor(() => expect(transcripts).toHaveLength(1), { timeout: 2000 });

    level.loud = true;
    await new Promise((resolve) => setTimeout(resolve, 50));
    level.loud = false;
    await vi.waitFor(() => expect(transcripts).toHaveLength(2), { timeout: 2000 });

    expect(mic.isRecording).toBe(true);
    mic.stop();
    expect(mic.isRecording).toBe(false);
  });
});

describe("shouldCutSegment", () => {
  const base = { nowMs: 10_000, lastSoundAtMs: 10_000, segmentStartMs: 9_000, heardSound: true };

  it("keeps the segment open while sound keeps arriving", () => {
    expect(shouldCutSegment(base)).toBe(false);
  });

  it("cuts after silence long enough", () => {
    expect(shouldCutSegment({ ...base, nowMs: 11_500 })).toBe(true);
  });

  it("never cuts a segment that heard no sound", () => {
    expect(shouldCutSegment({ ...base, heardSound: false, nowMs: 20_000 })).toBe(false);
  });

  it("never cuts before the minimum segment length", () => {
    expect(shouldCutSegment({ ...base, segmentStartMs: 11_300, nowMs: 11_500 })).toBe(false);
  });

  it("cuts a long segment even while sound keeps arriving", () => {
    expect(shouldCutSegment({ ...base, nowMs: 25_000, segmentStartMs: 9_000 })).toBe(true);
  });
});

describe("transcribeAudio", () => {
  it("posts the clip as multipart and returns the trimmed transcript", async () => {
    const calls: { url: string; body: FormData }[] = [];
    const fetcher: SttFetcher = async (url, init) => {
      calls.push({ url, body: init?.body as FormData });
      return new Response(JSON.stringify({ text: "  Cześć Mina  " }), { status: 200 });
    };

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const text = await transcribeAudio(blob, "/npc/stt", fetcher);

    expect(text).toBe("Cześć Mina");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/npc/stt");
    expect(calls[0].body.has("file")).toBe(true);
  });

  it("throws when the server rejects the clip", async () => {
    const fetcher: SttFetcher = async () => new Response("nope", { status: 500 });
    await expect(transcribeAudio(new Blob([new Uint8Array([1])]), "/npc/stt", fetcher)).rejects.toThrow(
      "stt_failed_500",
    );
  });

  it("returns empty text when the server responds without a transcript", async () => {
    const fetcher: SttFetcher = async () => new Response(JSON.stringify({}), { status: 200 });
    expect(await transcribeAudio(new Blob([new Uint8Array([1])]), "/npc/stt", fetcher)).toBe("");
  });
});
