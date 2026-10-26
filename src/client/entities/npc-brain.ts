export type NpcBrainReply = {
  say: string;
  tool: string | null;
  args: Record<string, unknown>;
  walk_to: { x: number; z: number } | null;
};

export type NpcHistoryEntry = { role: "user" | "assistant"; content: string };

const REASON_TIMEOUT_MS = 12_000;

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
  endpoint = "/npc/reason"
): Promise<NpcBrainReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REASON_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ npcId, message, history }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`NPC reason failed: ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    return parseBrainReply(content);
  } finally {
    clearTimeout(timer);
  }
}

export function fallbackSay(text: string): string {
  return `Słyszę Cię! "${text}". Wspaniale, że jesteś!`;
}
