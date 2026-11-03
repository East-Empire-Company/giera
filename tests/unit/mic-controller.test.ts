import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireMicOwnership,
  createMicController,
  releaseMicOwnership,
} from "../../src/client/input/mic";

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(readonly stream: MediaStream) {
    FakeRecorder.instances.push(this);
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }) } as BlobEvent);
    this.onstop?.();
  }
}

type FakeTrack = { stopped: boolean; stop: () => void };

const makeStream = () => {
  const track: FakeTrack = { stopped: false, stop() { this.stopped = true; } };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
};

const installRecorder = () => vi.stubGlobal("MediaRecorder", FakeRecorder);
const jsonFetch = async () => new Response(JSON.stringify({ text: "Cześć" }), { status: 200 });

beforeEach(() => {
  FakeRecorder.instances = [];
  installRecorder();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("MicController ownership", () => {
  it.each([
    ["buddy", "concierge"],
    ["concierge", "buddy"],
  ])("grants exclusive ownership in %s then %s order", async (firstPurpose, secondPurpose) => {
    const first = await acquireMicOwnership(firstPurpose);
    expect(first).not.toBeNull();
    expect(await acquireMicOwnership(secondPurpose)).toBeNull();
    releaseMicOwnership(first);
    const second = await acquireMicOwnership(secondPurpose);
    expect(second).not.toBeNull();
    releaseMicOwnership(second);
  });
});

describe("createMicController", () => {
  it("drops an ownership request cancelled before it resolves", async () => {
    const mic = createMicController({ onTranscript: () => {}, onError: () => {} });
    const acquisition = mic.acquireOwnership("buddy");
    mic.cancel();
    const acquired = await acquisition;
    mic.releaseOwnership();
    expect(acquired).toBe(false);
    const nextOwner = await acquireMicOwnership("concierge");
    expect(nextOwner).not.toBeNull();
    releaseMicOwnership(nextOwner);
    mic.dispose();
  });

  it("releases ownership before a pending permission prompt resolves", async () => {
    let resolvePermission!: (stream: MediaStream) => void;
    const pendingPermission = new Promise<MediaStream>((resolve) => { resolvePermission = resolve; });
    const { stream, track } = makeStream();
    let permissionRequested = false;
    const mic = createMicController({
      getUserMedia: () => {
        permissionRequested = true;
        return pendingPermission;
      },
      fetchFn: jsonFetch,
      onTranscript: () => {},
      onError: () => {},
    });

    const beginning = mic.begin();
    await vi.waitFor(() => expect(permissionRequested).toBe(true));
    mic.cancel();
    expect(await mic.acquireOwnership("concierge")).toBe(true);
    resolvePermission(stream);
    expect(await beginning).toBeNull();
    expect(track.stopped).toBe(true);
    mic.releaseOwnership();
    mic.dispose();
  });

  it("rejects an overlapping gesture with a visible busy error", async () => {
    const { stream } = makeStream();
    const errors: { code: string; id: number }[] = [];
    const mic = createMicController({
      getUserMedia: async () => stream,
      fetchFn: jsonFetch,
      onTranscript: () => {},
      onError: (code, id) => errors.push({ code, id }),
    });

    expect(await mic.begin()).toBe(1);
    expect(await mic.begin()).toBeNull();
    expect(errors).toEqual([{ code: "busy", id: 2 }]);
    mic.cancel();
    mic.dispose();
  });

  it("delivers one final transcript after release", async () => {
    const { stream, track } = makeStream();
    const transcripts: { text: string; id: number }[] = [];
    const posted: { request?: { url: string; form: FormData } } = {};
    const mic = createMicController({
      getUserMedia: async () => stream,
      fetchFn: async (input, init) => {
        posted.request = { url: String(input), form: init?.body as FormData };
        return jsonFetch();
      },
      onTranscript: (text, id) => transcripts.push({ text, id }),
      onError: () => {},
    });

    expect(await mic.begin()).toBe(1);
    mic.end();
    await vi.waitFor(() => expect(transcripts).toEqual([{ text: "Cześć", id: 1 }]));
    expect(track.stopped).toBe(true);
    expect(FakeRecorder.instances).toHaveLength(1);
    expect(posted.request?.url).toBe("/npc/stt");
    expect(posted.request?.form.has("file")).toBe(true);
    expect(posted.request?.form.get("file")).toBeInstanceOf(Blob);
    expect((posted.request?.form.get("file") as Blob).size).toBe(3);
    mic.dispose();
  });
  it("discards an earlier response after a newer gesture begins", async () => {
    const streams = [makeStream(), makeStream()];
    let permissionCount = 0;
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    let fetchCount = 0;
    let firstFetchStarted = false;
    const transcripts: { text: string; id: number }[] = [];
    const mic = createMicController({
      getUserMedia: async () => streams[permissionCount++].stream,
      fetchFn: () => {
        fetchCount++;
        if (fetchCount === 1) {
          firstFetchStarted = true;
          return firstResponse;
        }
        return jsonFetch();
      },
      onTranscript: (text, id) => transcripts.push({ text, id }),
      onError: () => {},
    });

    expect(await mic.begin()).toBe(1);
    mic.end();
    await vi.waitFor(() => expect(firstFetchStarted).toBe(true));
    expect(await mic.begin()).toBe(2);
    resolveFirst(new Response(JSON.stringify({ text: "late" }), { status: 200 }));
    mic.end();
    await vi.waitFor(() => expect(transcripts).toEqual([{ text: "Cześć", id: 2 }]));
    expect(streams[0].track.stopped).toBe(true);
    expect(streams[1].track.stopped).toBe(true);
    mic.dispose();
  });


  it("discards an outstanding transcript after cancellation", async () => {
    const { stream } = makeStream();
    let resolveFetch!: (response: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    const transcripts: string[] = [];
    let fetchStarted = false;
    const mic = createMicController({
      getUserMedia: async () => stream,
      fetchFn: () => {
        fetchStarted = true;
        return pendingFetch;
      },
      onTranscript: (text) => transcripts.push(text),
      onError: () => {},
    });

    expect(await mic.begin()).toBe(1);
    mic.end();
    await vi.waitFor(() => expect(fetchStarted).toBe(true));
    mic.cancel();
    resolveFetch(new Response(JSON.stringify({ text: "late" }), { status: 200 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(transcripts).toEqual([]);
    mic.dispose();
  });

  it("stops capture at the 10-second gesture cap", async () => {
    vi.useFakeTimers();
    const { stream, track } = makeStream();
    const mic = createMicController({
      getUserMedia: async () => stream,
      fetchFn: jsonFetch,
      maxSegmentMs: 20_000,
      onTranscript: () => {},
      onError: () => {},
    });

    expect(await mic.begin()).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(track.stopped).toBe(true);
    mic.dispose();
  });
});
