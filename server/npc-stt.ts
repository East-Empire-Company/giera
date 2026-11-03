const STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;
const RATE_LIMIT = 20;
const GLOBAL_RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; windowStart: number }>();
let globalBucket: { count: number; windowStart: number } | null = null;

export function resetNpcSttState(): void {
  buckets.clear();
  globalBucket = null;
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

function globallyRateLimited(): boolean {
  const now = Date.now();
  if (!globalBucket || now - globalBucket.windowStart >= RATE_WINDOW_MS) {
    globalBucket = { count: 1, windowStart: now };
    return false;
  }
  globalBucket.count += 1;
  return globalBucket.count > GLOBAL_RATE_LIMIT;
}

export type NpcSttOptions = {
  apiKey?: string;
  clientIp?: string;
  fetchFn?: typeof fetch;
  allowRequest?: (ip: string) => boolean;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function readBoundedBody(req: Request): Promise<{ body: Blob | null; oversized: boolean }> {
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    return { body: null, oversized: true };
  }
  if (!req.body) return { body: new Blob(), oversized: false };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (size + value.byteLength > MAX_REQUEST_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {}
        return { body: null, oversized: true };
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    return { body: null, oversized: false };
  }
  return { body: new Blob(chunks as BlobPart[]), oversized: false };
}

export async function handleNpcStt(req: Request, options?: NpcSttOptions): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const apiKey = options?.apiKey ?? process.env.ELEVEN_LABS_API_KEY ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return json(503, { error: "stt_not_configured" });
  const ip = options?.clientIp ?? "local";
  const allowRequest = options?.allowRequest ?? ((requestIp: string) => !rateLimited(requestIp));
  if (!allowRequest(ip) || globallyRateLimited()) return json(429, { error: "stt_rate_limited" });

  const bounded = await readBoundedBody(req);
  if (bounded.oversized) return json(413, { error: "stt_file_too_large" });
  if (!bounded.body) return json(400, { error: "stt_file_missing" });

  const boundedRequest = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: bounded.body,
  });
  const form = await boundedRequest.formData().catch(() => null);
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
