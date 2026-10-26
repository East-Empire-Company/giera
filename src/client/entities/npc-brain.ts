import { fallbackLine } from "../../shared/npc-fallbacks";

export type NpcBrainReply = {
  say: string;
  tool: string | null;
  args: Record<string, unknown>;
  walk_to: { x: number; z: number } | null;
  fallback?: boolean;
};

export type NpcHistoryEntry = { role: "user" | "assistant"; content: string };

const REASON_TIMEOUT_MS = 12_000;

 export type ReasonNpcOptions = {
   attempts?: number;
   baseMs?: number;
   maxMs?: number;
  jitterRatio?: number;
  sleepFn?: (ms: number) => Promise<void>;
  fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};

export function chatterDelayMs(consecutiveFailures: number, baseMs = 20_000, maxMs = 300_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, consecutiveFailures));
}

function clientBackoffMs(attempt: number, options: ReasonNpcOptions, retryAfter: string | null): number {
  const base = options.baseMs ?? 300;
  const max = options.maxMs ?? 2000;
  const seconds = Number(retryAfter);
  const retryAfterMs = retryAfter && Number.isFinite(seconds) ? seconds * 1000 : null;
  const delay = retryAfterMs === null ? Math.min(max, base * 2 ** (attempt - 1)) : Math.min(max, retryAfterMs);
  const jitterRatio = options.jitterRatio ?? 0.2;
  return Math.round(Math.max(0, Math.min(max, delay + delay * jitterRatio * (Math.random() * 2 - 1))));
}

function fallbackNpcReply(npcId: string, message: string): NpcBrainReply {
  return { say: fallbackLine(npcId, message), tool: null, args: {}, walk_to: null, fallback: true };
}

export function parseBrainReply(raw: string): NpcBrainReply {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
      const say = typeof parsed.say === "string" ? parsed.say.trim() : "";
      if (say) {
        const tool = typeof parsed.tool === "string" && parsed.tool.length > 0 ? parsed.tool : null;
        const args =
          parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
            ? (parsed.args as Record<string, unknown>)
            : {};
        let walk_to: { x: number; z: number } | null = null;
        if (parsed.walk_to && typeof parsed.walk_to === "object" && !Array.isArray(parsed.walk_to)) {
          const w = parsed.walk_to as Record<string, unknown>;
          if (Number.isFinite(w.x) && Number.isFinite(w.z)) {
            walk_to = { x: Number(w.x), z: Number(w.z) };
          }
        }
        return { say, tool, args, walk_to };
      }
    } catch {
      // malformed JSON: fall through to raw text
    }
  }
  return { say: text.slice(0, 160) || "...", tool: null, args: {}, walk_to: null };
}

export async function reasonNpc(
  npcId: string,
  message: string,
  history: NpcHistoryEntry[],
  endpoint = "/npc/reason",
  options: ReasonNpcOptions = {}
): Promise<NpcBrainReply> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const fetcher = options.fetchFn ?? fetch;
  const sleep = options.sleepFn ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (options.timeoutMs ?? REASON_TIMEOUT_MS);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return fallbackNpcReply(npcId, message);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const res = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ npcId, message, history }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; fallback?: boolean };
        const reply = parseBrainReply(data.choices?.[0]?.message?.content ?? "");
        if (data.fallback) reply.fallback = true;
        return reply;
      }
      if (attempt >= attempts || (res.status < 500 && res.status !== 429)) return fallbackNpcReply(npcId, message);
      const delay = clientBackoffMs(attempt, options, res.headers.get("retry-after"));
      if (Date.now() + delay >= deadline) return fallbackNpcReply(npcId, message);
      await sleep(delay);
    } catch {
      if (attempt >= attempts || Date.now() >= deadline) return fallbackNpcReply(npcId, message);
      const delay = clientBackoffMs(attempt, options, null);
      if (Date.now() + delay >= deadline) return fallbackNpcReply(npcId, message);
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }
  return fallbackNpcReply(npcId, message);
}

export function fallbackSay(text: string): string {
  return `Słyszę Cię! "${text}". Wspaniale, że jesteś!`;
}
