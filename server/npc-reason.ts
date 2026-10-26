import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { fallbackReplyContent } from "../src/shared/npc-fallbacks";
import { NPC_ALLOWED_TOOLS as NPC_TOOLS } from "./npc-bridge";
import { handleNemotronProxyRequest, MAX_OUTPUT_TOKENS } from "./nemotron-proxy";

const NPC_RATE_LIMIT = 10;
const NPC_RATE_WINDOW_MS = 60_000;
const npcRateBuckets = new Map<string, { count: number; windowStart: number }>();

export function resetNpcRateLimits(): void {
  npcRateBuckets.clear();
}

function npcRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = npcRateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart >= NPC_RATE_WINDOW_MS) {
    if (npcRateBuckets.size > 10_000) {
      for (const [key, b] of npcRateBuckets) {
        if (now - b.windowStart >= NPC_RATE_WINDOW_MS) npcRateBuckets.delete(key);
      }
    }
    npcRateBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > NPC_RATE_LIMIT;
}

function buildNpcSystemPrompt(npcId: string): string {
  const personaPath = resolve("agents", npcId, "prompt.md");
  const persona = existsSync(personaPath)
    ? readFileSync(personaPath, "utf8").trim()
    : "Jesteś przyjaznym NPC w grze dla dzieci.";
  const tools = NPC_TOOLS[npcId] ?? [];
  const toolList = tools.map((t) => `"${t}"`).join(" | ");
  return [
    persona,
    "",
    "Odpowiadasz WYŁĄCZNIE jedną linią poprawnego JSON, bez markdownu, bez komentarzy:",
    '{"say": "<krótka wypowiedź po polsku, maks 12 słów>", "tool": null, "walk_to": null}',
    toolList
      ? `Dostępne narzędzia (pole "tool"): ${toolList}. Przy narzędziu dodaj "args".`
      : 'Zawsze używaj "tool": null.',
    'Formaty args: give_block {"block_type": "planks"|"cobblestone"|"glass"|"iron_block", "count": 1-16}; give_quest {"step_id": "gather_wood"|"craft_planks"|"craft_sticks"|"find_stone"|"craft_tool"|"build_house"}; share_map_hint {"topic": "drewno"|"kamień"|"rzemiosło"|"domek"|"jaskinia"}.',
    'Pole "walk_to": {"x": liczba, "z": liczba} — idź tam, gdy warto pokazać coś dzieciom (np. drzewa przy zbieraniu drewna). Punkty orientacyjne: polana startowa (0,0), drzewa na północ (0,-10), staw na wschodzie (12,0), skaliste zbocze (-10,8), manekin treningowy (2,3), maszyna tycoona (-3,7).',
  ].join("\n");
}

function fallbackResponse(npcId: string, message: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: fallbackReplyContent(npcId, message) } }],
      fallback: true,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

export type NpcReasonOptions = {
  proxyFn?: (req: Request) => Promise<Response>;
  allowRequest?: (ip: string) => boolean;
};

export async function handleNpcReason(req: Request, options?: NpcReasonOptions): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const allowRequest = options?.allowRequest ?? ((requestIp: string) => !npcRateLimited(requestIp));
  let body: { npcId?: unknown; message?: unknown; history?: unknown };
  try {
    const parsed: unknown = await req.json();
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    body = parsed as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const npcId = typeof body.npcId === "string" && Object.hasOwn(NPC_TOOLS, body.npcId) ? body.npcId : "mina";
  const message = typeof body.message === "string" ? body.message.slice(0, 300) : "";
  if (!message.trim()) {
    return new Response(JSON.stringify({ error: "Empty message" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (!allowRequest(ip)) return fallbackResponse(npcId, message);
  const history = Array.isArray(body.history)
    ? (body.history as { role?: unknown; content?: unknown }[])
        .filter(
          (m) =>
            m &&
            (m.role === "assistant" || m.role === "user") &&
            typeof m.content === "string" &&
            m.content.length > 0
        )
        .slice(-6)
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: (m.content as string).slice(0, 300),
        }))
    : [];
  const payload = {
    messages: [
      { role: "system", content: buildNpcSystemPrompt(npcId) },
      ...history,
      { role: "user", content: message },
    ],
    max_tokens: MAX_OUTPUT_TOKENS,
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = req.headers.get("authorization");
  if (auth) headers.authorization = auth;
  const proxied = new Request(req.url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const proxyFn = options?.proxyFn ?? handleNemotronProxyRequest;
  try {
    const proxiedRes = await proxyFn(proxied);
    if (!proxiedRes.ok) return fallbackResponse(npcId, message);
    return proxiedRes;
  } catch {
    return fallbackResponse(npcId, message);
  }
}
