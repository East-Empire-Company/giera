export const MAX_OUTPUT_TOKENS = 300;
export const MAX_CONCURRENT_CONVERSATIONS = 2;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

let activeConversations = 0;
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type BackoffOptions = {
  baseMs?: number;
  maxMs?: number;
  retryAfterMs?: number | null;
  jitterRatio?: number;
  random?: () => number;
};

export function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

export function backoffDelayMs(attempt: number, options?: BackoffOptions): number {
  const base = options?.baseMs ?? 300;
  const max = options?.maxMs ?? 5000;
  const jitterRatio = options?.jitterRatio ?? 0;
  const random = options?.random ?? Math.random;
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  const retryAfter = options?.retryAfterMs;
  const delay = retryAfter === null || retryAfter === undefined ? exponential : Math.min(max, Math.max(0, retryAfter));
  if (jitterRatio <= 0) return Math.round(delay);
  const jittered = delay + delay * jitterRatio * (random() * 2 - 1);
  return Math.round(Math.max(0, Math.min(max, jittered)));
}

export type FetchBackoffOptions = {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  jitterRatio?: number;
  random?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
};

export async function fetchWithBackoff(
fetcher: FetchLike,
  url: string | URL,
  init: RequestInit,
  options?: FetchBackoffOptions
): Promise<Response> {
  const attempts = Math.max(1, options?.attempts ?? 3);
  const sleep = options?.sleepFn ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastResponse: Response | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetcher(url as RequestInfo, init);
      lastResponse = response;
      if (attempt >= attempts || !RETRYABLE_STATUS.has(response.status)) return response;
      await sleep(
        backoffDelayMs(attempt, {
          baseMs: options?.baseMs,
          maxMs: options?.maxMs,
          retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
          jitterRatio: options?.jitterRatio ?? 0.2,
          random: options?.random,
        })
      );
    } catch (error) {
      if (attempt >= attempts) throw error;
      await sleep(
        backoffDelayMs(attempt, {
          baseMs: options?.baseMs,
          maxMs: options?.maxMs,
          jitterRatio: options?.jitterRatio ?? 0.2,
          random: options?.random,
        })
      );
    }
  }
  if (lastResponse) return lastResponse;
  throw new Error("upstream request failed");
}

export function validateProxyAuth(authHeader: string | null, expectedSecret: string): boolean {
  if (expectedSecret.length === 0) return true;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  return token === expectedSecret;
}

export type ProxyOptions = {
  expectedSecret?: string;
  nexgateUrl?: string;
  nexgateKey?: string;
  model?: string;
fetchFn?: FetchLike;
};

export async function handleNemotronProxyRequest(
  req: Request,
  options?: ProxyOptions
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const expectedSecret = options?.expectedSecret ?? process.env.GIERA_PROXY_SECRET ?? "";
  const authHeader = req.headers.get("authorization");
  if (!validateProxyAuth(authHeader, expectedSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  if (activeConversations >= MAX_CONCURRENT_CONVERSATIONS) {
    return new Response(JSON.stringify({ error: "Rate limit: max 2 concurrent NPC conversations" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }

  activeConversations++;
  try {
    const rawBody = (await req.json()) as Record<string, unknown>;

    // Enforce model and token bounds
    const payload = {
      ...rawBody,
      model: options?.model ?? process.env.GIERA_NPC_MODEL ?? "nemotron-bolt",
      max_tokens: Math.min(
        MAX_OUTPUT_TOKENS,
        typeof rawBody.max_tokens === "number" ? rawBody.max_tokens : MAX_OUTPUT_TOKENS
      ),
    };

    const nexgateUrl =
      options?.nexgateUrl ??
      process.env.NEXGATE_URL ??
      "http://127.0.0.1:4000/v1/chat/completions";
    const nexgateKey =
      options?.nexgateKey ??
      process.env.NEXGATE_NEMOTRON_BOLT_API_KEY ??
      process.env.NEXGATE_OMP_API_KEY ??
      "";
    const fetcher = options?.fetchFn ?? fetch;

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (nexgateKey) {
      headers["authorization"] = `Bearer ${nexgateKey}`;
    }

    const nexgateRes = await fetchWithBackoff(fetcher, nexgateUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    return new Response(nexgateRes.body, {
      status: nexgateRes.status,
      headers: {
        "content-type": nexgateRes.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (e) {
    console.error("Nemotron proxy forwarding failed:", e);
    return new Response(JSON.stringify({ error: "Proxy forwarding error" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  } finally {
    activeConversations--;
  }
}
