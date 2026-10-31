import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import ffmpegStatic from "ffmpeg-static";
import sourceManifest from "./audio-manifest.json";

const ELEVENLABS = "https://api.elevenlabs.io";
const NEXGATE = "http://127.0.0.1:4000/v1/chat/completions";
const COPY_PROMPT_VERSION = sourceManifest.voice_copy_prompt_version;
const outputRoot = resolve("public/assets/audio/generated");
const cacheRoot = resolve(".cache/audio");

type VoiceSettings = { stability: number; similarity_boost: number; style: number; speed: number };
type SfxRequest = { id: string; kind: "sfx"; text: string; model_id: string; prompt_influence: number; duration_seconds: number; output_format: string; loop?: boolean };
type MusicRequest = { id: string; kind: "music"; prompt: string; model_id: string; music_length_ms: number; force_instrumental: boolean; output_format: string; loop: boolean };
type VoiceTopic = { id: string; kind: "voice"; topic: string; model_id: string; language_code: "pl"; voice_settings: VoiceSettings; output_format: string };
type SourceManifest = { text_model: string; voice_copy_prompt_version: string; sfx: SfxRequest[]; music: MusicRequest[]; voice: VoiceTopic[] };
type CacheKeyInput = {
  kind: string;
  id?: string;
  text?: string;
  prompt?: string;
  topic?: string;
  prompt_version?: string;
  prompt_influence?: number;
  force_instrumental?: boolean;
  language_code?: string;
  model_id?: string;
  voice_id?: string;
  voice_settings?: Record<string, number>;
  output_format?: string;
  duration_seconds?: number;
  music_length_ms?: number;
  loop?: boolean;
};
type Subscription = { tier: string; status: string };
type GeneratedEntry = {
  id: string;
  kind: string;
  cache_key: string;
  path: string;
  model_id: string;
  text?: string;
  prompt?: string;
  topic?: string;
  voice_id?: string;
  voice_copy_prompt_version?: string;
  character_cost?: string;
  duration_seconds?: number;
  music_length_ms?: number;
  prompt_influence?: number;
  force_instrumental?: boolean;
  language_code?: string;
  voice_settings?: Record<string, number>;
  loop?: boolean;
};
type Provenance = { version: 1; generated_at: string; text_model: string; voice_id: string; entries: Record<string, GeneratedEntry> };

export function assertPaidMusicAccess(subscription: Subscription): void {
  if (subscription.status !== "active" || subscription.tier === "free" || subscription.tier === "free_disabled") {
    throw new Error("An active paid Music API access is required; no subscription was purchased.");
  }
}

export function audioCacheKey(request: CacheKeyInput): string {
  const settings = request.voice_settings
    ? Object.fromEntries(Object.entries(request.voice_settings).sort(([a], [b]) => a.localeCompare(b)))
    : null;
  const canonical = {
    kind: request.kind,
    id: request.id ?? null,
    text: request.text ?? null,
    prompt: request.prompt ?? null,
    topic: request.topic ?? null,
    prompt_version: request.prompt_version ?? null,
    model_id: request.model_id ?? null,
    voice_id: request.voice_id ?? null,
    voice_settings: settings,
    output_format: request.output_format ?? null,
    duration_seconds: request.duration_seconds ?? null,
    music_length_ms: request.music_length_ms ?? null,
    prompt_influence: request.prompt_influence ?? null,
    force_instrumental: request.force_instrumental ?? null,
    language_code: request.language_code ?? null,
    loop: request.loop ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function legacyAudioCacheKey(request: CacheKeyInput): string {
  const settings = request.voice_settings
    ? Object.fromEntries(Object.entries(request.voice_settings).sort(([a], [b]) => a.localeCompare(b)))
    : null;
  const canonical = {
    kind: request.kind,
    id: request.id ?? null,
    text: request.text ?? null,
    prompt: request.prompt ?? null,
    topic: request.topic ?? null,
    prompt_version: request.prompt_version ?? null,
    model_id: request.model_id ?? null,
    voice_id: request.voice_id ?? null,
    voice_settings: settings,
    output_format: request.output_format ?? null,
    duration_seconds: request.duration_seconds ?? null,
    music_length_ms: request.music_length_ms ?? null,
    loop: request.loop ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function adoptCachedAudioEntry(entry: GeneratedEntry | undefined, cacheKey: string, legacyKey: string, fileExists: boolean): boolean {
  if (!entry || !fileExists) return false;
  if (entry.cache_key === legacyKey) entry.cache_key = cacheKey;
  return entry.cache_key === cacheKey;
}

export function voiceCopyCacheKey(topic: string): string {
  return audioCacheKey({ kind: "voice-copy", id: "voice-copy", topic, prompt_version: sourceManifest.voice_copy_prompt_version, model_id: sourceManifest.text_model });
}

export function validateAudioManifest(value: unknown): asserts value is SourceManifest {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("sfx" in value) || !("music" in value) || !("voice" in value) || !("text_model" in value) || !("voice_copy_prompt_version" in value)) {
    throw new TypeError("Audio manifest must contain text model and all audio lists");
  }
  if (value.text_model !== "nemotron-bolt" || typeof value.voice_copy_prompt_version !== "string" || !value.voice_copy_prompt_version) throw new TypeError("Audio manifest must route generated speech text through Nemotron Bolt");
  const sfx = value.sfx;
  const music = value.music;
  const voice = value.voice;
  if (!Array.isArray(sfx) || !Array.isArray(music) || !Array.isArray(voice)) throw new TypeError("Audio manifest lists must be arrays");
  const ids = new Set<string>();
  const modelByKind: Record<"sfx" | "music" | "voice", string> = { sfx: "eleven_text_to_sound_v2", music: "music_v2_5", voice: "eleven_v4_turbo" };
  for (const [kind, values] of [["sfx", sfx], ["music", music], ["voice", voice]] as const) {
    for (const value of values) {
      const entry: unknown = value;
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || !("id" in entry) || !("kind" in entry) || !("model_id" in entry) || !("output_format" in entry)) {
        throw new TypeError(`Invalid ${kind} entry`);
      }
      if (typeof entry.id !== "string" || !/^[a-z0-9_]+$/.test(entry.id) || ids.has(entry.id)) throw new TypeError(`Invalid or duplicate audio id: ${String(entry.id)}`);
      ids.add(entry.id);
      if (entry.kind !== kind || entry.model_id !== modelByKind[kind] || entry.output_format !== "mp3_44100_128") throw new TypeError(`Invalid audio model contract: ${entry.id}`);
      if (kind === "sfx" && (!(("text" in entry) && typeof entry.text === "string") || !("duration_seconds" in entry) || typeof entry.duration_seconds !== "number" || entry.duration_seconds < 0.5 || entry.duration_seconds > 30 || !("prompt_influence" in entry) || typeof entry.prompt_influence !== "number" || entry.prompt_influence < 0 || entry.prompt_influence > 1 || ("loop" in entry && typeof entry.loop !== "boolean"))) {
        throw new TypeError(`Invalid sound effect: ${entry.id}`);
      }
      if (kind === "music" && (!("prompt" in entry) || typeof entry.prompt !== "string" || !("music_length_ms" in entry) || typeof entry.music_length_ms !== "number" || entry.music_length_ms < 3000 || entry.music_length_ms > 600000 || !("force_instrumental" in entry) || entry.force_instrumental !== true || !("loop" in entry) || entry.loop !== true)) {
        throw new TypeError(`Invalid music entry: ${entry.id}`);
      }
      if (kind === "voice" && (!("topic" in entry) || typeof entry.topic !== "string" || !("language_code" in entry) || entry.language_code !== "pl" || Object.hasOwn(entry, "text") || !("voice_settings" in entry))) {
        throw new TypeError(`Voice entry must contain a Polish topic, not scripted text: ${entry.id}`);
      }
      if (kind === "voice") {
        if (!("voice_settings" in entry)) throw new TypeError(`Invalid voice settings: ${entry.id}`);
        const settings = entry.voice_settings;
        if (!settings || typeof settings !== "object" || Array.isArray(settings) || !("stability" in settings) || !("similarity_boost" in settings) || !("style" in settings) || !("speed" in settings)) throw new TypeError(`Invalid voice settings: ${entry.id}`);
        if (typeof settings.stability !== "number" || typeof settings.similarity_boost !== "number" || typeof settings.style !== "number" || typeof settings.speed !== "number") throw new TypeError(`Invalid voice settings: ${entry.id}`);
      }
    }
  }
  if (sfx.length !== 13 || music.length !== 2 || voice.length !== 6) throw new RangeError("Audio manifest does not match the approved asset set");
}

function parseEnvValue(content: string, name: string): string | undefined {
  const prefix = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
  for (const line of content.split(/\r?\n/)) {
    if (!prefix.test(line)) continue;
    let value = line.slice(line.indexOf("=") + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!value || /[`$\\]/.test(value)) return undefined;
    return value;
  }
  return undefined;
}

export function resolveSecretValue(name: string, environment: Record<string, string | undefined>, files: Record<string, string>): string | undefined {
  const names = name === "ELEVENLABS_API_KEY" ? ["ELEVEN_LABS_API_KEY", name] : [name];
  if (name === "ELEVENLABS_API_KEY") {
    const zshValue = files["~/.zshrc"] ? parseEnvValue(files["~/.zshrc"], "ELEVEN_LABS_API_KEY") : undefined;
    if (zshValue) return zshValue;
  }
  for (const variable of names) {
    const value = environment[variable]?.trim();
    if (value) return value;
  }
  const fileOrder = name === "ELEVENLABS_API_KEY" ? ["~/.zshrc", "~/.env", "~/.env.nexgate"] : ["~/.env", "~/.env.nexgate", "~/.zshrc"];
  for (const source of fileOrder) {
    const content = files[source];
    if (!content) continue;
    for (const variable of names) {
      const value = parseEnvValue(content, variable);
      if (value) return value;
    }
  }
  return undefined;
}

async function readSecret(name: string): Promise<string> {
  const home = homedir();
  const sources = [
    ["~/.zshrc", join(home, ".zshrc")],
    ["~/.env", join(home, ".env")],
    ["~/.env.nexgate", join(home, "Repos/personal/hybrid-llm-stack-public-candidate/.env.nexgate")],
  ] as const;
  const files: Record<string, string> = {};
  for (const [label, path] of sources) {
    try {
      files[label] = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const secret = resolveSecretValue(name, process.env, files);
  if (secret) return secret;
  throw new Error(`Missing ${name}; set it in the environment or an approved local env file.`);
}

async function elevenLabsRequest(key: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("xi-api-key", key);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`${ELEVENLABS}${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`ElevenLabs request failed (${response.status}) for ${path.split("?")[0]}`);
  return response;
}

async function getSubscription(key: string): Promise<Subscription> {
  const response = await elevenLabsRequest(key, "/v1/user/subscription");
  const body = await response.json() as Record<string, unknown>;
  if (typeof body.tier !== "string" || typeof body.status !== "string") throw new TypeError("ElevenLabs returned an invalid subscription response");
  return { tier: body.tier, status: body.status };
}

function supportsVerifiedLanguage(value: unknown, modelId: string): boolean {
  if (!Array.isArray(value)) return false;
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || !("language" in candidate) || !("model_id" in candidate)) continue;
    if (candidate.language === "pl" && candidate.model_id === modelId) return true;
  }
  return false;
}

async function getPolishVoiceId(key: string, modelId: string): Promise<string> {
  const query = new URLSearchParams({ language: "pl", page_size: "100" });
  const response = await elevenLabsRequest(key, `/v2/voices?${query}`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("voices" in body) || !Array.isArray(body.voices)) throw new TypeError("ElevenLabs returned an invalid voice list");
  for (const value of body.voices) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !("voice_id" in value) || typeof value.voice_id !== "string" || !("verified_languages" in value)) continue;
    if (!supportsVerifiedLanguage(value.verified_languages, modelId)) continue;
    const detailResponse = await elevenLabsRequest(key, `/v1/voices/${encodeURIComponent(value.voice_id)}`);
    const detail: unknown = await detailResponse.json();
    if (detail && typeof detail === "object" && "verified_languages" in detail && supportsVerifiedLanguage(detail.verified_languages, modelId)) return value.voice_id;
  }
  throw new Error(`No voice verifies Polish for ${modelId}`);
}

function polishCopy(raw: string): string {
  const text = raw.trim().replace(/^["'“]+|["'”]+$/g, "").replace(/\s+/g, " ");
  if (!text || text.split(" ").length > 12 || text.length > 160) throw new Error("Nemotron returned voice copy outside the 12-word limit");
  return text;
}

export function parseNemotronResponse(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("model" in value) || value.model !== sourceManifest.text_model) {
    throw new Error("NexGate returned an unexpected model; refusing fallback output");
  }
  if (!("choices" in value) || !Array.isArray(value.choices)) throw new TypeError("NexGate returned no generated voice copy");
  const choice: unknown = value.choices[0];
  if (!choice || typeof choice !== "object" || Array.isArray(choice) || !("message" in choice)) throw new TypeError("NexGate returned no generated voice copy");
  const message: unknown = choice.message;
  if (!message || typeof message !== "object" || Array.isArray(message) || !("content" in message) || typeof message.content !== "string") {
    throw new TypeError("NexGate returned no generated voice copy");
  }
  return polishCopy(message.content);
}
async function generateVoiceCopy(topic: string, key: string): Promise<string> {
  const response = await fetch(NEXGATE, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: sourceManifest.text_model,
      disable_fallbacks: true,
      temperature: 0.4,
      max_tokens: 512,
      messages: [
        { role: "system", content: "Napisz jedno krótkie zdanie po polsku dla dziecka w wieku 6-8 lat. Maksymalnie 12 słów. Bez markdown, cudzysłowów i wyjaśnień. Treść ma dotyczyć wyłącznie bezpiecznej gry w budowanie." },
        { role: "user", content: `Wiadomość głosowa do celu gry: ${topic}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`NexGate ${sourceManifest.text_model} request failed (${response.status})`);
  return parseNemotronResponse(await response.json());
}



type CachedVoiceCopy = { cache_key: string; topic: string; text: string; model_alias: SourceManifest["text_model"]; prompt_version: string };

async function loadVoiceCopyCache(path: string): Promise<Record<string, CachedVoiceCopy>> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { entries?: unknown };
    if (value.entries && typeof value.entries === "object" && !Array.isArray(value.entries)) return value.entries as Record<string, CachedVoiceCopy>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return {};
}

async function prepareVoiceCopies(items: VoiceTopic[], key: string, entries: Record<string, GeneratedEntry>, voiceId: string, path: string): Promise<Record<string, string>> {
  const cache = await loadVoiceCopyCache(path);
  const copies: Record<string, string> = {};
  for (const item of items) {
    const cacheKey = voiceCopyCacheKey(item.topic);
    const cached = cache[item.id];
    if (cached?.cache_key === cacheKey && cached.model_alias === sourceManifest.text_model && cached.text) {
      copies[item.id] = cached.text;
      continue;
    }
    const previous = entries[item.id];
    const text = previous?.topic === item.topic && previous.voice_copy_prompt_version === COPY_PROMPT_VERSION && previous.voice_id === voiceId && previous.text
      ? previous.text
      : await generateVoiceCopy(item.topic, key);
    copies[item.id] = text;
    cache[item.id] = { cache_key: cacheKey, topic: item.topic, text, model_alias: sourceManifest.text_model, prompt_version: COPY_PROMPT_VERSION };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify({ version: 1, entries: cache }, null, 2)}\n`);
  }
  return copies;
}

async function loadProvenance(path: string): Promise<Record<string, GeneratedEntry>> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { entries?: unknown };
    if (value.entries && typeof value.entries === "object" && !Array.isArray(value.entries)) return value.entries as Record<string, GeneratedEntry>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return {};
}

async function saveProvenance(path: string, entries: Record<string, GeneratedEntry>, voiceId: string): Promise<void> {
  const value: Provenance = { version: 1, generated_at: new Date().toISOString(), text_model: sourceManifest.text_model, voice_id: voiceId, entries };
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function transcodeAudio(rawPath: string, outputPath: string, music: boolean): void {
  if (!ffmpegStatic) throw new Error("ffmpeg-static binary is unavailable");
  if (music) {
    const filter = "[0:a]atrim=duration=12,asetpts=PTS-STARTPTS[body];[0:a]atrim=duration=0.25,asetpts=PTS-STARTPTS[head];[body][head]acrossfade=d=0.25:c1=tri:c2=tri,loudnorm=I=-16:TP=-1.5:LRA=11[out]";
    execFileSync(ffmpegStatic, ["-hide_banner", "-loglevel", "error", "-y", "-i", rawPath, "-filter_complex", filter, "-map", "[out]", "-codec:a", "libmp3lame", "-q:a", "2", outputPath], { stdio: "inherit" });
    return;
  }
  const filter = "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-50dB,afade=t=in:st=0:d=0.02,areverse,afade=t=in:st=0:d=0.02,areverse,loudnorm=I=-16:TP=-1.5:LRA=11";
  execFileSync(ffmpegStatic, ["-hide_banner", "-loglevel", "error", "-y", "-i", rawPath, "-af", filter, "-codec:a", "libmp3lame", "-q:a", "2", outputPath], { stdio: "inherit" });
}

async function generateAudioFile(
  key: string,
  id: string,
  kind: string,
  cacheKey: string,
  modelId: string,
  request: (apiKey: string) => Promise<Response>,
  entries: Record<string, GeneratedEntry>,
  voiceId: string,
  provenancePath: string,
  metadata: Omit<GeneratedEntry, "id" | "kind" | "cache_key" | "path" | "model_id">,
  music = false,
): Promise<void> {
  const relativePath = `assets/audio/generated/${id}-${cacheKey}.mp3`;
  const outputPath = resolve("public", relativePath);
  if (existsSync(outputPath)) {
    entries[id] = { id, kind, cache_key: cacheKey, path: relativePath, model_id: modelId, ...metadata };
    await saveProvenance(provenancePath, entries, voiceId);
    return;
  }
  const response = await request(key);
  const rawPath = join(cacheRoot, `${cacheKey}.mp3`);
  await mkdir(dirname(rawPath), { recursive: true });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(rawPath, Buffer.from(await response.arrayBuffer()));
  transcodeAudio(rawPath, outputPath, music);
  entries[id] = {
    id,
    kind,
    cache_key: cacheKey,
    path: relativePath,
    model_id: modelId,
    character_cost: response.headers.get("character-cost") ?? undefined,
    ...metadata,
  };
  await saveProvenance(provenancePath, entries, voiceId);
}

async function main(): Promise<void> {
  validateAudioManifest(sourceManifest);
  if (process.argv.includes("--validate")) {
    console.log(`Audio manifest valid: ${sourceManifest.sfx.length} SFX, ${sourceManifest.music.length} music tracks, ${sourceManifest.voice.length} voice topics.`);
    return;
  }
  const elevenLabsKey = await readSecret("ELEVENLABS_API_KEY");
  const subscription = await getSubscription(elevenLabsKey);
  assertPaidMusicAccess(subscription);
  const llmKey = await readSecret("LITELLM_MASTER_KEY");
  const voiceId = await getPolishVoiceId(elevenLabsKey, sourceManifest.voice[0].model_id);
  const provenancePath = join(outputRoot, "manifest.json");
  const entries = await loadProvenance(provenancePath);
  const voiceCopies = await prepareVoiceCopies(sourceManifest.voice, llmKey, entries, voiceId, join(cacheRoot, "voice-copy-manifest.json"));

  for (const item of sourceManifest.sfx) {
    const request: CacheKeyInput = { kind: item.kind, id: item.id, text: item.text, model_id: item.model_id, output_format: item.output_format, prompt_influence: item.prompt_influence, duration_seconds: item.duration_seconds, loop: item.loop ?? false };
    const cacheKey = audioCacheKey(request);
    const legacyKey = legacyAudioCacheKey({ kind: item.kind, id: item.id, text: item.text, model_id: item.model_id, output_format: item.output_format, duration_seconds: item.duration_seconds, loop: item.loop ?? false });
    const cached = entries[item.id];
    if (cached && adoptCachedAudioEntry(cached, cacheKey, legacyKey, existsSync(resolve("public", cached.path)))) {
      Object.assign(cached, { prompt_influence: item.prompt_influence, duration_seconds: item.duration_seconds, loop: item.loop ?? false });
      await saveProvenance(provenancePath, entries, voiceId);
      continue;
    }
    await generateAudioFile(elevenLabsKey, item.id, item.kind, cacheKey, item.model_id, (apiKey) => elevenLabsRequest(apiKey, `/v1/sound-generation?output_format=${item.output_format}`, {
      method: "POST",
      body: JSON.stringify({ text: item.text, duration_seconds: item.duration_seconds, prompt_influence: item.prompt_influence, model_id: item.model_id, loop: item.loop ?? false }),
    }), entries, voiceId, provenancePath, { text: item.text, duration_seconds: item.duration_seconds, prompt_influence: item.prompt_influence, loop: item.loop ?? false });
  }
  for (const item of sourceManifest.music) {
    const request: CacheKeyInput = { kind: item.kind, id: item.id, prompt: item.prompt, model_id: item.model_id, force_instrumental: item.force_instrumental, output_format: item.output_format, music_length_ms: item.music_length_ms, loop: item.loop };
    const cacheKey = audioCacheKey(request);
    const legacyKey = legacyAudioCacheKey({ kind: item.kind, id: item.id, prompt: item.prompt, model_id: item.model_id, output_format: item.output_format, music_length_ms: item.music_length_ms });
    const cached = entries[item.id];
    if (cached && adoptCachedAudioEntry(cached, cacheKey, legacyKey, existsSync(resolve("public", cached.path)))) {
      Object.assign(cached, { music_length_ms: item.music_length_ms, force_instrumental: item.force_instrumental, loop: item.loop });
      await saveProvenance(provenancePath, entries, voiceId);
      continue;
    }
    await generateAudioFile(elevenLabsKey, item.id, item.kind, cacheKey, item.model_id, (apiKey) => elevenLabsRequest(apiKey, `/v1/music?output_format=${item.output_format}`, {
      method: "POST",
      body: JSON.stringify({ prompt: item.prompt, music_length_ms: item.music_length_ms, model_id: item.model_id, force_instrumental: item.force_instrumental }),
    }), entries, voiceId, provenancePath, { prompt: item.prompt, music_length_ms: item.music_length_ms, force_instrumental: item.force_instrumental, loop: item.loop }, item.loop);
  }
  for (const item of sourceManifest.voice) {
    const text = voiceCopies[item.id];
    const request: CacheKeyInput = { kind: item.kind, id: item.id, topic: item.topic, prompt_version: COPY_PROMPT_VERSION, text, model_id: item.model_id, voice_id: voiceId, voice_settings: item.voice_settings, output_format: item.output_format, language_code: item.language_code };
    const cacheKey = audioCacheKey(request);
    if (entries[item.id]?.cache_key === cacheKey && existsSync(resolve("public", entries[item.id].path))) continue;
    await generateAudioFile(elevenLabsKey, item.id, item.kind, cacheKey, item.model_id, (apiKey) => elevenLabsRequest(apiKey, `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${item.output_format}`, {
      method: "POST",
      body: JSON.stringify({ text, model_id: item.model_id, language_code: item.language_code, voice_settings: item.voice_settings }),
    }), entries, voiceId, provenancePath, { text, topic: item.topic, voice_id: voiceId, voice_copy_prompt_version: COPY_PROMPT_VERSION });
  }

  console.log(`Audio ready: ${Object.keys(entries).length} files; provenance at ${provenancePath}.`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Audio generation failed");
    process.exitCode = 1;
  });
}
