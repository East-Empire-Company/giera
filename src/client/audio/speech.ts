export type SpeechRequest =
  | { kind: "text"; speakerId: string; text: string; volume: number }
  | { kind: "clip"; speakerId: string; clipId: string; volume: number; rate: number }
  | { kind: "stream"; speakerId: "tata" };

export type SpeechResult =
  | { id: number; request: SpeechRequest; backend: "elevenlabs" | "asset"; buffer: AudioBuffer }
  | { id: number; request: SpeechRequest; backend: "browser"; text: string }
  | { id: number; request: SpeechRequest; backend: "agent-stream" }
  | { id: number; request: SpeechRequest; reason: "suppressed" | "unavailable" | "cancelled" };

export type SpeechDeps = {
  getSpeechVolume: () => number;
  getContext: () => AudioContext | null;
  hasBrowserVoice: () => boolean;
  decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
  loadBuffer: (clipId: string) => Promise<AudioBuffer | null>;
  playBuffer: (buffer: AudioBuffer, options: { volume: number; rate: number }) => Promise<void>;
  speakWithBrowserVoice: (text: string, volume: number) => Promise<void>;
  fetchFn?: typeof fetch;
};

type Entry = {
  id: number;
  request: SpeechRequest;
  done: Promise<SpeechResult>;
  resolveDone: (result: SpeechResult) => void;
  ready: boolean;
  terminal: boolean;
  ended: boolean;
  abort: AbortController | null;
};

const QUIET_VOLUME = 0.05;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export class SpeechService extends EventTarget {
  private nextId = 0;
  private readonly entries = new Map<number, Entry>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly deps: SpeechDeps) {
    super();
  }

  request(input: SpeechRequest): { id: number; done: Promise<SpeechResult> } {
    const id = ++this.nextId;
    const { promise, resolve } = Promise.withResolvers<SpeechResult>();
    const entry: Entry = { id, request: input, done: promise, resolveDone: resolve, ready: false, terminal: false, ended: false, abort: null };
    this.entries.set(id, entry);
    this.dispatchEvent(new CustomEvent("speech:request", { detail: { id, request: input } }));
    if (this.isSuppressed(input)) {
      this.fail(entry, "suppressed");
      return { id, done: promise };
    }
    if (input.kind === "stream") {
      return { id, done: promise };
    }
    this.tail = this.tail.then(() => this.run(entry)).catch(() => undefined);
    return { id, done: promise };
  }

  cancel(id: number): void {
    this.cancelEntry(this.entries.get(id));
  }

  cancelPending(): void {
    for (const entry of this.entries.values()) this.cancelEntry(entry);
  }

  streamReady(id: number): void {
    const entry = this.entries.get(id);
    if (!entry || entry.request.kind !== "stream" || entry.ready || entry.terminal) return;
    entry.ready = true;
    const result: SpeechResult = { id, request: entry.request, backend: "agent-stream" };
    this.dispatchEvent(new CustomEvent("speech:ready", { detail: { id, result } }));
    entry.resolveDone(result);
  }

  endStream(id: number, failed: boolean): void {
    const entry = this.entries.get(id);
    if (!entry || entry.request.kind !== "stream" || entry.ended) return;
    if (entry.ready) {
      entry.ended = true;
      this.dispatchEvent(new CustomEvent("speech:ended", { detail: { id, failed } }));
      return;
    }
    if (entry.terminal) return;
    this.fail(entry, failed ? "unavailable" : "cancelled");
  }

  private cancelEntry(entry: Entry | undefined): void {
    if (!entry || entry.request.kind === "stream" || entry.ready || entry.terminal) return;
    entry.terminal = true;
    entry.abort?.abort();
    const result: SpeechResult = { id: entry.id, request: entry.request, reason: "cancelled" };
    this.dispatchEvent(new CustomEvent("speech:failed", { detail: { id: entry.id, result } }));
    entry.resolveDone(result);
  }

  private fail(entry: Entry, reason: "suppressed" | "unavailable" | "cancelled"): void {
    entry.terminal = true;
    const result: SpeechResult = { id: entry.id, request: entry.request, reason };
    this.dispatchEvent(new CustomEvent("speech:failed", { detail: { id: entry.id, result } }));
    entry.resolveDone(result);
  }

  private markReady(entry: Entry, result: SpeechResult): void {
    entry.ready = true;
    this.dispatchEvent(new CustomEvent("speech:ready", { detail: { id: entry.id, result } }));
    entry.resolveDone(result);
  }

  private isSuppressed(request: SpeechRequest): boolean {
    if (request.kind === "stream") return false;
    if (typeof document !== "undefined" && document.hidden) return true;
    if (this.deps.getSpeechVolume() <= QUIET_VOLUME) return true;
    if (request.kind === "text" && request.volume <= QUIET_VOLUME) return true;
    if (request.kind === "clip" && request.volume <= QUIET_VOLUME) return true;
    const context = this.deps.getContext();
    return !context || context.state !== "running";
  }

  private playGate(entry: Entry): boolean {
    if (entry.terminal || entry.ready) return false;
    return !this.isSuppressed(entry.request);
  }

  private browserFallbackVolume(request: SpeechRequest & { kind: "text" }): number {
    return clamp(request.volume, 0, 1);
  }

  private async run(entry: Entry): Promise<void> {
    const request = entry.request;
    if (entry.terminal) return;
    if (request.kind === "clip") {
      const buffer = await this.deps.loadBuffer(request.clipId);
      if (entry.terminal) return;
      if (!buffer) {
        this.fail(entry, "unavailable");
        return;
      }
      if (!this.playGate(entry)) {
        this.fail(entry, "cancelled");
        return;
      }
      this.markReady(entry, { id: entry.id, request, backend: "asset", buffer });
      await this.deps.playBuffer(buffer, { volume: clamp(request.volume, 0, 1), rate: clamp(request.rate, 0.5, 2) });
      return;
    }
    if (request.kind !== "text") return;
    const abort = new AbortController();
    entry.abort = abort;
    const timeout = setTimeout(() => abort.abort(), 12_000);
    let bytes: ArrayBuffer | null = null;
    try {
      const response = await (this.deps.fetchFn ?? fetch)("/speech/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speakerId: request.speakerId, text: request.text }),
        signal: abort.signal,
      });
      if (response.ok) bytes = await response.arrayBuffer();
    } catch {
      bytes = null;
    } finally {
      clearTimeout(timeout);
      entry.abort = null;
    }
    if (entry.terminal) return;
    let buffer: AudioBuffer | null = null;
    if (bytes) {
      try {
        buffer = await this.deps.decode(bytes);
      } catch {
        buffer = null;
      }
    }
    if (entry.terminal) return;
    if (buffer) {
      if (!this.playGate(entry)) {
        this.fail(entry, "cancelled");
        return;
      }
      this.markReady(entry, { id: entry.id, request, backend: "elevenlabs", buffer });
      await this.deps.playBuffer(buffer, { volume: clamp(request.volume, 0, 1), rate: 1 });
      return;
    }
    if (!this.deps.hasBrowserVoice()) {
      this.fail(entry, "unavailable");
      return;
    }
    if (!this.playGate(entry)) {
      this.fail(entry, "cancelled");
      return;
    }
    this.markReady(entry, { id: entry.id, request, backend: "browser", text: request.text });
    await this.deps.speakWithBrowserVoice(request.text, this.browserFallbackVolume(request));
  }
}
