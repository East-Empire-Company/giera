import { describe, expect, it } from "vitest";
import { AudioManager, MUSIC_TRACKS, parseAudioManifest, VOICE_PATHS } from "../../src/client/audio/sound";

describe("runtime audio manifest", () => {
  it("maps generated audio entries to same-origin local paths", () => {
    const result = parseAudioManifest({ entries: { ui_click: { path: "assets/audio/generated/ui_click.mp3" } } });
    expect(result.ui_click).toBe("/assets/audio/generated/ui_click.mp3");
  });

  it("rejects remote or traversing audio paths", () => {
    expect(() => parseAudioManifest({ entries: { bad: { path: "https://audio.example/file.mp3" } } })).toThrow(RangeError);
    expect(() => parseAudioManifest({ entries: { bad: { path: "assets/audio/generated/../../secret" } } })).toThrow(RangeError);
  });

  it("includes Polish voice clips for Ziemek and Gniewko", () => {
    const manager = new AudioManager();
    expect(VOICE_PATHS.celebrate_win).toBe("/assets/audio/voice/celebrate_win.mp3");
    expect(VOICE_PATHS.cinematic_ziemek_ready).toBe("/assets/audio/voice/cinematic_ziemek_ready.mp3");
    expect(VOICE_PATHS.cinematic_gniewko_ready).toBe("/assets/audio/voice/cinematic_gniewko_ready.mp3");
  });

  it("includes phonk and adventure music tracks from choyce-engine", () => {
    expect(MUSIC_TRACKS.drift_phonk).toBe("/assets/audio/music/drift_phonk.mp3");
    expect(MUSIC_TRACKS.sigma_protocol).toBe("/assets/audio/music/sigma_protocol.mp3");
    expect(MUSIC_TRACKS.combat_phonk).toBe("/assets/audio/music/combat_phonk.mp3");
  });
});
