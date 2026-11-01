import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

export const NPC_VOICES: Record<string, string> = {
  tata: "cgSgspJ2msm6clMCkdW9",
  mama: "0zoGygYjh97gnqQuHI0b",
  ciocia: "N2lVS1w4EtoT3dr4eOWO",
};

const MAX_TEXT = 200;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; windowStart: number }>();
const memory = new Map<string, Uint8Array>();
const inflight = new Map<string, Promise<Uint8Array | null>>();

export function resetNpcTtsState(): void {
  buckets.clear();
  memory.clear();
  inflight.clear();
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

export type NpcTtsOptions = {
  apiKey?: string;
  cacheDir?: string;
  fetchFn?: typeof fetch;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function synthesize(voice: string, text: string, apiKey: string, fetcher: typeof fetch): Promise<Uint8Array | null> {
  const res = await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: "eleven_flash_v2_5",
      language_code: "pl",
      voice_settings: { stability: 0.45, similarity_boost: 0.75 },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

export async function handleNpcTts(req: Request, options: NpcTtsOptions = {}): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const apiKey = options.apiKey ?? process.env.ELEVEN_LABS_API_KEY ?? "";
  if (!apiKey) return json(503, { error: "Voice not configured" });
  let body: { npcId?: unknown; text?: unknown };
  try {
    const parsed: unknown = await req.json();
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    body = parsed as typeof body;
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  const npcId = typeof body.npcId === "string" && Object.hasOwn(NPC_VOICES, body.npcId) ? body.npcId : "tata";
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return json(400, { error: "Empty text" });

  const voice = NPC_VOICES[npcId]!;
  const key = createHash("sha256").update(`${voice}\n${text}`).digest("hex").slice(0, 40);
  const headers = { "content-type": "audio/mpeg", "cache-control": "public, max-age=604800, immutable" };

  const cached = memory.get(key);
  if (cached) return new Response(cached as unknown as BodyInit, { headers });

  const cacheDir = resolve(options.cacheDir ?? process.env.GIERA_TTS_CACHE ?? resolve(process.env.GIERA_DATA_DIR ?? "server/data", "tts"));
  const file = resolve(cacheDir, `${key}.mp3`);
  if (existsSync(file)) {
    const data = new Uint8Array(readFileSync(file));
    memory.set(key, data);
    return new Response(data, { headers });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return json(429, { error: "Too many voice requests" });

  let pending = inflight.get(key);
  if (!pending) {
    pending = synthesize(voice, text, apiKey, options.fetchFn ?? fetch)
      .catch(() => null)
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const audio = await pending;
  if (!audio) return json(502, { error: "Voice synthesis failed" });
  memory.set(key, audio);
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, audio);
  } catch {
    // cache write is best-effort
  }
  return new Response(audio as unknown as BodyInit, { headers });
}
