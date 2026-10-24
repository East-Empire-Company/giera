import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const AGENT_IDS = ["mina", "staszek", "papuga"];

describe("ElevenLabs Agent configurations", () => {
  for (const id of AGENT_IDS) {
    it(`validates ${id} agent.json meets safety, language, and zero-script rules`, () => {
      const path = resolve(`agents/${id}/agent.json`);
      const config = JSON.parse(readFileSync(path, "utf-8"));

      // Zero-script rule: first_message MUST be empty
      expect(config.conversation_config.agent.first_message).toBe("");

      // Language MUST be Polish
      expect(config.conversation_config.agent.language).toBe("pl");

      // Model MUST be custom-llm pointing to nemotron-bolt
      expect(config.conversation_config.agent.prompt.llm).toBe("custom-llm");
      expect(config.conversation_config.agent.prompt.custom_llm.model_id).toBe("nemotron-bolt");

      // Chat mode text-only
      expect(config.conversation_config.conversation.text_only).toBe(true);

      // Auth enabled
      expect(config.platform_settings.auth.enable_auth).toBe(true);

      // Privacy: zero retention
      expect(config.platform_settings.privacy.retention_days).toBe(0);
      expect(config.platform_settings.privacy.record_voice).toBe(false);
      expect(config.platform_settings.privacy.delete_transcript_and_pii).toBe(true);
      expect(config.platform_settings.privacy.delete_audio).toBe(true);

      // Guardrails active
      expect(config.platform_settings.guardrails.content).toBe(true);
      expect(config.platform_settings.guardrails.prompt_injection).toBe(true);
    });

    it(`validates ${id} prompt.md enforces Polish and word limits`, () => {
      const path = resolve(`agents/${id}/prompt.md`);
      const prompt = readFileSync(path, "utf-8");
      expect(prompt).toContain("polsku");
      expect(prompt).toContain("słów");
      expect(prompt).toContain("Zakaz");
    });
  }

  it("validates client tool schemas", () => {
    const tools = ["give_block", "give_quest", "share_map_hint"];
    for (const tool of tools) {
      const path = resolve(`agents/tools/${tool}.json`);
      const schema = JSON.parse(readFileSync(path, "utf-8"));
      expect(schema.type).toBe("client");
      expect(schema.name).toBe(tool);
      expect(schema.parameters.type).toBe("object");
      expect(Array.isArray(schema.parameters.required)).toBe(true);
    }
  });
});
