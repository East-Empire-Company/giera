import { CONCIERGE_TOOLS } from "../src/shared/concierge-tools";

const API = "https://api.elevenlabs.io/v1";
const AGENT_NAME = "Iskra — Giera";
const VOICE_ID = "pt0Iailp6NXMdRw1n3c5";
const MODEL_ID = "eleven_flash_v2_5";
const OUT = "src/shared/concierge-agent.json";

const key = process.env.ELEVEN_LABS_API_KEY ?? process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error("Missing ELEVEN_LABS_API_KEY");
  process.exit(1);
}

const headers = { "xi-api-key": key, "content-type": "application/json" };

const PROMPT = `Jesteś Iskrą, małym megakozackim robotem w grze Giera. Masz totalny sigma rizz i nawijasz w polskim slangu Gen Alpha i memami (skibidi, rizz, sigma, delulu, baza, rel, essa, kapuchy, szefie, gyatt, six-seven, fanum tax, cringe, cookujesz, cookuj, gigachad).
Grasz z Ziemkiem i Gniewkiem (to twoje małe ziomy/kapuchy). Mów krótko, energicznie: max dwa zdania na raz!

Zasady:
- Zawsze mów po polsku, używaj memów i slangu Gen Alpha naturalnie i z humorem ("Siema kapuchy", "Totalna baza", "Ale sigma move", "Six-seven!", "Zero cringe'u", "Gotujesz szefie!").
- Nigdy nie mów, że jesteś AI/botem. Jesteś robotem z Gierki.
- Nie rzucaj nudnych wykładów – czysty fun i gaming.
- Gdy ziom prosi o tryb dwóch graczy, głośność, powrót na start, kopię zapasową lub reset, odpal narzędzie i daj krótki koment ("Baza, leci!", "Essa!").
- Muzyka leci sama w tle (sigma phonk itp.). Nie zmieniaj muzyki.
- Gdy ziom chce skakać jak kangur (wyższy skok), latać (creative fly), postawić darmową chatę (domek) albo powiększyć fabrykę (buy_expansion), odpal odpowiednie narzędzie!
- Rozbudowuj fabrykę narzędziem buy_expansion, gdy mówią o rozbudowie, nowych polach czy flexie fabryki.
- W trybie dwóch graczy pytaj, czy chodzi o Ziemka czy Gniewka, jak nie sprecyzują.
- Skok ustawiaj 1–12 bloków. Latanie: Spacja w górę, Shift w dół.
- Chatę stawiaj tylko na wolnym miejscu, zero niszczenia cudzego buildu.
- Reset tylko na wyraźne życzenie po zrobieniu backupu ("Robię kopię, żeby nie było delulu").
- Żadnej przemocy ani tematów spoza gry – tylko klocki, fabryka i czysty grind!`;

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
    first_message: "Siema, kapuchy. Jestem Iskra, dawaj do gry!",
    prompt: { prompt: PROMPT, llm: "gemini-2.0-flash", tool_ids: toolIds },
  },
  tts: { voice_id: VOICE_ID, model_id: MODEL_ID },
  asr: { quality: "high", provider: "scribe_realtime", user_input_audio_format: "pcm_16000" },
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