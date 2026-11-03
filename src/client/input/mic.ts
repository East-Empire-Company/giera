import { classifyMicError } from "../../shared/mic-errors";

const DEFAULT_STT_URL = "/npc/stt";
const DEFAULT_SILENCE_THRESHOLD_MS = 10_001;
const MAX_SEGMENT_MS = 10_000;
const TRANSCRIPT_WINDOW_MS = 12_000;
const SAMPLE_INTERVAL_MS = 100;
const AUDIO_LEVEL_THRESHOLD = 0.02;
export type MicFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type MicControllerOptions = {
  getUserMedia?: () => Promise<MediaStream>;
  fetchFn?: MicFetch;
  sttUrl?: string;
  onTranscript: (text: string, gestureId: number) => void;
  onError: (code: string, gestureId: number) => void;
  silenceThresholdMs?: number;
  maxSegmentMs?: number;
};

export type MicControllerApi = {
  begin(): Promise<number | null>;
  end(): void;
  cancel(): void;
  dispose(): void;
  acquireOwnership(purpose: string): Promise<boolean>;
  releaseOwnership(): void;
};

export type MicOwnershipToken = symbol;

type MicOwner = { purpose: string; token: MicOwnershipToken };

let micOwner: MicOwner | null = null;

export async function acquireMicOwnership(purpose: string): Promise<MicOwnershipToken | null> {
  if (micOwner) return null;
  const token = Symbol(purpose);
  micOwner = { purpose, token };
  return token;
}

export function releaseMicOwnership(token: MicOwnershipToken | null): void {
  if (token && micOwner?.token === token) micOwner = null;
}

type Gesture = {
  id: number;
  status: "acquiring" | "recording" | "ended" | "cancelled";
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  maxTimer: ReturnType<typeof setTimeout> | null;
  silenceTimer: ReturnType<typeof setInterval> | null;
  context: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  analyser: AnalyserNode | null;
  heardSound: boolean;
  lastSoundAt: number;
};

type PendingTranscript = {
  id: number;
  controller: AbortController | null;
  timer: ReturnType<typeof setTimeout>;
};

export class MicController implements MicControllerApi {
  private nextGestureId = 0;
  private latestGestureId = 0;
  private activeCapture: Gesture | null = null;
  private pendingTranscript: PendingTranscript | null = null;
  private ownershipToken: MicOwnershipToken | null = null;
  private ownershipRequest: Promise<boolean> | null = null;
  private ownershipGeneration = 0;
  private disposed = false;
  private readonly getUserMedia: () => Promise<MediaStream>;
  private readonly fetchFn: MicFetch;
  private readonly sttUrl: string;
  private readonly silenceThresholdMs: number;
  private readonly maxSegmentMs: number;

  constructor(private readonly options: MicControllerOptions) {
    this.getUserMedia =
      options.getUserMedia ??
      (() => {
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
          return Promise.reject(new TypeError("Microphone capture is unavailable"));
        }
        return navigator.mediaDevices.getUserMedia({ audio: true });
      });
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.sttUrl = options.sttUrl ?? DEFAULT_STT_URL;
    this.silenceThresholdMs = options.silenceThresholdMs ?? DEFAULT_SILENCE_THRESHOLD_MS;
    this.maxSegmentMs = Math.max(1, Math.min(MAX_SEGMENT_MS, options.maxSegmentMs ?? MAX_SEGMENT_MS));
  }

  async begin(): Promise<number | null> {
    const id = ++this.nextGestureId;
    if (this.disposed) {
      this.options.onError("disposed", id);
      return null;
    }
    if (this.activeCapture) {
      this.options.onError("busy", id);
      return null;
    }

    this.latestGestureId = id;
    this.clearPendingTranscript();
    const gesture = this.createGesture(id);
    this.activeCapture = gesture;

    const ownsMic = this.ownershipToken ? true : await this.acquireOwnership("buddy");
    if (!ownsMic) {
      if (this.isLive(gesture)) {
        this.activeCapture = null;
        this.options.onError("busy", id);
      }
      return null;
    }
    if (!this.isLive(gesture)) {
      if (!this.activeCapture) this.releaseOwnership();
      return null;
    }

    let stream: MediaStream;
    try {
      if (typeof MediaRecorder === "undefined") throw new TypeError("MediaRecorder is unavailable");
      stream = await this.getUserMedia();
    } catch (error) {
      if (this.isLive(gesture)) {
        this.options.onError(classifyMicError(error), id);
        this.activeCapture = null;
        this.releaseOwnership();
      }
      return null;
    }

    if (!this.isLive(gesture)) {
      this.stopTracks(stream);
      return null;
    }
    gesture.stream = stream;

    try {
      const recorder = new MediaRecorder(stream);
      gesture.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (
          !this.disposed &&
          gesture.id === this.latestGestureId &&
          gesture.status !== "cancelled" &&
          event.data.size > 0
        ) {
          gesture.chunks.push(event.data);
        }
      };
      recorder.onstop = () => void this.finishCapture(gesture);
      recorder.start(250);
      gesture.status = "recording";
      gesture.maxTimer = setTimeout(() => {
        if (this.isLive(gesture)) this.end();
      }, this.maxSegmentMs);
      this.startSilenceMonitor(gesture);
      return id;
    } catch {
      this.options.onError("unsupported", id);
      this.activeCapture = null;
      this.stopTracks(stream);
      this.releaseOwnership();
      return null;
    }
  }

  end(): void {
    const gesture = this.activeCapture;
    if (!gesture) return;
    if (gesture.status === "acquiring") {
      this.cancel();
      return;
    }

    gesture.status = "ended";
    this.activeCapture = null;
    this.pendingTranscript = {
      id: gesture.id,
      controller: null,
      timer: setTimeout(() => this.expireTranscript(gesture.id), TRANSCRIPT_WINDOW_MS),
    };
    this.stopMonitor(gesture);
    const recorder = gesture.recorder;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        this.failTranscript(gesture.id, "recording_failed");
      }
    } else {
      void this.finishCapture(gesture);
    }
    this.stopTracks(gesture.stream);
    gesture.stream = null;
    this.releaseOwnership();
  }

  cancel(): void {
    this.latestGestureId = ++this.nextGestureId;
    const gesture = this.activeCapture;
    this.activeCapture = null;
    if (gesture) {
      gesture.status = "cancelled";
      this.stopMonitor(gesture);
      const recorder = gesture.recorder;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {}
      }
      this.stopTracks(gesture.stream);
      gesture.stream = null;
    }
    this.clearPendingTranscript();
    this.releaseOwnership();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
  }

  async acquireOwnership(purpose: string): Promise<boolean> {
    if (this.disposed) return false;
    if (this.ownershipToken) return true;
    if (this.ownershipRequest) return this.ownershipRequest;
    const generation = this.ownershipGeneration;
    const request = (async () => {
      const token = await acquireMicOwnership(purpose);
      if (!token) return false;
      if (this.disposed || generation !== this.ownershipGeneration) {
        releaseMicOwnership(token);
        return false;
      }
      this.ownershipToken = token;
      return true;
    })();
    this.ownershipRequest = request;
    try {
      return await request;
    } finally {
      if (this.ownershipRequest === request) this.ownershipRequest = null;
    }
  }

  releaseOwnership(): void {
    this.ownershipGeneration++;
    const token = this.ownershipToken;
    this.ownershipToken = null;
    releaseMicOwnership(token);
  }

  private createGesture(id: number): Gesture {
    return {
      id,
      status: "acquiring",
      stream: null,
      recorder: null,
      chunks: [],
      maxTimer: null,
      silenceTimer: null,
      context: null,
      source: null,
      analyser: null,
      heardSound: false,
      lastSoundAt: Date.now(),
    };
  }

  private isLive(gesture: Gesture): boolean {
    return (
      !this.disposed &&
      gesture.id === this.latestGestureId &&
      this.activeCapture === gesture &&
      gesture.status !== "cancelled"
    );
  }

  private isPending(id: number): boolean {
    return (
      !this.disposed &&
      id === this.latestGestureId &&
      this.pendingTranscript?.id === id
    );
  }

  private startSilenceMonitor(gesture: Gesture): void {
    if (!gesture.stream || typeof AudioContext === "undefined") return;
    try {
      const context = new AudioContext();
      const source = context.createMediaStreamSource(gesture.stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      gesture.context = context;
      gesture.source = source;
      gesture.analyser = analyser;
      const samples = new Uint8Array(analyser.fftSize);
      void context.resume().catch(() => {});
      gesture.silenceTimer = setInterval(() => {
        if (!this.isLive(gesture)) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }
        if (Math.sqrt(sum / samples.length) > AUDIO_LEVEL_THRESHOLD) {
          gesture.heardSound = true;
          gesture.lastSoundAt = Date.now();
        } else if (
          gesture.heardSound &&
          Date.now() - gesture.lastSoundAt >= this.silenceThresholdMs
        ) {
          this.end();
        }
      }, SAMPLE_INTERVAL_MS);
    } catch {}
  }

  private stopMonitor(gesture: Gesture): void {
    if (gesture.maxTimer !== null) clearTimeout(gesture.maxTimer);
    if (gesture.silenceTimer !== null) clearInterval(gesture.silenceTimer);
    gesture.maxTimer = null;
    gesture.silenceTimer = null;
    gesture.source?.disconnect();
    gesture.source = null;
    gesture.analyser = null;
    void gesture.context?.close().catch(() => {});
    gesture.context = null;
  }

  private stopTracks(stream: MediaStream | null): void {
    for (const track of stream?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {}
    }
  }

  private async finishCapture(gesture: Gesture): Promise<void> {
    if (!this.isPending(gesture.id)) return;
    const type = gesture.chunks[0]?.type || "audio/webm";
    const blob = new Blob(gesture.chunks, { type });
    if (blob.size === 0) {
      this.failTranscript(gesture.id, "empty_audio");
      return;
    }

    const pending = this.pendingTranscript;
    if (!pending || pending.id !== gesture.id) return;
    const controller = new AbortController();
    pending.controller = controller;
    const form = new FormData();
    const fileName = type.includes("mp4") ? "recording.mp4" : type.includes("ogg") ? "recording.ogg" : "recording.webm";
    form.set("file", blob, fileName);

    try {
      const response = await this.fetchFn(this.sttUrl, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        this.failTranscript(gesture.id, "stt_failed");
        return;
      }
      const payload: unknown = await response.json().catch(() => null);
      const text =
        typeof payload === "object" &&
        payload !== null &&
        "text" in payload &&
        typeof payload.text === "string"
          ? payload.text.trim()
          : "";
      if (!this.isPending(gesture.id)) return;
      this.clearPendingTranscript();
      if (text) this.options.onTranscript(text, gesture.id);
      else this.options.onError("empty_transcript", gesture.id);
    } catch {
      if (this.isPending(gesture.id)) this.failTranscript(gesture.id, "stt_failed");
    }
  }

  private expireTranscript(id: number): void {
    if (!this.isPending(id)) return;
    const pending = this.pendingTranscript;
    this.pendingTranscript = null;
    pending?.controller?.abort();
    this.options.onError("timeout", id);
  }

  private failTranscript(id: number, code: string): void {
    if (!this.isPending(id)) return;
    this.clearPendingTranscript();
    this.options.onError(code, id);
  }

  private clearPendingTranscript(): void {
    const pending = this.pendingTranscript;
    this.pendingTranscript = null;
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.controller?.abort();
  }
}

export function createMicController(options: MicControllerOptions): MicControllerApi {
  return new MicController(options);
}
