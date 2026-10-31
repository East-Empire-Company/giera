import agentConfig from "../src/shared/concierge-agent.json";

const ELEVENLABS_API = "https://api.elevenlabs.io/v1";
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; windowStart: number }>();

export function resetConciergeRateLimits(): void {
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

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export type ConciergeSessionOptions = {
  fetchFn?: typeof fetch;
  apiKey?: string;
  allowRequest?: (ip: string) => boolean;
};

export async function handleConciergeSession(req: Request, options: ConciergeSessionOptions = {}): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const apiKey = options.apiKey ?? process.env.ELEVEN_LABS_API_KEY ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return json({ error: "concierge_not_configured" }, 503);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const allow = options.allowRequest ?? ((requestIp: string) => !rateLimited(requestIp));
  if (!allow(ip)) return json({ error: "rate_limited" }, 429);

  const fetchFn = options.fetchFn ?? fetch;
  const url = `${ELEVENLABS_API}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentConfig.agentId)}`;
  try {
    const upstream = await fetchFn(url, { headers: { "xi-api-key": apiKey } });
    if (!upstream.ok) {
      return json({ error: "signed_url_failed", status: upstream.status }, 502);
    }
    const body = (await upstream.json()) as { signed_url?: string };
    if (!body.signed_url) return json({ error: "signed_url_missing" }, 502);
    return json({ signedUrl: body.signed_url, agentId: agentConfig.agentId });
  } catch {
    return json({ error: "signed_url_unreachable" }, 502);
  }
}