import { describe, expect, it } from "vitest";
import { MicController, shouldCutSegment, transcribeAudio } from "../../src/client/audio/mic";

describe("MicController", () => {
  it("initializes in idle state", () => {
    const mic = new MicController({ lang: "pl-PL" });
    expect(mic.isRecording).toBe(false);
    expect(mic.language).toBe("pl-PL");
  });

  it("handles speech callback when speech is recognized", () => {
    let recognizedText = "";
    const mic = new MicController({
      lang: "pl-PL",
      onSpeech: (text) => {
        recognizedText = text;
      },
    });

    mic.handleTranscript("Cześć Mina, daj mi deski!");
    expect(recognizedText).toBe("Cześć Mina, daj mi deski!");
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
    const fetcher = async (url: string, init?: { body?: BodyInit }) => {
      calls.push({ url, body: init?.body as FormData });
      return new Response(JSON.stringify({ text: "  Cześć Mina  " }), { status: 200 });
    };

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const text = await transcribeAudio(blob, "/npc/stt", fetcher);

    expect(text).toBe("Cześć Mina");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/npc/stt");
    expect(calls[0].body.get("file")).toBeInstanceOf(Blob);
  });

  it("throws when the server rejects the clip", async () => {
    const fetcher = async () => new Response("nope", { status: 500 });
    await expect(transcribeAudio(new Blob([new Uint8Array([1])]), "/npc/stt", fetcher)).rejects.toThrow(
      "stt_failed_500",
    );
  });

  it("returns empty text when the server responds without a transcript", async () => {
    const fetcher = async () => new Response(JSON.stringify({}), { status: 200 });
    expect(await transcribeAudio(new Blob([new Uint8Array([1])]), "/npc/stt", fetcher)).toBe("");
  });
});
