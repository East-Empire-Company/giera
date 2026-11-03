import { createHash } from "crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import { resolve } from "path";
import { parseRetryAfterMs } from "./nemotron-proxy";

export const SPEECH_VOICES: Record<string, string> = {
  tata: "cgSgspJ2msm6clMCkdW9",
  mama: "0zoGygYjh97gnqQuHI0b",
  ciocia: "N2lVS1w4EtoT3dr4eOWO",
  buddy: "N2lVS1w4EtoT3dr4eOWO",
};

const MAX_TEXT = 200;
const MAX_BODY_BYTES = 4096;
const RATE_WINDOW_MS = 60_000;
const PEER_MISS_LIMIT = 30;
const GLOBAL_MISS_LIMIT = 60;
const MAX_PEER_BUCKETS = 4096;
const MAX_FOLLOWERS = 64;
const MAX_ACTIVE_SYNTHESIS = 1;
const MAX_QUEUED_JOBS = 16;
const JOB_DEADLINE_MS = 10_000;
const COOLDOWN_MS = 30_000;
const PROVIDER_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [250, 500];
const MAX_MEMORY_ENTRIES = 128;
const MAX_DISK_BYTES = 64 * 1024 * 1024;
const RETRYABLE_429 = new Set(["rate_limit_exceeded", "concurrent_limit_exceeded", "too_many_concurrent_requests", "system_busy"]);
const DISK_FILE_PATTERN = /^[0-9a-f]{40}\.mp3$/;
const LOOPBACK_IPS = new Set(["local", "127.0.0.1", "::1", "::ffff:127.0.0.1"]);

type Json = Record<string, unknown>;
type Bucket = { windowStart: number; keys: Set<string> };
type Outcome = { ok: true; audio: Uint8Array } | { ok: false; status: number };
type Waiter = {
  deliver: (outcome: Outcome) => void;
  abort: () => void;
};
type Job = {
  key: string;
  text: string;
  voice: string;
  apiKey: string;
  waiters: Waiter[];
  phase: "queued" | "active";
  detached: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  admission: number;
  providerCall: (signal: AbortSignal) => Promise<Response>;
};

const buckets = new Map<string, Bucket>();
const globalBucket: Bucket = { windowStart: 0, keys: new Set() };
const memory = new Map<string, Uint8Array>();
const jobs = new Map<string, Job>();
const cooldowns = new Map<string, number>();
let activeCount = 0;

export type SpeechTtsOptions = {
  apiKey?: string;
  cacheDir?: string;
  fetchFn?: typeof fetch;
  clientIp?: string;
};

export function resetSpeechTtsState(): void {
  for (const job of jobs.values()) clearJobTimer(job);
  buckets.clear();
  globalBucket.windowStart = 0;
  globalBucket.keys.clear();
  memory.clear();
  jobs.clear();
  cooldowns.clear();
  activeCount = 0;
}

export function enforceSpeechTtsDiskBound(dir: string, maxBytes: number = MAX_DISK_BYTES): void {
  const entries: { file: string; size: number; mtime: number }[] = [];
  for (const name of readdirSync(dir)) {
    if (!DISK_FILE_PATTERN.test(name)) continue;
    const full = resolve(dir, name);
    const stats = lstatSync(full, { throwIfNoEntry: false });
    if (!stats || stats.isSymbolicLink() || !stats.isFile()) continue;
    entries.push({ file: full, size: stats.size, mtime: stats.mtimeMs });
  }
  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  entries.sort((a, b) => a.mtime - b.mtime);
  for (const entry of entries) {
    if (total <= maxBytes) break;
    unlinkSync(entry.file);
    total -= entry.size;
  }
}

function json(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const cacheDirFor = (options: SpeechTtsOptions): string =>
  resolve(options.cacheDir ?? process.env.GIERA_TTS_CACHE ?? resolve(process.env.GIERA_DATA_DIR ?? "server/data", "tts"));

const remember = (key: string, audio: Uint8Array): void => {
  if (memory.has(key)) memory.delete(key);
  memory.set(key, audio);
  while (memory.size > MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
};

const readDisk = (key: string, dir: string): Uint8Array | null => {
  const file = resolve(dir, `${key}.mp3`);
  if (!existsSync(file)) return null;
  try {
    const stats = lstatSync(file, { throwIfNoEntry: false });
    if (!stats || stats.isSymbolicLink() || !stats.isFile()) return null;
    const data = new Uint8Array(readFileSync(file));
    if (data.length === 0) {
      unlinkSync(file);
      return null;
    }
    return data;
  } catch {
    return null;
  }
};

const writeDisk = (key: string, audio: Uint8Array, dir: string): void => {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${key}.mp3`), audio);
    enforceSpeechTtsDiskBound(dir);
  } catch {
    // disk cache is best-effort
  }
};

const peerBucket = (peer: string, now: number): Bucket | null => {
  const bucket = buckets.get(peer);
  if (!bucket) return null;
  if (now - bucket.windowStart >= RATE_WINDOW_MS) {
    buckets.delete(peer);
    return null;
  }
  return bucket;
};

const admitKey = (peer: string | null, key: string): boolean => {
  const now = Date.now();
  if (peer) {
    const bucket = peerBucket(peer, now);
    if (!bucket) {
      for (const [ip, entry] of buckets) {
        if (now - entry.windowStart >= RATE_WINDOW_MS) buckets.delete(ip);
      }
      if (buckets.size >= MAX_PEER_BUCKETS) return false;
      buckets.set(peer, { windowStart: now, keys: new Set([key]) });
    } else if (bucket.keys.size >= PEER_MISS_LIMIT) {
      return false;
    } else {
      bucket.keys.add(key);
    }
  }
  if (now - globalBucket.windowStart >= RATE_WINDOW_MS) {
    globalBucket.windowStart = now;
    globalBucket.keys.clear();
  }
  if (globalBucket.keys.size >= GLOBAL_MISS_LIMIT) return false;
  globalBucket.keys.add(key);
  return true;
};

const queuedCount = (): number => {
  let count = 0;
  for (const job of jobs.values()) if (job.phase === "queued") count += 1;
  return count;
};

const maybePromote = (): void => {
  if (activeCount >= MAX_ACTIVE_SYNTHESIS) return;
  for (const job of jobs.values()) {
    if (job.phase !== "queued") continue;
    if (job.admission + JOB_DEADLINE_MS <= Date.now()) continue;
    void dispatchJob(job);
    return;
  }
};

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

const audioResponse = (audio: Uint8Array): Response =>
  new Response(audio as unknown as BodyInit, {
    headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=604800, immutable" },
  });

const outcomeResponse = (outcome: Outcome): Response => (outcome.ok ? audioResponse(outcome.audio) : json(outcome.status, { error: "Voice synthesis failed" }));

const joinWaiter = (job: Job, signal: AbortSignal | null): Promise<Response> => {
  const waiter: Waiter = {
    deliver: (outcome) => {
      signal?.removeEventListener("abort", onAbort);
      resolvePromise(outcomeResponse(outcome));
    },
    abort: () => {
      const index = job.waiters.indexOf(waiter);
      if (index >= 0) job.waiters.splice(index, 1);
      if (job.phase === "queued" && job.waiters.length === 0) discardQueued(job);
      rejectPromise(new DOMException("The request was aborted", "AbortError"));
    },
  };
  const { promise, resolve: resolvePromise, reject: rejectPromise } = Promise.withResolvers<Response>();
  const onAbort = () => waiter.abort();
  job.waiters.push(waiter);
  signal?.addEventListener("abort", onAbort, { once: true });
  return promise;
};

const deliverToWaiters = (job: Job, outcome: Outcome): void => {
  const waiters = job.waiters;
  job.waiters = [];
  for (const waiter of waiters) waiter.deliver(outcome);
};

const clearJobTimer = (job: Job): void => {
  clearTimeout(job.timer as unknown as number);
  job.timer = null;
};

const discardQueued = (job: Job): void => {
  clearJobTimer(job);
  if (jobs.get(job.key) === job) jobs.delete(job.key);
  deliverToWaiters(job, { ok: false, status: 503 });
};

const onDeadline = (job: Job): void => {
  clearJobTimer(job);
  if (job.phase === "queued") {
    discardQueued(job);
    return;
  }
  job.detached = true;
  deliverToWaiters(job, { ok: false, status: 503 });
};

const settle = (job: Job, outcome: Outcome, reachedProvider: boolean): void => {
  clearJobTimer(job);
  if (outcome.ok && outcome.audio.length > 0) {
    remember(job.key, outcome.audio);
    writeDisk(job.key, outcome.audio, cacheDirFor(currentOptions));
  } else if (reachedProvider) {
    cooldowns.set(job.key, Date.now() + COOLDOWN_MS);
  }
  deliverToWaiters(job, outcome);
  if (jobs.get(job.key) === job) jobs.delete(job.key);
  activeCount -= 1;
  maybePromote();
};

const retryable429 = async (res: Response): Promise<boolean> => {
  let status = "";
  try {
    const body = (await res.json()) as { detail?: { status?: unknown } };
    if (typeof body?.detail?.status === "string") status = body.detail.status;
  } catch {
    status = "";
  }
  return status === "" || RETRYABLE_429.has(status);
};

const TIMEOUT = Symbol("timeout");

const dispatchJob = async (job: Job): Promise<void> => {
  job.phase = "active";
  activeCount += 1;
  const deadlineAt = job.admission + JOB_DEADLINE_MS;
  let outcome: Outcome = { ok: false, status: 502 };
  let reachedProvider = false;
  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) {
        outcome = { ok: false, status: 503 };
        break;
      }
      reachedProvider = true;
      const controller = new AbortController();
      const { promise: timedOut, resolve: resolveTimeout } = Promise.withResolvers<Response | typeof TIMEOUT>();
      const timer = setTimeout(() => {
        controller.abort();
        resolveTimeout(TIMEOUT);
      }, Math.min(remaining, PROVIDER_TIMEOUT_MS));
      let response: Response | typeof TIMEOUT;
      try {
        response = await Promise.race([
          job.providerCall(controller.signal).catch((): typeof TIMEOUT => TIMEOUT),
          timedOut,
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (response === TIMEOUT) {
        outcome = { ok: false, status: 502 };
        break;
      }
      if (response.ok) {
        const audio = new Uint8Array(await response.arrayBuffer());
        outcome = audio.length > 0 ? { ok: true, audio } : { ok: false, status: 502 };
        break;
      }
      if (response.status === 429 && attempt < MAX_RETRIES && (await retryable429(response))) {
        const left = deadlineAt - Date.now();
        const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
        if (retryAfter !== null && retryAfter > left) {
          outcome = { ok: false, status: 429 };
          break;
        }
        const delay = retryAfter ?? RETRY_DELAYS_MS[attempt] ?? 500;
        if (delay > deadlineAt - Date.now()) {
          outcome = { ok: false, status: 503 };
          break;
        }
        await sleep(delay);
        continue;
      }
      outcome = { ok: false, status: response.status === 429 ? 429 : 502 };
      break;
    }
  } finally {
    settle(job, outcome, reachedProvider);
  }
};

let currentOptions: SpeechTtsOptions = {};

const readBodyText = async (req: Request): Promise<string | null> => {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
};

export async function handleSpeechTts(req: Request, options: SpeechTtsOptions = {}): Promise<Response> {
  currentOptions = options;
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawBody = await readBodyText(req);
  if (rawBody === null) return json(413, { error: "Request too large" });
  let body: Json;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Json;
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  const speakerId = body.speakerId;
  if (typeof speakerId !== "string" || !Object.hasOwn(SPEECH_VOICES, speakerId)) return json(400, { error: "Unknown speaker" });
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return json(400, { error: "Empty text" });

  const voice = SPEECH_VOICES[speakerId]!;
  const key = createHash("sha256").update(`${voice}\n${text}`).digest("hex").slice(0, 40);

  const cached = memory.get(key);
  if (cached) {
    memory.delete(key);
    memory.set(key, cached);
    return audioResponse(cached);
  }

  const dir = cacheDirFor(options);
  const fromDisk = readDisk(key, dir);
  if (fromDisk) {
    remember(key, fromDisk);
    return audioResponse(fromDisk);
  }

  const existing = jobs.get(key);
  if (existing) {
    if (existing.waiters.length >= MAX_FOLLOWERS) return json(429, { error: "Too many voice requests" });
    return joinWaiter(existing, req.signal);
  }

  const coolingUntil = cooldowns.get(key);
  if (coolingUntil !== undefined) {
    if (coolingUntil > Date.now()) return json(502, { error: "Voice synthesis failed" });
    cooldowns.delete(key);
  }

  const apiKey = options.apiKey ?? process.env.ELEVEN_LABS_API_KEY ?? process.env.ELEVENLABS_API_KEY ?? "";
  if (!apiKey) return json(503, { error: "Voice not configured" });

  const ip = options.clientIp ?? "local";
  const peer = LOOPBACK_IPS.has(ip) ? null : ip;
  if (!admitKey(peer, key)) return json(429, { error: "Too many voice requests" });
  if (activeCount >= MAX_ACTIVE_SYNTHESIS && queuedCount() >= MAX_QUEUED_JOBS) return json(503, { error: "Voice queue full" });

  const job: Job = {
    key,
    text,
    voice,
    apiKey,
    waiters: [],
    phase: "queued",
    detached: false,
    timer: null,
    admission: Date.now(),
    providerCall: (signal: AbortSignal) =>
      (options.fetchFn ?? fetch)(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: "eleven_flash_v2_5",
          language_code: "pl",
          voice_settings: { stability: 0.45, similarity_boost: 0.75 },
        }),
        signal,
      }),
  };
  jobs.set(key, job);
  job.timer = setTimeout(() => onDeadline(job), JOB_DEADLINE_MS);
  maybePromote();
  return joinWaiter(job, req.signal);
}
