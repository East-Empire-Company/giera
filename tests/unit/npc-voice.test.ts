import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioManager } from "../../src/client/audio/sound";

type FakeGain = {
  gain: { value: number; ramps: [number, number][]; cancelScheduledValues: () => void; setValueAtTime: (v: number, t: number) => void; linearRampToValueAtTime: (v: number, t: number) => void };
  connect: (target: unknown) => unknown;
};
type FakeSource = { buffer?: { duration: number }; loop: boolean; starts: number[]; connect: (t: unknown) => unknown; start: (t?: number) => void; stop: () => void; onended: (() => void) | null; playbackRate: { value: number } };

let gains: FakeGain[];
let sources: FakeSource[];
let ttsCalls: number;
let ttsOk: boolean;

class FakeAudioContext {
  state: "running" | "suspended" = "running";
  currentTime = 10;
  destination = {};
  createGain(): FakeGain {
    const gain: FakeGain = {
      gain: {
        value: 1,
        ramps: [],
        cancelScheduledValues() {},
        setValueAtTime(v) { gain.gain.value = v; },
        linearRampToValueAtTime(v, t) { gain.gain.ramps.push([v, t]); },
      },
      connect: (target) => target,
    };
    gains.push(gain);
    return gain;
  }
  createBufferSource(): FakeSource {
    const source: FakeSource = { loop: false, starts: [], connect: (t) => t, start: (t = 0) => void source.starts.push(t), stop() {}, onended: null, playbackRate: { value: 1 } };
    sources.push(source);
    return source;
  }
  async decodeAudioData(): Promise<{ duration: number }> {
    return { duration: 2 };
  }
  async resume(): Promise<void> {}
  async suspend(): Promise<void> {}
}

beforeEach(() => {
  gains = [];
  sources = [];
  ttsCalls = 0;
  ttsOk = true;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("document", { hidden: false, addEventListener: () => {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/npc/tts") {
        ttsCalls++;
        return ttsOk ? new Response(new Uint8Array([1])) : new Response("x", { status: 502 });
      }
      if (String(url).includes("manifest.json")) return new Response(JSON.stringify({ entries: {} }));
      return new Response(new Uint8Array([1, 2]));
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

async function readyManager(): Promise<AudioManager> {
  const manager = new AudioManager();
  await manager.playMusic("sigma_protocol");
  return manager;
}

describe("AudioManager.speak", () => {
  it("plays the synthesized line at the distance-scaled volume and ducks the music under it", async () => {
    const manager = await readyManager();
    await manager.speak("mina", "Cześć!", 0.6);
    const voice = sources.find((s) => !s.loop)!;
    expect(voice.starts).toEqual([10]);
    const voiceGain = gains[gains.length - 1];
    expect(voiceGain.gain.value).toBeCloseTo(0.6);
    const musicGain = gains.find((g) => g.gain.ramps.some(([v]) => v === 0.3));
    expect(musicGain).toBeDefined();
  });

  it("queues overlapping lines instead of talking over each other", async () => {
    const manager = await readyManager();
    await manager.speak("mina", "Pierwsza linia", 1);
    await manager.speak("staszek", "Druga linia", 1);
    const [first, second] = sources.filter((s) => !s.loop);
    expect(second.starts[0]).toBeGreaterThanOrEqual(first.starts[0] + 2);
  });

  it("does not request audio for NPCs that are too far away", async () => {
    const manager = await readyManager();
    await manager.speak("mina", "Za daleko", 0.02);
    expect(ttsCalls).toBe(0);
  });

  it("falls back to the browser voice in Polish when synthesis fails", async () => {
    ttsOk = false;
    const spoken: { text: string; lang: string }[] = [];
    vi.stubGlobal("SpeechSynthesisUtterance", class { lang = ""; volume = 1; voice: unknown = null; constructor(public text: string) {} });
    vi.stubGlobal("speechSynthesis", { getVoices: () => [], speak: (u: { text: string; lang: string }) => spoken.push({ text: u.text, lang: u.lang }) });
    const manager = await readyManager();
    await manager.speak("papuga", "Zabawa!", 1);
    expect(spoken).toEqual([{ text: "Zabawa!", lang: "pl-PL" }]);
  });

  it("stays silent until the audio context has been allowed to run", async () => {
    const manager = new AudioManager();
    await manager.speak("mina", "Hej", 1);
    expect(ttsCalls).toBe(0);
  });
});

describe("AudioManager.playMusic", () => {
  it("starts a track only once when requested repeatedly while loading", async () => {
    const manager = new AudioManager();
    await Promise.all([manager.playMusic("sigma_protocol"), manager.playMusic("sigma_protocol")]);
    expect(sources.filter((s) => s.loop)).toHaveLength(1);
  });

  it("lets the latest requested track win over an earlier one still loading", async () => {
    const manager = new AudioManager();
    await Promise.all([manager.playMusic("sigma_protocol"), manager.playMusic("drift_phonk")]);
    const started = sources.filter((s) => s.loop);
    expect(started).toHaveLength(1);
  });
});
