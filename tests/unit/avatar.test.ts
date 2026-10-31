import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANIM_MAP, kaykitPart, resolveClip, type AvatarMotion } from "../../src/client/entities/avatar";
import assetManifest from "../../src/shared/asset-manifest.json";

describe("kaykit clip resolution", () => {
  it("picks the first available clip in candidate order", () => {
    expect(resolveClip(["Idle_A", "Idle_B"], ["idle_b", "idle_a"])).toBe("idle_a");
    expect(resolveClip(["Idle_A", "Idle_B"], ["idle_b"])).toBe("idle_b");
  });

  it("returns null when no candidate exists so playback keeps the current clip", () => {
    expect(resolveClip(["Jump_Start"], ["walking_a"])).toBeNull();
  });

  it("maps every motion to ordered fallback candidates", () => {
    const motions: AvatarMotion[] = ["idle", "walk", "sprint", "jump", "mine"];
    for (const motion of motions) expect(ANIM_MAP[motion].length).toBeGreaterThan(0);
  });

  it("maps kaykit mesh names to clothing parts", () => {
    expect(kaykitPart("Knight_Body")).toBe("torso");
    expect(kaykitPart("Rogue_ArmLeft")).toBe("arms");
    expect(kaykitPart("Mage_LegRight")).toBe("legs");
    expect(kaykitPart("Knight_Helmet")).toBeNull();
    expect(kaykitPart("Knight_Cape")).toBeNull();
  });
});

describe("hero model manifest", () => {
  it("points every hero at a present kaykit GLB", () => {
    expect(assetManifest.models.playerOne).toBe("assets/models/kaykit/knight.glb");
    expect(assetManifest.models.playerTwo).toBe("assets/models/kaykit/rogue.glb");
    expect(assetManifest.models.mina).toBe("assets/models/kaykit/mage.glb");
    expect(assetManifest.models.staszek).toBe("assets/models/kaykit/ranger.glb");
    for (const path of Object.values(assetManifest.models)) {
      expect(existsSync(join("public", path))).toBe(true);
    }
    expect(existsSync(join("public", "assets/models/kaykit/anims/Rig_Medium_MovementBasic.glb"))).toBe(true);
    expect(existsSync(join("public", "assets/models/kaykit/anims/Rig_Medium_General.glb"))).toBe(true);
  });
});
