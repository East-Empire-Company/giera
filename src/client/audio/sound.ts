import { SpeechService, type SpeechResult } from "./speech";

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
export const MUSIC_PLAYLIST = [
  "sigma_protocol",
  "drift_phonk",
  "combat_phonk",
  "adventure_island",
  "little_farm",
] as const satisfies readonly (keyof typeof MUSIC_TRACKS)[];
const BACKGROUND_MUSIC_GAIN = 0.25;

const clipSpeaker = (id: string): string =>
  id.startsWith("cinematic_ziemek") ? "ziemek" : id.startsWith("cinematic_gniewko") ? "gniewko" : "game";

const BUDDY_SPEECH_FILTER = { type: "bandpass" as const, frequencyLow: 300, frequencyHigh: 3400 };
export class AudioManager {
  private context?: AudioContext;
  private master?: GainNode;
  private musicBus?: GainNode;
  private speechBus?: GainNode;
  private manifest?: Promise<void>;
  private readonly paths: Record<string, string> = {};
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly sources = new Set<AudioBufferSourceNode>();
  private currentMusic?: { id: string; source: AudioBufferSourceNode; gain: GainNode };
  private playlistActive = false;
  private playlistIndex = 0;
  private musicToken = 0;
  private voiceBusyUntil = 0;
  private masterVolume = 0.8;
  private musicLevel = 1;
  private speechLevel = 1;
  private readonly speechFilters = new WeakMap<AudioBuffer, typeof BUDDY_SPEECH_FILTER>();
  private readonly buddySources = new Set<AudioBufferSourceNode>();
  private nextBrowserSpeaker: string | null = null;
  private currentBrowserSpeaker: string | null = null;
  readonly speech = new SpeechService({
    getSpeechVolume: () => this.speechLevel,
    getContext: () => this.context ?? null,
    hasBrowserVoice: () => typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined",
    decode: (bytes) => this.ensureContext().decodeAudioData(bytes),
    loadBuffer: (clipId) => this.loadBuffer(clipId),
    playBuffer: (buffer, options) => this.playSpeechBuffer(buffer, options),
    speakWithBrowserVoice: (text, volume) => this.speakWithBrowserVoice(text, volume),
  });
  constructor() {
    this.speech.addEventListener("speech:ready", (event) => {
      const result = (event as CustomEvent<{ result: SpeechResult }>).detail.result;
      if (result.request.speakerId !== "buddy") return;
      if ("buffer" in result) this.speechFilters.set(result.buffer, BUDDY_SPEECH_FILTER);
      else if ("backend" in result && result.backend === "browser") this.nextBrowserSpeaker = "buddy";
    });
    Object.assign(this.paths, VOICE_PATHS);
    Object.assign(this.paths, MUSIC_TRACKS);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
          if (this.playlistActive) void this.startPlaylistTrack(this.playlistIndex).catch(() => {});
          return;
        }
        this.musicToken += 1;
        if (this.currentMusic) this.currentMusic.source.onended = null;
        this.currentMusic = undefined;
        this.speech.cancelPending();
        for (const source of this.sources) source.stop();
        this.sources.clear();
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
      this.musicBus = this.context.createGain();
      this.musicBus.gain.value = this.musicLevel;
      this.musicBus.connect(this.master);
      this.speechBus = this.context.createGain();
      this.speechBus.gain.value = this.speechLevel;
      this.speechBus.connect(this.master);
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

  tapMusicBus(): { bus: GainNode; ctx: AudioContext } | null {
    if (!this.musicBus || !this.context) return null;
    return { bus: this.musicBus, ctx: this.context };
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

  get musicVolume(): number {
    return this.musicLevel;
  }

  setMusicVolume(level: number): number {
    const value = Math.min(1, Math.max(0, Number.isFinite(level) ? level : this.musicLevel));
    this.musicLevel = value;
    if (this.musicBus && this.context) this.musicBus.gain.setTargetAtTime(value, this.context.currentTime, 0.05);
    return value;
  }

  get speechVolume(): number {
    return this.speechLevel;
  }

  setSpeechVolume(level: number): number {
    const value = Math.min(1, Math.max(0, Number.isFinite(level) ? level : this.speechLevel));
    this.speechLevel = value;
    if (value <= 0.05) this.speech.cancelPending();
    if (this.speechBus && this.context) this.speechBus.gain.setTargetAtTime(value, this.context.currentTime, 0.05);
    return value;
  }

  stopBuddySpeech(): void {
    for (const source of this.buddySources) {
      try {
        source.stop();
      } catch {
        this.buddySources.delete(source);
      }
    }
    this.buddySources.clear();
    if (this.nextBrowserSpeaker === "buddy") this.nextBrowserSpeaker = null;
    if (this.currentBrowserSpeaker === "buddy" && typeof speechSynthesis !== "undefined") {
      this.currentBrowserSpeaker = null;
      speechSynthesis.cancel();
    }
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
    if (Object.hasOwn(VOICE_PATHS, id)) {
      void this.speech.request({
        kind: "clip",
        speakerId: clipSpeaker(id),
        clipId: id,
        volume: options.volume ?? 1,
        rate: options.rate ?? 1,
      });
      return;
    }
    if (document.hidden) return;
    const context = await this.unlock();
    if (this.playlistActive && !this.currentMusic && !document.hidden) {
      void this.startPlaylistTrack(this.playlistIndex).catch(() => {});
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

  async playPlaylist(): Promise<void> {
    this.playlistActive = true;
    if (document.hidden || this.currentMusic) return;
    await this.startPlaylistTrack(this.playlistIndex);
  }
  pausePlaylist(): void {
    this.playlistActive = false;
    this.musicToken += 1;
    const music = this.currentMusic;
    if (!music) return;
    this.currentMusic = undefined;
    music.source.onended = null;
    this.sources.delete(music.source);
    music.source.stop();
  }

  private async startPlaylistTrack(index: number): Promise<void> {
    const token = ++this.musicToken;
    const slot = index % MUSIC_PLAYLIST.length;
    this.playlistIndex = slot;
    if (document.hidden || !this.playlistActive) return;
    const context = await this.unlock();
    if (token !== this.musicToken) return;
    const id = MUSIC_PLAYLIST[slot];
    const buffer = await this.loadBuffer(id);
    if (token !== this.musicToken || document.hidden || !this.playlistActive) return;
    if (!buffer || !this.musicBus) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(BACKGROUND_MUSIC_GAIN, now + 1.2);
    source.connect(gain).connect(this.musicBus);
    this.currentMusic = { id, source, gain };
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.currentMusic?.source !== source) return;
      this.currentMusic = undefined;
      if (!this.playlistActive || document.hidden) return;
      void this.startPlaylistTrack(slot + 1).catch(() => {});
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
    music.gain.gain.linearRampToValueAtTime(BACKGROUND_MUSIC_GAIN * 0.3, now + 0.25);
    music.gain.gain.setValueAtTime(BACKGROUND_MUSIC_GAIN * 0.3, now + seconds);
    music.gain.gain.linearRampToValueAtTime(BACKGROUND_MUSIC_GAIN, now + seconds + 0.8);
  }

  private playSpeechBuffer(
    buffer: AudioBuffer,
    options: { volume: number; rate: number; filter?: typeof BUDDY_SPEECH_FILTER }
  ): Promise<void> {
    const context = this.ensureContext();
    const bus = this.speechBus;
    if (!bus) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.5, Math.min(2, options.rate));
    gain.gain.value = Math.max(0, Math.min(1, options.volume));
    const filterOptions = options.filter ?? this.speechFilters.get(buffer);
    if (filterOptions) {
      const highPass = context.createBiquadFilter();
      highPass.type = "highpass";
      highPass.frequency.setValueAtTime(filterOptions.frequencyLow, context.currentTime);
      const lowPass = context.createBiquadFilter();
      lowPass.type = "lowpass";
      lowPass.frequency.setValueAtTime(filterOptions.frequencyHigh, context.currentTime);
      gain.connect(highPass).connect(lowPass).connect(bus);
      this.buddySources.add(source);
    } else {
      gain.connect(bus);
    }
    source.connect(gain);
    this.sources.add(source);
    const now = context.currentTime;
    const startAt = Math.max(now, this.voiceBusyUntil);
    this.voiceBusyUntil = startAt + buffer.duration + 0.3;
    source.onended = () => {
      this.sources.delete(source);
      this.buddySources.delete(source);
      resolve();
    };
    source.start(startAt);
    this.duckMusic(startAt - now + buffer.duration);
    return promise;
  }

  private speakWithBrowserVoice(text: string, volume: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
      resolve();
      return promise;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pl-PL";
    utterance.volume = Math.min(1, volume * this.speechVolume * this.masterVolume);
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("pl"));
    if (voice) utterance.voice = voice;
    this.currentBrowserSpeaker = this.nextBrowserSpeaker;
    this.nextBrowserSpeaker = null;
    const finish = () => {
      this.currentBrowserSpeaker = null;
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    speechSynthesis.speak(utterance);
    return promise;
  }
}
