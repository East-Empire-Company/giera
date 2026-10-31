import { CONCIERGE_TOOLS } from "../src/shared/concierge-tools";

const API = "https://api.elevenlabs.io/v1";
const AGENT_NAME = "Iskra — Giera";
const VOICE_ID = "B9cNwbQXN3s6l3nU6fqz";
const MODEL_ID = "eleven_flash_v2_5";
const OUT = "src/shared/concierge-agent.json";

const key = process.env.ELEVEN_LABS_API_KEY ?? process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error("Missing ELEVEN_LABS_API_KEY");
  process.exit(1);
}

const headers = { "xi-api-key": key, "content-type": "application/json" };

const PROMPT = `Jesteś Iskrą, małym pomocnym robotem w grze Giera. Mówisz po polsku, prostymi zdaniami.
Grasz z Ziemkiem i Gniewkiem. To małe dzieci. Mów krótko: najwyżej dwa zdania na raz.

Zasady:
- Zawsze mów po polsku, ciepło i spokojnie.
- Nigdy nie pisz, że jesteś modelem AI ani asystentem. Jesteś robotem z Gier.
- Nie czytaj długich list. Mów jak do dziecka, które nie umie czytać.
- Gdy dziecko prosi o tryb dwóch graczy, głośność, powrót na start, kopię zapasową lub reset, użyj narzędzia i potwierdź krótko.
- Muzyka gra sama w tle. Nie proponuj zmiany utworu.
- Gdy prosi o wyższy skok, lot albo domek, użyj odpowiedniego narzędzia.
- W trybie dwóch graczy zapytaj, czy chodzi o Ziemka czy Gniewka, jeśli dziecko tego nie powie.
- Skok ustawiaj w granicach 1–12 bloków. W locie Spacja wznosi, Shift opuszcza.
- Domek stawiaj za darmo tylko na bezpiecznym, wolnym miejscu. Nigdy nie nadpisuj bloków.
- Reset postępów tylko wtedy, gdy dziecko wyraźnie powie, że chce zacząć od nowa. Najpierw zrób kopię zapasową.
- Jeśli nie wiesz, co zrobić, zapytaj jednym krótkim pytaniem.
- Nie rozmawiaj o przemocy, reklamach, zakupach, internecie ani o niczym poza grą. Zmień temat na grę.`;

type ToolItem = { id: string; tool_config: { name: string } };

const listTools = async (): Promise<ToolItem[]> => {
  const res = await fetch(`${API}/convai/tools?page_size=100`, { headers });
  if (!res.ok) throw new Error(`list tools ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { tools?: ToolItem[] };
  return body.tools ?? [];
};

const upsertTools = async (): Promise<string[]> => {
  const existing = await listTools();
  const ids: string[] = [];
  for (const spec of CONCIERGE_TOOLS) {
    const toolConfig = {
      type: "client",
      name: spec.name,
      description: spec.description,
      expects_response: true,
      response_timeout_secs: 20,
      parameters: spec.parameters,
    };
    const found = existing.find((tool) => tool.tool_config.name === spec.name);
    const res = found
      ? await fetch(`${API}/convai/tools/${found.id}`, { method: "PATCH", headers, body: JSON.stringify({ tool_config: toolConfig }) })
      : await fetch(`${API}/convai/tools`, { method: "POST", headers, body: JSON.stringify({ tool_config: toolConfig }) });
    if (!res.ok) throw new Error(`${found ? "update" : "create"} tool ${spec.name} ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { id?: string };
    ids.push(body.id ?? found?.id ?? "");
  }
  return ids.filter(Boolean);
};

const conversationConfig = (toolIds: string[]) => ({
  agent: {
    first_message: "Cześć! Jestem Iskra. Powiedz mi, co zrobić!",
    language: "pl",
    prompt: { prompt: PROMPT, llm: "gemini-2.0-flash", tool_ids: toolIds },
  },
  tts: { voice_id: VOICE_ID, model_id: MODEL_ID },
  asr: { quality: "high", provider: "elevenlabs", user_input_audio_format: "pcm_16000" },
  turn: { turn_timeout: 8 },
});

const findAgent = async (): Promise<string | null> => {
  const res = await fetch(`${API}/convai/agents?page_size=100`, { headers });
  if (!res.ok) throw new Error(`list agents ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { agents?: { agent_id: string; name: string }[] };
  return body.agents?.find((agent) => agent.name === AGENT_NAME)?.agent_id ?? null;
};

const toolIds = await upsertTools();
const payload = { name: AGENT_NAME, conversation_config: conversationConfig(toolIds), platform_settings: {} };
const existingId = await findAgent();
const res = existingId
  ? await fetch(`${API}/convai/agents/${existingId}`, { method: "PATCH", headers, body: JSON.stringify(payload) })
  : await fetch(`${API}/convai/agents/create`, { method: "POST", headers, body: JSON.stringify(payload) });
if (!res.ok) throw new Error(`save agent ${res.status}: ${await res.text()}`);
const body = (await res.json()) as { agent_id?: string };
const agentId = body.agent_id ?? existingId;
if (!agentId) throw new Error("Agent id missing in response");

await Bun.write(
  OUT,
  JSON.stringify({ agentId, name: AGENT_NAME, voiceId: VOICE_ID, tools: toolIds }, null, 2) + "\n",
);
console.log(`${existingId ? "updated" : "created"} agent ${agentId} with ${toolIds.length} client tools`);