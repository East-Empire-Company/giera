import { existsSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Avatar, MissingCompanionAssetError } from "../../src/client/entities/avatar";
import assetManifest from "../../src/shared/asset-manifest.json";
import {
  COMPANION_ANIM_CLIPS,
  COMPANION_MODEL_PATHS,
  COMPANION_PROFILES,
  MISSING_COMPANION_ASSET_MESSAGE,
  type CompanionProfileId,
} from "../../src/shared/companion";

type LoadedGltf = { scene: THREE.Group; animations: THREE.AnimationClip[] };

function modelGltf(height = 1.8): LoadedGltf {
  const scene = new THREE.Group();
  if (height > 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, height, 1));
    mesh.position.y = height / 2;
    scene.add(mesh);
  }
  return { scene, animations: [] };
}

function animationGltf(...names: string[]): LoadedGltf {
  return {
    scene: new THREE.Group(),
    animations: names.map(
      (name) =>
        new THREE.AnimationClip(name, 1, [
          new THREE.VectorKeyframeTrack(".position", [0, 1], [0, 0, 0, 0, 0, 0]),
        ]),
    ),
  };
}

function stubAssets(clipNames = ["Idle_A", "Walking_A"], height = 1.8) {
  const assets = new Map<string, LoadedGltf>([
    [COMPANION_MODEL_PATHS.ranger.replace(/^\//, ""), modelGltf(height)],
    [COMPANION_MODEL_PATHS.mage.replace(/^\//, ""), modelGltf(height)],
    [COMPANION_ANIM_CLIPS.idle.file.replace(/^\//, ""), animationGltf(clipNames[0] ?? "")],
    [COMPANION_ANIM_CLIPS.walk.file.replace(/^\//, ""), animationGltf(clipNames[1] ?? "")],
  ]);
  return vi.spyOn(GLTFLoader.prototype, "loadAsync").mockImplementation(async (url) => {
    const asset = assets.get(url.replace(/^\//, ""));
    if (!asset) throw new Error(`Missing ${url}`);
    return asset as never;
  });
}

describe("companion profiles", () => {
  it("maps both profiles to KayKit models with shared height and voice", () => {
    expect(COMPANION_PROFILES).toEqual({
      staszek: { model: "ranger", targetHeight: 1.8, voice: "buddy" },
      mina: { model: "mage", targetHeight: 1.8, voice: "buddy" },
    });
    expect(assetManifest.models.ranger).toBe(COMPANION_MODEL_PATHS.ranger.slice(1));
    expect(assetManifest.models.mage).toBe(COMPANION_MODEL_PATHS.mage.slice(1));
    expect(assetManifest.animations.companionIdle).toBe(COMPANION_ANIM_CLIPS.idle.file.slice(1));
    expect(assetManifest.animations.companionWalk).toBe(COMPANION_ANIM_CLIPS.walk.file.slice(1));

    for (const id of Object.keys(COMPANION_PROFILES) as CompanionProfileId[]) {
      const path = assetManifest.models[COMPANION_PROFILES[id].model];
      expect(existsSync(join("public", path))).toBe(true);
    }
    expect(existsSync(join("public", assetManifest.animations.companionIdle))).toBe(true);
    expect(existsSync(join("public", assetManifest.animations.companionWalk))).toBe(true);
  });
});

describe("companion avatar loading", () => {
  beforeEach(() => {
    stubAssets();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each(["ranger", "mage"] as const)("loads both Rig_Medium clips for %s motion", async (model) => {
    const loadAsync = stubAssets();
    const avatar = await Avatar.load(model, { targetHeight: 1.8 });

    expect(loadAsync.mock.calls.map(([url]) => url)).toEqual([
      COMPANION_MODEL_PATHS[model],
      COMPANION_ANIM_CLIPS.idle.file,
      COMPANION_ANIM_CLIPS.walk.file,
    ]);
    expect(avatar.currentClipName).toBe("Idle_A");
    avatar.setMotion("walk");
    expect(avatar.currentClipName).toBe("Walking_A");
  });

  it.each([
    { motion: "idle", clipNames: ["Idle_A", ""] },
    { motion: "walk", clipNames: ["", "Walking_A"] },
  ])("rejects companion assets with a missing $motion clip", async ({ clipNames }) => {
    vi.restoreAllMocks();
    stubAssets(clipNames);

    await expect(Avatar.load("ranger", { targetHeight: 1.8 })).rejects.toMatchObject({
      name: "MissingCompanionAssetError",
      message: MISSING_COMPANION_ASSET_MESSAGE,
    });
  });

  it("rejects a companion model with no measurable source height", async () => {
    vi.restoreAllMocks();
    stubAssets(["Idle_A", "Walking_A"], 0);

    await expect(Avatar.load("ranger", { targetHeight: 1.8 })).rejects.toBeInstanceOf(MissingCompanionAssetError);
  });

  it("wraps a missing companion model in the typed Polish asset error", async () => {
    vi.useFakeTimers();
    const loadAsync = vi.spyOn(GLTFLoader.prototype, "loadAsync").mockRejectedValue(new Error("not found"));
    const loading = Avatar.load("ranger", { targetHeight: 1.8 });
    const rejection = expect(loading).rejects.toBeInstanceOf(MissingCompanionAssetError);
    await vi.runAllTimersAsync();

    await rejection;
    expect(loadAsync).toHaveBeenCalledTimes(4);
  });
});
