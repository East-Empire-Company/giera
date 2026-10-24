import { describe, expect, it } from "vitest";
import { adoptCachedAudioEntry, audioCacheKey, assertPaidMusicAccess, legacyAudioCacheKey, parseNemotronResponse, resolveSecretValue, validateAudioManifest, voiceCopyCacheKey } from "../../scripts/generate-audio";
import sourceManifest from "../../scripts/audio-manifest.json";

describe("audio generation safeguards", () => {
  it("requires an active paid Music API subscription", () => {
    expect(() => assertPaidMusicAccess({ tier: "free", status: "active" })).toThrow("paid Music API access");
    expect(() => assertPaidMusicAccess({ tier: "creator", status: "past_due" })).toThrow("paid Music API access");
    expect(() => assertPaidMusicAccess({ tier: "starter", status: "active" })).not.toThrow();
  });

  it("uses stable request fingerprints to prevent duplicate credit spend", () => {
    const request = { kind: "sfx", id: "ui_click", text: "soft click", model_id: "eleven_text_to_sound_v2", output_format: "mp3_44100_128", duration_seconds: 1 };
    const key = audioCacheKey(request);
    expect(audioCacheKey({ ...request })).toBe(key);
    expect(audioCacheKey({ ...request, duration_seconds: 2 })).not.toBe(key);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });
  it("caches generated voice copy by topic and model prompt version", () => {
    expect(voiceCopyCacheKey("Gather nearby wood.")).toBe(voiceCopyCacheKey("Gather nearby wood."));
    expect(voiceCopyCacheKey("Gather nearby wood.")).not.toBe(voiceCopyCacheKey("Find stone nearby."));
  });
  it("keeps generated voice copy topic-only in the source manifest", () => {
    expect(() => validateAudioManifest(sourceManifest)).not.toThrow();
    for (const entry of sourceManifest.voice) {
      expect(entry).toHaveProperty("topic");
      expect(entry).not.toHaveProperty("text");
    }
  });
  it("prefers the explicit zshrc Eleven Labs key over a stale canonical env value", () => {
    const value = resolveSecretValue(
      "ELEVENLABS_API_KEY",
      { ELEVENLABS_API_KEY: "expired" },
      { "~/.zshrc": 'export ELEVEN_LABS_API_KEY="active"', "~/.env": "ELEVENLABS_API_KEY=expired" },
    );
    expect(value).toBe("active");
  });
  it("declares Nemotron for copy and explicit ElevenLabs model formats", () => {
    expect(sourceManifest.text_model).toBe("nemotron-bolt");
    for (const entry of sourceManifest.sfx) {
      expect(entry.kind).toBe("sfx");
      expect(entry.model_id).toBe("eleven_text_to_sound_v2");
      expect(entry.output_format).toBe("mp3_44100_128");
    }
    for (const entry of sourceManifest.music) {
      expect(entry.kind).toBe("music");
      expect(entry.model_id).toBe("music_v2_5");
      expect(entry.output_format).toBe("mp3_44100_128");
    }
    for (const entry of sourceManifest.voice) {
      expect(entry.kind).toBe("voice");
      expect(entry.model_id).toBe("eleven_v4_turbo");
      expect(entry.language_code).toBe("pl");
      expect(entry.output_format).toBe("mp3_44100_128");
    }
  });
  it("rejects overlong generated speech copy", () => {
    const text = "one two three four five six seven eight nine ten eleven twelve thirteen";
    expect(() => parseNemotronResponse({ model: "nemotron-bolt", choices: [{ message: { content: text } }] })).toThrow("12-word limit");
  });
  it("parses one short generated sentence and rejects invalid gateway responses", () => {
    expect(parseNemotronResponse({ model: "nemotron-bolt", choices: [{ message: { content: "  Zbieraj drewno blisko domu.  " } }] })).toBe("Zbieraj drewno blisko domu.");
    expect(() => parseNemotronResponse({ model: "glm-5.3", choices: [{ message: { content: "fallback output" } }] })).toThrow("unexpected model");
    expect(() => parseNemotronResponse({ model: "nemotron-bolt", choices: [] })).toThrow("no generated voice copy");
  });
});
  it("recognizes audio files generated before manifest parameters were explicit", () => {
    const request = { kind: "sfx", id: "dig_grass", text: "short soft turf impact, small shovel bite, dull, no music", model_id: "eleven_text_to_sound_v2", output_format: "mp3_44100_128", duration_seconds: 0.7, loop: false };
    expect(legacyAudioCacheKey(request)).toBe("b91930029cf5db9dcc4d03b38e177ec09c7759d1c54ecb9e6f44a0efd59b6c95");
  });
  it("adopts matching legacy assets without spending credits again", () => {
    const cached = { id: "dig_grass", kind: "sfx", cache_key: "legacy", path: "assets/audio/generated/dig_grass.mp3", model_id: "eleven_text_to_sound_v2" };
    expect(adoptCachedAudioEntry(cached, "current", "legacy", true)).toBe(true);
    expect(cached.cache_key).toBe("current");
    expect(adoptCachedAudioEntry({ ...cached, cache_key: "legacy" }, "current", "legacy", false)).toBe(false);
  });
  it("recognizes previous music hashes without force-instrumental and loop fields", () => {
    const music = sourceManifest.music[0];
    expect(legacyAudioCacheKey({ kind: music.kind, id: music.id, prompt: music.prompt, model_id: music.model_id, output_format: music.output_format, music_length_ms: music.music_length_ms })).toBe("f188f7e8ca01e8bdbb2ce83fb0e80a8bf37585052140a78b0befc800b709964f");
  });
