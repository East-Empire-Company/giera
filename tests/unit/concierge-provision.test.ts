import { describe, expect, it } from "vitest";

import { syncConciergeAgent, TATA_FIRST_MESSAGE, TATA_PROMPT, type ConciergeAgentMetadata } from "../../scripts/provision-concierge-agent";

const AGENT_ID = "agent_test8301m66hjzfde0evm57tnz49jgfa";
const OLD_VOICE = "pt0Iailp6NXMdRw1n3c5";
const NEW_VOICE = "g8ymBGa3H7MD1ZqxWnhV";
const TOOL_IDS = ["tool_a", "tool_b", "tool_c"];

const PROMPT_BODY = `Grasz z Ziemkiem i Gniewkiem (to twoje małe ziomy/kapuchy). Mów krótko, energicznie: max dwa zdania na raz!

Zasady:
- Zawsze mów po polsku.`;

type AgentResponse = {
  agent_id: string;
  name: string;
  version_id: string;
  conversation_config: Record<string, unknown>;
  platform_settings?: Record<string, unknown>;
  tags?: string[];
};

const buildAgent = (overrides: Partial<AgentResponse> = {}): AgentResponse => ({
  agent_id: AGENT_ID,
  name: "Iskra — Giera",
  version_id: "agtvrsn_test_v1",
  conversation_config: {
    asr: { quality: "high", provider: "scribe_realtime", user_input_audio_format: "pcm_16000", keywords: [], keyterm_libraries: [] },
    turn: {
      turn_timeout: 8,
      initial_wait_time: null,
      silence_end_call_timeout: -1,
      mode: "turn",
      turn_eagerness: "patient",
      spelling_patience: "auto",
      speculative_turn: true,
      retranscribe_on_turn_timeout: false,
      turn_model: "turn_v3",
      interruption_ignore_terms: ["mhm", "ok"],
      interruption_ignore_term_languages: ["pl"],
      merge_with_default_ignore_terms: false,
      transcribe_on_disabled_interruptions: false,
      soft_timeout_config: { timeout_seconds: -1, message: "Hhmmmm...yeah.", additional_soft_timeout_messages: [], use_llm_generated_message: false, randomize_fillers: false, max_soft_timeouts_per_generation: 1, llm_generated_message_prompt_override: null, disable_until_first_user_message: false },
      noisy_environment_detection: false,
      noisy_environment_message: "Uhh ... sorry, I'm picking up some noise in the background. Could you move somewhere quieter?",
    },
    tts: {
      model_id: "eleven_flash_v2_5",
      voice_id: OLD_VOICE,
      supported_voices: [],
      expressive_mode: false,
      suggested_audio_tags: [],
      agent_output_audio_format: "pcm_16000",
      optimize_streaming_latency: 3,
      stability: 0.25,
      speed: 1,
      similarity_boost: 0.75,
      clone_strength: 0,
      text_normalisation_type: "system_prompt",
      pronunciation_dictionary_locators: [],
      enable_phoneme_tags: true,
      audio_effects: null,
    },
    conversation: {
      text_only: false,
      max_duration_seconds: 600,
      max_duration_seconds_after_last_agent_message: null,
      client_events: ["audio", "interruption", "agent_response", "user_transcript", "agent_response_correction", "agent_tool_response"],
      file_input: { enabled: true, max_files_in_memory: 10, max_files_per_conversation: 10 },
      monitoring_enabled: false,
      monitoring_events: ["user_transcript"],
      dtmf_input_settings: null,
      background_sound: { source_type: null, source_id: null, volume: 0.15, crossfade_loop: true },
      compaction: { enabled: null, soft_trigger_fraction: null, tail_size: null, min_reclaimable_tokens: null },
      source_attribution: false,
    },
    language_presets: {},
    vad: { background_voice_detection: true },
    realtime_model: "eleven_realtime_v1_max",
    agent: {
      first_message: "Siema, kapuchy. Jestem Iskra, dawaj do gry!",
      language: "pl",
      hinglish_mode: false,
      dynamic_variables: { dynamic_variable_placeholders: {} },
      disable_first_message_interruptions: false,
      max_conversation_duration_message: "",
      silence_end_call_message: "",
      text_behavior_overrides: { whatsapp: { verbosity: null, output_format: null, interaction_budget: null, disable_max_duration: true } },
      subagent_config: { agents: [], self_subagent: null },
      prompt: {
        prompt: `Jesteś Iskrą, małym megakozackim robotem w grze Giera. Masz totalny sigma rizz.\n${PROMPT_BODY}`,
        llm: "gemini-2.0-flash",
        reasoning_effort: null,
        service_tier: "standard",
        opener: null,
        thinking_budget: null,
        enable_reasoning_summary: true,
        temperature: 0.81,
        max_tokens: -1,
        tool_ids: TOOL_IDS,
        tool_ids_strict: false,
        built_in_tools: {},
        rich_content: false,
        enable_parallel_tool_calls: true,
        mcp_server_ids: [],
        native_mcp_server_ids: [],
        knowledge_base: null,
        custom_llm: null,
        bedrock_llm: null,
        speech_engine: null,
        ignore_default_personality: false,
        rag: null,
        timezone: null,
        backup_llm_config: null,
        cascade_timeout_seconds: null,
        tools: [{ id: "tool_a", tool_config: { name: "set_split_screen" } }],
      },
    },
  },
  platform_settings: { overrides: { conversation_config_override: { agent: { first_message: true } } } },
  tags: [],
  ...overrides,
});

const buildDesiredAgent = (): AgentResponse => {
  const agent = buildAgent();
  const cc = agent.conversation_config;
  agent.name = "Tata — Giera";
  (cc.tts as Record<string, unknown>).voice_id = NEW_VOICE;
  const agentCfg = cc.agent as Record<string, unknown>;
  agentCfg.first_message = "Siema, kapuchy. Jestem Tata, dawaj do gry!";
  const prompt = agentCfg.prompt as Record<string, unknown>;
  prompt.prompt = `Jesteś Tatą, małym megakozackim robotem.\n${PROMPT_BODY}`;
  return agent;
};

const buildPatchedAgent = (): AgentResponse => {
  const agent = buildDesiredAgent();
  const agentCfg = agent.conversation_config.agent as Record<string, unknown>;
  (agentCfg.prompt as Record<string, unknown>).prompt = TATA_PROMPT;
  agentCfg.first_message = TATA_FIRST_MESSAGE;
  return agent;
};

type Step = { status: number; body: unknown };
type Call = { method: string; url: string; body?: unknown };

const runSync = async (steps: Step[], patchStatus = 200) => {
  const calls: Call[] = [];
  let patchBody: Record<string, unknown> | undefined;
  let getIndex = 0;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const call: Call = { method, url };
    if (init?.body != null) call.body = JSON.parse(String(init.body));
    calls.push(call);
    if (method === "PATCH" || method === "POST") {
      if (method === "PATCH") patchBody = call.body as Record<string, unknown>;
      if (patchStatus !== 200) return new Response("boom", { status: patchStatus });
      return new Response(JSON.stringify({ agent_id: AGENT_ID }), { status: 200 });
    }
    const step = steps[Math.min(getIndex, steps.length - 1)];
    getIndex += 1;
    return new Response(step.status === 200 ? JSON.stringify(step.body) : "error", { status: step.status });
  }) as unknown as typeof fetch;
  let result: ConciergeAgentMetadata | undefined;
  let error: unknown;
  try {
    result = await syncConciergeAgent(AGENT_ID, "test-key", fetchFn);
  } catch (caught) {
    error = caught;
  }
  return { result, error, calls, patchBody: () => patchBody };
};

const voiceOk = (): Step => ({ status: 200, body: { voice_id: NEW_VOICE, name: "JakubPro" } });
const agentGet = (agent: AgentResponse = buildAgent()): Step => ({ status: 200, body: agent });

const patchCalls = (calls: Call[]) => calls.filter((c) => c.method === "PATCH");

describe("syncConciergeAgent", () => {
  it("targets the configured agent id and never lists agents, mutates tools, or creates agents", async () => {
    const { result, error, calls } = await runSync([agentGet(), voiceOk(), agentGet(), agentGet(buildPatchedAgent())]);
    expect(error).toBeUndefined();
    expect(result).toEqual({ agentId: AGENT_ID, name: "Tata — Giera", voiceId: NEW_VOICE, tools: TOOL_IDS });
    expect(patchCalls(calls)).toHaveLength(1);
    for (const call of calls) {
      expect(call.url).not.toContain("/convai/agents?");
      expect(call.url).not.toContain("/convai/tools");
      expect(call.url).not.toContain("/agents/create");
    }
  });

  it("patches only name, prompt, greeting, and voice while preserving every other input field", async () => {
    const { error, patchBody } = await runSync([agentGet(), voiceOk(), agentGet(), agentGet(buildPatchedAgent())]);
    expect(error).toBeUndefined();
    const body = patchBody();
    expect(body?.name).toBe("Tata — Giera");
    expect(body?.platform_settings).toBeUndefined();

    const cc = body?.conversation_config as Record<string, any>;
    expect(cc.realtime_model).toBeUndefined();
    expect(cc.agent.first_message).toBe("Siema, kapuchy. Jestem Tata, dawaj do gry!");
    expect(cc.tts.voice_id).toBe(NEW_VOICE);
    expect(cc.tts.clone_strength).toBeUndefined();
    expect(cc.tts.stability).toBe(0.25);
    expect(cc.tts.optimize_streaming_latency).toBe(3);
    const prompt = cc.agent.prompt;
    expect(prompt.prompt.startsWith("Jesteś Tatą")).toBe(true);
    expect(prompt.prompt.includes("Iskra")).toBe(false);
    expect(prompt.tools).toBeUndefined();
    expect(prompt.opener).toBeUndefined();
    expect(prompt.rich_content).toBeUndefined();
    expect(prompt.bedrock_llm).toBeUndefined();
    expect(prompt.speech_engine).toBeUndefined();
    expect(prompt.tool_ids).toEqual(TOOL_IDS);
    expect(prompt.llm).toBe("gemini-2.0-flash");
    expect(prompt.temperature).toBe(0.81);
    expect(prompt.built_in_tools).toEqual({});

    expect(cc.asr).toEqual({ quality: "high", provider: "scribe_realtime", user_input_audio_format: "pcm_16000", keywords: [] });
    expect(cc.turn.mode).toBe("turn");
    expect(cc.turn.noisy_environment_message).toContain("noise in the background");
    expect(cc.turn.turn_timeout).toBe(8);
    expect(cc.vad).toEqual({ background_voice_detection: true });
    expect(cc.conversation.max_duration_seconds).toBe(600);
    expect(cc.conversation.compaction).toBeUndefined();
    expect((cc.agent as Record<string, unknown>).silence_end_call_message).toBeUndefined();
    expect((cc.agent as Record<string, unknown>).subagent_config).toBeUndefined();
  });

  it("rejects unknown schema before mutating", async () => {
    const agent = buildAgent();
    (agent.conversation_config as Record<string, unknown>).zz_unknown_field = { surprise: true };
    const { error, calls } = await runSync([agentGet(agent), voiceOk()]);
    expect(error).toBeInstanceOf(Error);
    expect(patchCalls(calls)).toHaveLength(0);
  });

  it("rejects when the version changes between reads", async () => {
    const second = buildAgent({ version_id: "agtvrsn_test_v2" });
    const { error, calls } = await runSync([agentGet(), voiceOk(), agentGet(second)]);
    expect(error).toBeInstanceOf(Error);
    expect(patchCalls(calls)).toHaveLength(0);
  });

  it("finishes without patching when the desired state already exists", async () => {
    const { result, error, calls } = await runSync([agentGet(buildDesiredAgent()), voiceOk()]);
    expect(error).toBeUndefined();
    expect(result?.voiceId).toBe(NEW_VOICE);
    expect(result?.name).toBe("Tata — Giera");
    expect(patchCalls(calls)).toHaveLength(0);
  });

  it("rejects on provider failure and never creates a replacement", async () => {
    const { error, calls } = await runSync([agentGet(), voiceOk(), agentGet(), agentGet(buildPatchedAgent())], 500);
    expect(error).toBeInstanceOf(Error);
    expect(calls.some((c) => c.url.includes("/agents/create") || c.method === "POST")).toBe(false);
  });

  it("rejects when the current prompt is neither Iskra nor Tata", async () => {
    const agent = buildAgent();
    const cc = agent.conversation_config as { agent: { prompt: { prompt: string } } };
    cc.agent.prompt.prompt = "Jesteś kimś innym zupełnie.";
    const { error, calls } = await runSync([agentGet(agent), voiceOk()]);
    expect(error).toBeInstanceOf(Error);
    expect(patchCalls(calls)).toHaveLength(0);
  });

  it("rejects when the target voice is unavailable", async () => {
    const { error, calls } = await runSync([agentGet(), { status: 404, body: { detail: { status: "not_found" } } }]);
    expect(error).toBeInstanceOf(Error);
    expect(patchCalls(calls)).toHaveLength(0);
  });

  it("rejects when preserved settings change after the patch", async () => {
    const after = buildAgent();
    const cc = after.conversation_config as { agent: { prompt: { tool_ids: string[] } } };
    cc.agent.prompt.tool_ids = ["tool_z"];
    const { error } = await runSync([agentGet(), voiceOk(), agentGet(), agentGet(after)]);
    expect(error).toBeInstanceOf(Error);
  });

  it("rejects when the fetched agent id does not match", async () => {
    const { error, calls } = await runSync([agentGet(buildAgent({ agent_id: "agent_other" }))]);
    expect(error).toBeInstanceOf(Error);
    expect(patchCalls(calls)).toHaveLength(0);
  });
});
