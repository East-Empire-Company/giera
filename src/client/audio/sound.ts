export function parseAudioManifest(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || !("entries" in value)) throw new TypeError("Invalid generated audio manifest");
  const entries = value.entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new TypeError("Invalid generated audio entries");
  const paths: Record<string, string> = {};
  for (const [id, entry] of Object.entries(entries)) {
    if (!/^[a-z0-9_]+$/.test(id) || !entry || typeof entry !== "object" || !("path" in entry)) throw new RangeError(`Invalid audio entry: ${id}`);
    const path = entry.path;
    if (typeof path !== "string" || !path.startsWith("assets/audio/generated/") || path.includes("\\") || path.split("/").includes("..")) {
      throw new RangeError(`Audio must use a bundled same-origin path: ${id}`);
    }
    paths[id] = `/${path}`;
  }
  return paths;
}
export const VOICE_PATHS: Record<string, string> = {
  celebrate_win: "/assets/audio/voice/celebrate_win.mp3",
  celebrate_collect: "/assets/audio/voice/celebrate_collect.mp3",
  cinematic_ziemek_ready: "/assets/audio/voice/cinematic_ziemek_ready.mp3",
  cinematic_gniewko_ready: "/assets/audio/voice/cinematic_gniewko_ready.mp3",
  cinematic_ziemek_attack: "/assets/audio/voice/cinematic_ziemek_attack.mp3",
  cinematic_gniewko_help: "/assets/audio/voice/cinematic_gniewko_help.mp3",
};
export const MUSIC_TRACKS: Record<string, string> = {
  drift_phonk: "/assets/audio/music/drift_phonk.mp3",
  combat_phonk: "/assets/audio/music/combat_phonk.mp3",
  sigma_protocol: "/assets/audio/music/sigma_protocol.mp3",
  adventure_island: "/assets/audio/music/adventure_island.mp3",
  little_farm: "/assets/audio/music/little_farm.mp3",
  celebration: "/assets/audio/music/celebration.mp3",
  landing_ambient: "/assets/audio/music/landing_ambient.mp3",
};

export class AudioManager {
  private context?: AudioContext;
  private master?: GainNode;
  private manifest?: Promise<void>;
  private readonly paths: Record<string, string> = {};
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly sources = new Set<AudioBufferSourceNode>();
  private currentMusic?: { id: string; source: AudioBufferSourceNode; gain: GainNode };
  private wantedMusic?: string;
  private voiceBusyUntil = 0;
  private masterVolume = 0.8;

  constructor() {
    Object.assign(this.paths, VOICE_PATHS);
    Object.assign(this.paths, MUSIC_TRACKS);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
          if (this.wantedMusic) void this.playMusic(this.wantedMusic).catch(() => {});
          return;
        }
        for (const source of this.sources) source.stop();
        this.sources.clear();
        this.currentMusic = undefined;
        void this.context?.suspend();
      });
    }
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.masterVolume;
      this.master.connect(this.context.destination);
    }
    return this.context;
  }

  private loadManifest(): Promise<void> {
    if (!this.manifest) {
      this.manifest = fetch("/assets/audio/generated/manifest.json", { cache: "force-cache" })
        .then(async (response) => {
          if (response.ok) Object.assign(this.paths, parseAudioManifest(await response.json()));
        })
        .catch(() => undefined);
    }
    return this.manifest;
  }

  get playingMusic(): string | undefined {
    return this.currentMusic?.id;
  }

  get volume(): number {
    return this.masterVolume;
  }

  setVolume(level: number): number {
    const value = Math.min(1, Math.max(0, Number.isFinite(level) ? level : this.masterVolume));
    this.masterVolume = value;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.05);
    }
    return value;
  }

  async preload(ids: readonly string[]): Promise<void> {
    this.ensureContext();
    await this.loadManifest();
    await Promise.all(ids.map((id) => this.loadBuffer(id)));
  }

  private async unlock(): Promise<AudioContext> {
    const context = this.ensureContext();
    if (context.state === "suspended") await context.resume();
    await this.loadManifest();
    return context;
  }

  private async loadBuffer(id: string): Promise<AudioBuffer | null> {
    const path = this.paths[id];
    const context = this.context;
    if (!path || !context) return null;
    let pending = this.buffers.get(id);
    if (!pending) {
      pending = fetch(path, { cache: "force-cache" })
        .then(async (response) => response.ok ? context.decodeAudioData(await response.arrayBuffer()) : null)
        .catch(() => null);
      this.buffers.set(id, pending);
    }
    return pending;
  }

  async play(id: string, options: { volume?: number; rate?: number } = {}): Promise<void> {
    if (document.hidden) return;
    const context = await this.unlock();
    if (this.wantedMusic && !this.currentMusic && !document.hidden) {
      void this.playMusic(this.wantedMusic).catch(() => {});
    }
    const buffer = await this.loadBuffer(id);
    if (!buffer || !this.master) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.5, Math.min(2, options.rate ?? 1));
    gain.gain.value = Math.max(0, Math.min(1, options.volume ?? 1));
    source.connect(gain).connect(this.master);
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
    source.start();
  }

  async playMusic(id: string): Promise<void> {
    this.wantedMusic = id;
    if (document.hidden || this.currentMusic?.id === id) return;
    const context = await this.unlock();
    if (document.hidden || this.wantedMusic !== id || this.currentMusic?.id === id) return;
    const buffer = await this.loadBuffer(id);
    if (document.hidden || this.wantedMusic !== id || this.currentMusic?.id === id) return;
    if (!buffer || !this.master) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 1.5);
    source.connect(gain).connect(this.master);
    const previous = this.currentMusic;
    if (previous) {
      previous.gain.gain.cancelScheduledValues(now);
      previous.gain.gain.setValueAtTime(previous.gain.gain.value, now);
      previous.gain.gain.linearRampToValueAtTime(0, now + 1.5);
      previous.source.stop(now + 1.51);
    }
    this.currentMusic = { id, source, gain };
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.currentMusic?.source === source) this.currentMusic = undefined;
    };
    source.start();
  }

  private duckMusic(seconds: number): void {
    const music = this.currentMusic;
    const context = this.context;
    if (!music || !context) return;
    const now = context.currentTime;
    music.gain.gain.cancelScheduledValues(now);
    music.gain.gain.setValueAtTime(music.gain.gain.value, now);
    music.gain.gain.linearRampToValueAtTime(0.3, now + 0.25);
    music.gain.gain.setValueAtTime(0.3, now + seconds);
    music.gain.gain.linearRampToValueAtTime(1, now + seconds + 0.8);
  }

  async speak(npcId: string, text: string, volume = 1): Promise<void> {
    if (document.hidden || volume <= 0.05) return;
    if (!this.context || this.context.state !== "running" || !this.master) return;
    const context = this.context;
    let buffer: AudioBuffer | null = null;
    try {
      const response = await fetch("/npc/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ npcId, text }),
        signal: AbortSignal.timeout(12_000),
      });
      if (response.ok) buffer = await context.decodeAudioData(await response.arrayBuffer());
    } catch {
      buffer = null;
    }
    if (!buffer) {
      this.speakWithBrowserVoice(text, volume);
      return;
    }
    const now = context.currentTime;
    const startAt = Math.max(now, this.voiceBusyUntil);
    this.voiceBusyUntil = startAt + buffer.duration + 0.3;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.min(1, volume);
    source.connect(gain).connect(this.master);
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
    source.start(startAt);
    this.duckMusic(startAt - now + buffer.duration);
  }

  private speakWithBrowserVoice(text: string, volume: number): void {
    if (typeof speechSynthesis === "undefined") return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pl-PL";
    utterance.volume = Math.min(1, volume);
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("pl"));
    if (voice) utterance.voice = voice;
    speechSynthesis.speak(utterance);
  }
}
