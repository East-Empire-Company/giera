import { MIC_ERROR_MESSAGES, classifyMicError, type MicErrorCode } from "../../shared/mic-errors";

export type MicCallbacks = {
  onSpeech?: (text: string) => void;
  onError?: (error: string) => void;
  onStateChange?: (isRecording: boolean) => void;
};

export type SttRequest = { method?: string; body?: BodyInit | null };
export type SttFetcher = (input: string, init?: SttRequest) => Promise<Response>;

export type MicControllerOptions = {
  lang?: string;
  onSpeech?: (text: string) => void;
  onError?: (error: string) => void;
  onStateChange?: (isRecording: boolean) => void;
  endpoint?: string;
  fetchFn?: SttFetcher;
  silenceMs?: number;
  minSegmentMs?: number;
  maxSegmentMs?: number;
  levelPollMs?: number;
};

const SILENCE_MS = 1200;
const MIN_SEGMENT_MS = 400;
const MAX_SEGMENT_MS = 15_000;
const LEVEL_POLL_MS = 100;
const LEVEL_THRESHOLD = 0.02;
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
const TRANSCRIBE_FAILED = "Nie udało się zamienić mowy na tekst.";

export type SegmentCutInput = {
  nowMs: number;
  lastSoundAtMs: number;
  segmentStartMs: number;
  heardSound: boolean;
  silenceMs?: number;
  minSegmentMs?: number;
  maxSegmentMs?: number;
};

export function shouldCutSegment(input: SegmentCutInput): boolean {
  if (!input.heardSound) return false;
  const silenceMs = input.silenceMs ?? SILENCE_MS;
  const minSegmentMs = input.minSegmentMs ?? MIN_SEGMENT_MS;
  const maxSegmentMs = input.maxSegmentMs ?? MAX_SEGMENT_MS;
  const segmentMs = input.nowMs - input.segmentStartMs;
  if (segmentMs >= maxSegmentMs) return true;
  if (segmentMs < minSegmentMs) return false;
  return input.nowMs - input.lastSoundAtMs >= silenceMs;
}

export async function transcribeAudio(
  blob: Blob,
  endpoint: string,
  fetcher: SttFetcher = (input, init) => fetch(input, init),
): Promise<string> {
  const name = blob.type.includes("mp4") ? "clip.mp4" : blob.type.includes("ogg") ? "clip.ogg" : "clip.webm";
  const form = new FormData();
  form.set("file", blob, name);
  const res = await fetcher(endpoint, { method: "POST", body: form });
  if (!res.ok) throw new Error(`stt_failed_${res.status}`);
  const payload = (await res.json().catch(() => null)) as { text?: unknown } | null;
  return typeof payload?.text === "string" ? payload.text.trim() : "";
}

export class MicController {
  readonly language: string;
  private recording = false;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelTimer: number | null = null;
  private lastSoundAt = 0;
  private segmentStartedAt = 0;
  private heardSound = false;
  private stopping = false;
  private error: MicErrorCode | null = null;
  private readonly callbacks: MicCallbacks;
  private readonly endpoint: string;
  private readonly fetcher: SttFetcher;
  private readonly silenceMs: number;
  private readonly minSegmentMs: number;
  private readonly maxSegmentMs: number;
  private readonly levelPollMs: number;

  constructor(options: MicControllerOptions = {}) {
    this.language = options.lang ?? "pl-PL";
    this.callbacks = {
      onSpeech: options.onSpeech,
      onError: options.onError,
      onStateChange: options.onStateChange,
    };
    this.endpoint = options.endpoint ?? "/npc/stt";
    this.fetcher = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.silenceMs = options.silenceMs ?? SILENCE_MS;
    this.minSegmentMs = options.minSegmentMs ?? MIN_SEGMENT_MS;
    this.maxSegmentMs = options.maxSegmentMs ?? MAX_SEGMENT_MS;
    this.levelPollMs = options.levelPollMs ?? LEVEL_POLL_MS;
  }

  static isSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof MediaRecorder !== "undefined"
    );
  }

  get isRecording(): boolean {
    return this.recording;
  }

  get lastError(): string | null {
    return this.error ? MIC_ERROR_MESSAGES[this.error] : null;
  }

  get lastErrorCode(): MicErrorCode | null {
    return this.error;
  }

  async start(): Promise<boolean> {
    if (this.recording) return true;
    if (!MicController.isSupported()) {
      this.fail("unsupported");
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      this.fail(classifyMicError(error));
      return false;
    }
    this.error = null;
    this.setRecording(true);
    this.startSegment();
    this.startLevelMonitor();
    return true;
  }

  stop(): void {
    if (!this.recording && !this.recorder) return;
    this.setRecording(false);
    this.stopLevelMonitor();
    const recorder = this.recorder;
    this.recorder = null;
    this.stopping = true;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    this.stopping = false;
    this.releaseStream();
  }

  handleTranscript(text: string): void {
    this.callbacks.onSpeech?.(text);
  }

  private fail(code: MicErrorCode): void {
    this.error = code;
    this.callbacks.onError?.(MIC_ERROR_MESSAGES[code]);
  }

  private setRecording(value: boolean): void {
    if (this.recording === value) return;
    this.recording = value;
    this.callbacks.onStateChange?.(value);
  }

  private startSegment(): void {
    const stream = this.stream;
    if (!stream) return;
    const mimeType = MicController.pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      recorder = new MediaRecorder(stream);
    }
    this.chunks = [];
    this.heardSound = false;
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onstop = () => {
      void this.finishSegment();
      if (this.stopping) {
        this.stopping = false;
        this.releaseStream();
      }
    };
    recorder.start(250);
    this.recorder = recorder;
    this.segmentStartedAt = performance.now();
    this.lastSoundAt = this.segmentStartedAt;
  }

  private async finishSegment(): Promise<void> {
    const chunks = this.chunks;
    this.chunks = [];
    const type = chunks[0]?.type || "audio/webm";
    const blob = new Blob(chunks, { type });
    const heardSound = this.heardSound;
    if (this.recording) this.startSegment();
    if (!heardSound || blob.size === 0) return;
    try {
      const text = await transcribeAudio(blob, this.endpoint, this.fetcher);
      if (text) this.handleTranscript(text);
    } catch {
      this.callbacks.onError?.(TRANSCRIBE_FAILED);
    }
  }

  private startLevelMonitor(): void {
    const stream = this.stream;
    if (!stream) return;
    const analyser = this.createAnalyser(stream);
    this.analyser = analyser;
    const data = analyser ? new Uint8Array(analyser.fftSize) : null;
    this.levelTimer = window.setInterval(() => {
      const now = performance.now();
      if (analyser && data) {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const sample = (data[i] - 128) / 128;
          sum += sample * sample;
        }
        if (Math.sqrt(sum / data.length) > LEVEL_THRESHOLD) {
          this.heardSound = true;
          this.lastSoundAt = now;
          return;
        }
      } else {
        this.heardSound = true;
        this.lastSoundAt = now;
        return;
      }
      if (
        shouldCutSegment({
          nowMs: now,
          lastSoundAtMs: this.lastSoundAt,
          segmentStartMs: this.segmentStartedAt,
          heardSound: this.heardSound,
          silenceMs: this.silenceMs,
          minSegmentMs: this.minSegmentMs,
          maxSegmentMs: this.maxSegmentMs,
        })
      ) {
        this.cutSegment();
      }
    }, this.levelPollMs);
  }

  private createAnalyser(stream: MediaStream): AnalyserNode | null {
    try {
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.context = context;
      void context.resume().catch(() => undefined);
      return analyser;
    } catch {
      this.context = null;
      return null;
    }
  }

  private cutSegment(): void {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }

  private stopLevelMonitor(): void {
    if (this.levelTimer !== null) {
      window.clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
    this.analyser = null;
    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
  }

  private releaseStream(): void {
    const stream = this.stream;
    this.stream = null;
    if (!stream) return;
    for (const track of stream.getTracks()) track.stop();
  }

  private static pickMimeType(): string {
    if (typeof MediaRecorder.isTypeSupported !== "function") return "";
    for (const candidate of MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    }
    return "";
  }
}
