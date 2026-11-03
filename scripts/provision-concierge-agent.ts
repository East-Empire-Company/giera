const API = "https://api.elevenlabs.io/v1";
const AGENT_NAME = "Tata — Giera";
const VOICE_ID = "g8ymBGa3H7MD1ZqxWnhV";
const MODEL_ID = "eleven_flash_v2_5";
const FIRST_MESSAGE = "Siema, kapuchy. Jestem Tata, dawaj do gry!";
const OUT = new URL("../src/shared/concierge-agent.json", import.meta.url);

export const TATA_FIRST_MESSAGE = FIRST_MESSAGE;

export const TATA_PROMPT = `Jesteś Tatą, małym megakozackim robotem w grze Giera. Masz totalny sigma rizz i nawijasz w polskim slangu Gen Alpha i memami (skibidi, rizz, sigma, delulu, baza, rel, essa, kapuchy, szefie, six-seven, fanum tax, cringe, cookujesz, cookuj, gigachad).
Grasz z Ziemkiem i Gniewkiem (to twoje małe ziomy/kapuchy). Mów krótko, energicznie: max dwa zdania na raz!

Zasady:
- Zawsze mów po polsku, używaj memów i slangu Gen Alpha naturalnie i z humorem ("Siema kapuchy", "Totalna baza", "Ale sigma move", "Six-seven!", "Zero cringe'u", "Gotujesz szefie!").
- Nigdy nie mów, że jesteś AI/botem. Jesteś robotem z Gierki.
- Nie rzucaj nudnych wykładów – czysty fun i gaming.
- Gdy ziom prosi o tryb dwóch graczy, głośność, powrót na start, kopię zapasową lub reset, odpal narzędzie i daj krótki koment ("Baza, leci!", "Essa!").
- Muzyka leci sama w tle (sigma phonk itp.). Nie zmieniaj muzyki.
:- Gdy ziom chce skakać jak kangur (wyższy skok), latać (creative fly), postawić chatę albo wieżę, albo wykopać kopalnię, odpal odpowiednie narzędzie!
- Rozbudowuj fabrykę narzędziem buy_expansion, gdy mówią o rozbudowie, nowych polach czy flexie fabryki.
- W trybie dwóch graczy pytaj, czy chodzi o Ziemka czy Gniewka, jak nie sprecyzują.
- Skok ustawiaj 1–12 bloków. Latanie: Spacja w górę, Shift w dół.
:- Domek stawiaj tylko na wolnym miejscu, zero niszczenia cudzego buildu. Wieża może powstać po prośbie o wieżę lub punkt obserwacyjny. Kopalnię rób wyłącznie na prośbę o tunel lub kopalnię; dig_mine usuwa tylko niezmienione naturalne bloki i nigdy nie przecina cudzych zmian, drewna, wody ani bedrocku.
- Reset tylko na wyraźne życzenie po zrobieniu backupu ("Robię kopię, żeby nie było delulu").
- Żadnej przemocy ani tematów spoza gry – tylko klocki, fabryka i czysty grind!`;

type Json = Record<string, unknown>;

const keys = (list: string[]): Set<string> => new Set(list);

const CC_INPUT = keys(["asr", "turn", "tts", "conversation", "language_presets", "vad", "agent"]);
const CC_OUTPUT_ONLY = keys(["realtime_model"]);
const ASR_INPUT = keys(["quality", "provider", "user_input_audio_format", "keywords"]);
const ASR_OUTPUT_ONLY = keys(["keyterm_libraries"]);
const TURN_INPUT = keys([
  "turn_timeout", "initial_wait_time", "silence_end_call_timeout", "mode", "turn_eagerness", "spelling_patience",
  "speculative_turn", "retranscribe_on_turn_timeout", "turn_model", "interruption_ignore_terms",
  "interruption_ignore_term_languages", "merge_with_default_ignore_terms", "transcribe_on_disabled_interruptions",
  "soft_timeout_config", "noisy_environment_detection", "noisy_environment_message",
]);
const TTS_INPUT = keys([
  "model_id", "voice_id", "supported_voices", "expressive_mode", "suggested_audio_tags", "agent_output_audio_format",
  "stability", "speed", "similarity_boost", "text_normalisation_type", "pronunciation_dictionary_locators",
  "enable_phoneme_tags", "audio_effects", "optimize_streaming_latency",
]);
const TTS_OUTPUT_ONLY = keys(["clone_strength"]);
const CONVERSATION_INPUT = keys([
  "text_only", "max_duration_seconds", "client_events", "file_input", "monitoring_enabled", "monitoring_events",
  "dtmf_input_settings", "background_sound", "source_attribution",
]);
const CONVERSATION_OUTPUT_ONLY = keys(["max_duration_seconds_after_last_agent_message", "compaction"]);
const VAD_INPUT = keys(["background_voice_detection"]);
const AGENT_INPUT = keys([
  "first_message", "language", "hinglish_mode", "dynamic_variables", "disable_first_message_interruptions",
  "max_conversation_duration_message", "text_behavior_overrides", "prompt",
]);
const AGENT_OUTPUT_ONLY = keys(["silence_end_call_message", "subagent_config"]);
const PROMPT_INPUT = keys([
  "prompt", "llm", "reasoning_effort", "service_tier", "thinking_budget", "enable_reasoning_summary", "temperature",
  "max_tokens", "tool_ids", "tool_ids_strict", "built_in_tools", "enable_parallel_tool_calls", "mcp_server_ids",
  "native_mcp_server_ids", "knowledge_base", "custom_llm", "ignore_default_personality", "rag", "timezone",
  "backup_llm_config", "cascade_timeout_seconds",
]);
const PROMPT_OUTPUT_ONLY = keys(["tools", "opener", "rich_content", "bedrock_llm", "speech_engine"]);

const obj = (value: unknown, path: string): Json => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`missing ${path}`);
  return value as Json;
};

const mapLevel = (value: Json, inputKeys: Set<string>, outputOnly: Set<string>, path: string): Json => {
  const mapped: Json = {};
  for (const [key, val] of Object.entries(value)) {
    if (outputOnly.has(key)) continue;
    if (!inputKeys.has(key)) throw new Error(`unmapped agent field ${path}.${key}`);
    mapped[key] = structuredClone(val);
  }
  return mapped;
};

const mapConversationConfig = (cc: Json): Json => {
  const mapped: Json = {};
  for (const [key, val] of Object.entries(cc)) {
    if (CC_OUTPUT_ONLY.has(key)) continue;
    if (!CC_INPUT.has(key)) throw new Error(`unmapped agent field conversation_config.${key}`);
    if (key === "asr") mapped[key] = mapLevel(obj(val, "asr"), ASR_INPUT, ASR_OUTPUT_ONLY, "conversation_config.asr");
    else if (key === "turn") mapped[key] = mapLevel(obj(val, "turn"), TURN_INPUT, new Set(), "conversation_config.turn");
    else if (key === "tts") mapped[key] = mapLevel(obj(val, "tts"), TTS_INPUT, TTS_OUTPUT_ONLY, "conversation_config.tts");
    else if (key === "conversation") mapped[key] = mapLevel(obj(val, "conversation"), CONVERSATION_INPUT, CONVERSATION_OUTPUT_ONLY, "conversation_config.conversation");
    else if (key === "vad") mapped[key] = mapLevel(obj(val, "vad"), VAD_INPUT, new Set(), "conversation_config.vad");
    else mapped[key] = structuredClone(val);
  }
  const agent = mapLevel(obj(cc.agent, "agent"), AGENT_INPUT, AGENT_OUTPUT_ONLY, "conversation_config.agent");
  const prompt = obj(agent.prompt, "agent.prompt");
  agent.prompt = mapLevel(prompt, PROMPT_INPUT, PROMPT_OUTPUT_ONLY, "conversation_config.agent.prompt");
  mapped.agent = agent;
  return mapped;
};

const outputOnlyValues = (cc: Json): Json => {
  const picked: Json = {};
  picked.realtime_model = structuredClone(cc.realtime_model);
  const tts = obj(cc.tts, "tts");
  picked.clone_strength = structuredClone(tts.clone_strength);
  const agent = obj(cc.agent, "agent");
  picked.silence_end_call_message = structuredClone(agent.silence_end_call_message);
  picked.subagent_config = structuredClone(agent.subagent_config);
  const prompt = obj(agent.prompt, "agent.prompt");
  picked.opener = structuredClone(prompt.opener);
  picked.rich_content = structuredClone(prompt.rich_content);
  picked.bedrock_llm = structuredClone(prompt.bedrock_llm);
  picked.speech_engine = structuredClone(prompt.speech_engine);
  const asr = obj(cc.asr, "asr");
  picked.keyterm_libraries = structuredClone(asr.keyterm_libraries);
  const conversation = obj(cc.conversation, "conversation");
  picked.compaction = structuredClone(conversation.compaction);
  picked.max_duration_seconds_after_last_agent_message = structuredClone(conversation.max_duration_seconds_after_last_agent_message);
  return picked;
};

const isPlainObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const firstDiffPath = (a: unknown, b: unknown, path: string): string | null => {
  if (a === b) return null;
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const key of Object.keys(b).sort()) {
      const diff = firstDiffPath(key in a ? a[key] : undefined, b[key], `${path}.${key}`);
      if (diff) return diff;
    }
    return null;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path} (length ${a.length} != ${b.length})`;
    for (let i = 0; i < a.length; i++) {
      const diff = firstDiffPath(a[i], b[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  return path;
};

export type ConciergeAgentMetadata = { agentId: string; name: string; voiceId: string; tools: string[] };

const headers = (apiKey: string) => ({ "xi-api-key": apiKey, "content-type": "application/json" });

const getAgent = async (agentId: string, apiKey: string, fetchFn: typeof fetch): Promise<Json> => {
  const res = await fetchFn(`${API}/convai/agents/${agentId}`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(`get agent ${res.status}: ${await res.text()}`);
  return (await res.json()) as Json;
};

const assertVoiceAvailable = async (apiKey: string, fetchFn: typeof fetch): Promise<void> => {
  const res = await fetchFn(`${API}/voices/${VOICE_ID}`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(`voice ${VOICE_ID} unavailable (${res.status})`);
  const body = (await res.json()) as { voice_id?: string };
  if (body.voice_id !== VOICE_ID) throw new Error(`voice lookup returned ${body.voice_id ?? "nothing"}`);
};

const isDesired = (agent: Json): boolean => {
  if (agent.name !== AGENT_NAME) return false;
  const cc = agent.conversation_config;
  if (!isPlainObject(cc)) return false;
  const tts = cc.tts;
  const agentCfg = cc.agent;
  if (!isPlainObject(tts) || !isPlainObject(agentCfg)) return false;
  if (tts.voice_id !== VOICE_ID) return false;
  if (agentCfg.first_message !== FIRST_MESSAGE) return false;
  const prompt = agentCfg.prompt;
  if (!isPlainObject(prompt) || typeof prompt.prompt !== "string") return false;
  return prompt.prompt.includes("Jesteś Tatą") && !prompt.prompt.includes("Iskra");
};

export async function syncConciergeAgent(agentId: string, apiKey: string, fetchFn: typeof fetch): Promise<ConciergeAgentMetadata> {
  const current = await getAgent(agentId, apiKey, fetchFn);
  if (current.agent_id !== agentId) throw new Error(`agent id mismatch: fetched ${String(current.agent_id)}`);
  const versionId = current.version_id;
  if (typeof versionId !== "string" || !versionId) throw new Error("agent is missing version_id");
  const currentCc = obj(current.conversation_config, "conversation_config");

  await assertVoiceAvailable(apiKey, fetchFn);

  const agentCfg = obj(currentCc.agent, "conversation_config.agent");
  const promptCfg = obj(agentCfg.prompt, "conversation_config.agent.prompt");
  const toolIds = promptCfg.tool_ids;
  if (!Array.isArray(toolIds) || toolIds.length === 0 || !toolIds.every((id) => typeof id === "string")) {
    throw new Error("agent prompt has no usable tool_ids");
  }
  const promptText = promptCfg.prompt;
  if (typeof promptText !== "string") throw new Error("agent prompt is not a string");

  if (isDesired(current)) return { agentId, name: AGENT_NAME, voiceId: VOICE_ID, tools: toolIds };

  if ((promptText.match(/Jesteś Iskrą/g) ?? []).length !== 1) {
    throw new Error("expected exactly one Jesteś Iskrą prompt occurrence before renaming");
  }

  const mapped = mapConversationConfig(currentCc);
  const edited = applyDesiredEdits(mapped);

  const latest = await getAgent(agentId, apiKey, fetchFn);
  if (latest.version_id !== versionId) {
    throw new Error(`agent changed between reads (${versionId} -> ${String(latest.version_id)}); aborting`);
  }

  const res = await fetchFn(`${API}/convai/agents/${agentId}`, {
    method: "PATCH",
    headers: headers(apiKey),
    body: JSON.stringify({ name: AGENT_NAME, conversation_config: edited }),
  });
  if (!res.ok) throw new Error(`update agent ${res.status}: ${await res.text()}`);

  const after = await getAgent(agentId, apiKey, fetchFn);
  if (after.agent_id !== agentId) throw new Error(`agent id mismatch after update: ${String(after.agent_id)}`);
  const afterCc = obj(after.conversation_config, "conversation_config");
  const afterMapped = mapConversationConfig(afterCc);
  const diff = firstDiffPath(afterMapped, edited, "conversation_config");
  if (diff) throw new Error(`post-update verification failed at ${diff}`);
  const afterOutputOnly = outputOnlyValues(afterCc);
  const beforeOutputOnly = outputOnlyValues(currentCc);
  const outputDiff = firstDiffPath(afterOutputOnly, beforeOutputOnly, "output_only");
  if (outputDiff) throw new Error(`output-only field changed unexpectedly at ${outputDiff}`);

  return { agentId, name: AGENT_NAME, voiceId: VOICE_ID, tools: toolIds };
}

const applyDesiredEdits = (mapped: Json): Json => {
  const edited = structuredClone(mapped);
  const agentCfg = obj(edited.agent, "conversation_config.agent");
  agentCfg.first_message = FIRST_MESSAGE;
  const tts = obj(edited.tts, "conversation_config.tts");
  tts.voice_id = VOICE_ID;
  const prompt = obj(agentCfg.prompt, "conversation_config.agent.prompt");
  prompt.prompt = TATA_PROMPT;
  return edited;
};

if (import.meta.main) {
  const key = process.env.ELEVEN_LABS_API_KEY ?? process.env.ELEVENLABS_API_KEY;
  if (!key) {
    console.error("Missing ELEVEN_LABS_API_KEY");
    process.exit(1);
  }
  const config = (JSON.parse(await Bun.file(OUT).text())) as { agentId?: string };
  if (!config.agentId) {
    console.error("Missing agentId in src/shared/concierge-agent.json");
    process.exit(1);
  }
  const metadata = await syncConciergeAgent(config.agentId, key, fetch);
  await Bun.write(OUT, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`verified agent ${metadata.agentId} (voice ${metadata.voiceId}, model ${MODEL_ID}) with ${metadata.tools.length} client tools`);
}
