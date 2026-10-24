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

  constructor() {
    Object.assign(this.paths, VOICE_PATHS);
    Object.assign(this.paths, MUSIC_TRACKS);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) return;
        for (const source of this.sources) source.stop();
        this.sources.clear();
        this.currentMusic = undefined;
        void this.context?.suspend();
      });
    }
  }

  private async unlock(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    if (!this.manifest) {
      this.manifest = fetch("/assets/audio/generated/manifest.json", { cache: "force-cache" })
        .then(async (response) => {
          if (response.ok) Object.assign(this.paths, parseAudioManifest(await response.json()));
        })
        .catch(() => undefined);
    }
    await this.manifest;
    return this.context;
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
    if (document.hidden || this.currentMusic?.id === id) return;
    const context = await this.unlock();
    const buffer = await this.loadBuffer(id);
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
}
