export const MAX_OUTPUT_TOKENS = 300;
export const MAX_CONCURRENT_CONVERSATIONS = 2;

let activeConversations = 0;

export function validateProxyAuth(authHeader: string | null, expectedSecret: string): boolean {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  return token === expectedSecret && expectedSecret.length > 0;
}

export type ProxyOptions = {
  expectedSecret?: string;
  nexgateUrl?: string;
  nexgateKey?: string;
  fetchFn?: typeof fetch;
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
      model: "nemotron-bolt",
      max_tokens: Math.min(
        MAX_OUTPUT_TOKENS,
        typeof rawBody.max_tokens === "number" ? rawBody.max_tokens : MAX_OUTPUT_TOKENS
      ),
    };

    const nexgateUrl = options?.nexgateUrl ?? "http://127.0.0.1:4000/v1/chat/completions";
    const nexgateKey = options?.nexgateKey ?? process.env.NEXGATE_NEMOTRON_BOLT_API_KEY ?? "";
    const fetcher = options?.fetchFn ?? fetch;

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (nexgateKey) {
      headers["authorization"] = `Bearer ${nexgateKey}`;
    }

    const nexgateRes = await fetcher(nexgateUrl, {
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
