import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioManager } from "../../src/client/audio/sound";

type FakeGain = {
  gain: { value: number; ramps: [number, number][]; targets: [number, number, number][]; cancelScheduledValues: () => void; setValueAtTime: (v: number, t: number) => void; linearRampToValueAtTime: (v: number, t: number) => void; setTargetAtTime: (v: number, t: number, c: number) => void };
  connect: (target: unknown) => unknown;
};
type FakeSource = { buffer?: { duration: number }; loop: boolean; starts: number[]; stopped: boolean; connect: (t: unknown) => unknown; start: (t?: number) => void; stop: () => void; onended: (() => void) | null; playbackRate: { value: number } };

let gains: FakeGain[];
let sources: FakeSource[];
let ttsCalls: number;
let ttsOk: boolean;
let documentHidden: boolean;
let visibilityChange: (() => void) | undefined;



class FakeAudioContext {
  state: "running" | "suspended" = "running";
  currentTime = 10;
  destination = {};
  createGain(): FakeGain {
    const gain: FakeGain = {
      gain: {
        value: 1,
        ramps: [],
        targets: [],
        cancelScheduledValues() {},
        setValueAtTime(v) { gain.gain.value = v; },
        linearRampToValueAtTime(v, t) { gain.gain.value = v; gain.gain.ramps.push([v, t]); },
        setTargetAtTime(v, t, c) { gain.gain.value = v; gain.gain.targets.push([v, t, c]); },
      },
      connect: (target) => target,
    };
    gains.push(gain);
    return gain;
  }
  createBufferSource(): FakeSource {
    const source: FakeSource = { loop: false, starts: [], stopped: false, connect: (t) => t, start: (t = 0) => void source.starts.push(t), stop() { source.stopped = true; }, onended: null, playbackRate: { value: 1 } };
    sources.push(source);
    return source;
  }
  async decodeAudioData(): Promise<{ duration: number }> {
    return { duration: 2 };
  }
  async resume(): Promise<void> {
    this.state = "running";
  }
  async suspend(): Promise<void> {
    this.state = "suspended";
  }
}

beforeEach(() => {
  gains = [];
  sources = [];
  ttsCalls = 0;
  ttsOk = true;
  documentHidden = false;
  visibilityChange = undefined;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("document", {
    get hidden() { return documentHidden; },
    addEventListener: (type: string, listener: () => void) => {
      if (type === "visibilitychange") visibilityChange = listener;
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/npc/tts") {
        ttsCalls++;
        return ttsOk ? new Response(new Uint8Array([1])) : new Response("x", { status: 502 });
      }
      if (String(url).includes("manifest.json")) return new Response(JSON.stringify({ entries: { ui_click: { path: "assets/audio/generated/ui_click.mp3" } } }));
      return new Response(new Uint8Array([1, 2]));
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

async function readyManager(): Promise<AudioManager> {
  const manager = new AudioManager();
  await manager.playPlaylist();
  return manager;
}

describe("AudioManager.speak", () => {
  it("plays the synthesized line at the distance-scaled volume and ducks the music under it", async () => {
    const manager = await readyManager();
    await manager.speak("tata", "Cześć!", 0.6);
    const voice = sources[1];
    expect(voice.starts).toEqual([10]);
    const voiceGain = gains[gains.length - 1];
    expect(voiceGain.gain.value).toBeCloseTo(0.6);
    const musicGain = gains.find((g) => g.gain.ramps.some(([v]) => v === 0.075));
    expect(musicGain).toBeDefined();
  });

  it("queues overlapping lines instead of talking over each other", async () => {
    const manager = await readyManager();
    await manager.speak("tata", "Pierwsza linia", 1);
    await manager.speak("mama", "Druga linia", 1);
    const [first, second] = sources.slice(1);
    expect(second.starts[0]).toBeGreaterThanOrEqual(first.starts[0] + 2);
  });

  it("does not request audio for NPCs that are too far away", async () => {
    const manager = await readyManager();
    await manager.speak("tata", "Za daleko", 0.02);
    expect(ttsCalls).toBe(0);
  });

  it("falls back to the browser voice in Polish when synthesis fails", async () => {
    ttsOk = false;
    const spoken: { text: string; lang: string }[] = [];
    vi.stubGlobal("SpeechSynthesisUtterance", class { lang = ""; volume = 1; voice: unknown = null; constructor(public text: string) {} });
    vi.stubGlobal("speechSynthesis", { getVoices: () => [], speak: (u: { text: string; lang: string }) => spoken.push({ text: u.text, lang: u.lang }) });
    const manager = await readyManager();
    await manager.speak("ciocia", "Zabawa!", 1);
    expect(spoken).toEqual([{ text: "Zabawa!", lang: "pl-PL" }]);
  });

  it("stays silent until the audio context has been allowed to run", async () => {
    const manager = new AudioManager();
    await manager.speak("tata", "Hej", 1);
    expect(ttsCalls).toBe(0);
  });
});

describe("AudioManager.playPlaylist", () => {
  it("starts one playlist track when activated concurrently", async () => {
    const manager = new AudioManager();
    await Promise.all([manager.playPlaylist(), manager.playPlaylist()]);
    expect(manager.playingMusic).toBe("sigma_protocol");
    expect(sources).toHaveLength(1);
  });

  it("keeps music and speech volume controls independent", async () => {
    const manager = new AudioManager();
    expect(manager.setMusicVolume(0.35)).toBeCloseTo(0.35);
    expect(manager.setSpeechVolume(0.6)).toBeCloseTo(0.6);
    await manager.playPlaylist();
    await manager.speak("tata", "Cześć!", 1);

    expect(gains[0].gain.value).toBeCloseTo(0.8);
    expect(gains[1].gain.value).toBeCloseTo(0.35);
    expect(gains[2].gain.value).toBeCloseTo(0.6);
  });
  it("keeps background music quieter than foreground sound effects", async () => {
    const manager = await readyManager();
    await manager.play("ui_click");

    const musicGain = gains.find((g) => g.gain.ramps.some(([value]) => value === 0.25));
    const effectsGain = gains[gains.length - 1];
    expect(musicGain?.gain.value).toBeLessThan(effectsGain.gain.value * 0.5);
  });
  it("stops the current track while paused and resumes the same track", async () => {
    const manager = await readyManager();
    const current = sources[0];

    manager.pausePlaylist();

    expect(manager.playingMusic).toBeUndefined();
    expect(current.stopped).toBe(true);
    expect(current.onended).toBeNull();

    await manager.playPlaylist();
    expect(manager.playingMusic).toBe("sigma_protocol");
    expect(sources).toHaveLength(2);
  });



  it("advances through the music order and wraps after the final track", async () => {
    const manager = new AudioManager();
    await manager.playPlaylist();
    const expected = ["sigma_protocol", "drift_phonk", "combat_phonk", "adventure_island", "little_farm", "sigma_protocol"];

    for (const id of expected.slice(1)) {
      const current = sources[sources.length - 1];
      expect(current.loop).toBe(false);
      current.onended?.();
      await vi.waitFor(() => expect(manager.playingMusic).toBe(id));
    }

    expect(sources).toHaveLength(expected.length);
  });

  it("restarts the current track when visibility returns", async () => {
    const manager = await readyManager();
    documentHidden = true;
    visibilityChange?.();
    documentHidden = false;
    visibilityChange?.();

    await vi.waitFor(() => expect(manager.playingMusic).toBe("sigma_protocol"));
    expect(sources).toHaveLength(2);
  });

  it("restarts the playlist on the first audio unlock after visibility loss", async () => {
    const manager = await readyManager();
    documentHidden = true;
    visibilityChange?.();
    documentHidden = false;
    await manager.play("ui_click");

    await vi.waitFor(() => expect(manager.playingMusic).toBe("sigma_protocol"));
    expect(sources).toHaveLength(3);
  });
});
