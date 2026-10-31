const STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; windowStart: number }>();

export function resetNpcSttState(): void {
  buckets.clear();
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

export type NpcSttOptions = {
  apiKey?: string;
  fetchFn?: typeof fetch;
  allowRequest?: (ip: string) => boolean;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function handleNpcStt(req: Request, options?: NpcSttOptions): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const apiKey = options?.apiKey ?? process.env.ELEVEN_LABS_API_KEY ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return json(503, { error: "stt_not_configured" });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const allowRequest = options?.allowRequest ?? ((requestIp: string) => !rateLimited(requestIp));
  if (!allowRequest(ip)) return json(429, { error: "stt_rate_limited" });

  const form = await req.formData().catch(() => null);
  if (!form) return json(400, { error: "stt_file_missing" });
  const entry = form.get("file");
  if (!entry || typeof entry === "string") return json(400, { error: "stt_file_missing" });
  if (entry.size > MAX_FILE_BYTES) return json(413, { error: "stt_file_too_large" });

  const body = new FormData();
  body.append("file", entry, entry.name || "recording.webm");
  body.append("model_id", "scribe_v1");
  body.append("language_code", "pl");

  const fetchFn = options?.fetchFn ?? fetch;
  let upstream: Response;
  try {
    upstream = await fetchFn(STT_URL, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return json(502, { error: "stt_upstream_unreachable" });
  }
  if (upstream.status === 429) return json(429, { error: "stt_upstream_rate_limited" });
  if (!upstream.ok) return json(502, { error: "stt_upstream_failed", status: upstream.status });

  const payload = await upstream.json().catch(() => null);
  const raw = (payload as { text?: unknown } | null)?.text;
  const text = typeof raw === "string" ? raw.trim() : "";
  return json(200, { text });
}
