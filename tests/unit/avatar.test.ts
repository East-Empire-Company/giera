import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANIM_MAP, resolveClip, type AvatarMotion } from "../../src/client/entities/avatar";
import assetManifest from "../../src/shared/asset-manifest.json";

describe("clip resolution", () => {
  it("picks the first available clip in candidate order", () => {
    expect(resolveClip(["idle_neutral", "Idle_A"], ["idle_neutral", "idle_a"])).toBe("idle_neutral");
    expect(resolveClip(["Idle_A", "Idle_B"], ["idle_b"])).toBe("idle_b");
  });

  it("returns null when no candidate exists so playback keeps the current clip", () => {
    expect(resolveClip(["jump"], ["walking_a"])).toBeNull();
  });

  it("maps every motion to ordered fallback candidates", () => {
    const motions: AvatarMotion[] = ["idle", "walk", "sprint", "jump", "mine"];
    for (const motion of motions) expect(ANIM_MAP[motion].length).toBeGreaterThan(0);
  });
});

describe("character model manifest", () => {
  it("points every character at a present GLB", () => {
    const characterModels = ["ziemek", "gniewko", "tata", "mama", "ciocia"];
    for (const id of characterModels) {
      const path = (assetManifest.models as Record<string, string>)[id];
      expect(path, `manifest missing model for ${id}`).toBeDefined();
      expect(existsSync(join("public", path))).toBe(true);
    }
  });

  it("aliases playerOne/playerTwo to character GLBs", () => {
    expect(assetManifest.models.playerOne).toBe(assetManifest.models.ziemek);
    expect(assetManifest.models.playerTwo).toBe(assetManifest.models.gniewko);
  });
});
