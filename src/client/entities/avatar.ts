import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import assetManifest from "../../shared/asset-manifest.json";

export type PlayerAvatarId = keyof typeof assetManifest.models;
export type AvatarMotion = "idle" | "walk" | "sprint" | "jump" | "mine";

export const ANIM_MAP: Record<AvatarMotion, string[]> = {
  idle: ["Idle_A", "Idle_B"],
  walk: ["Walking_A", "Walking_B", "Walking_C"],
  sprint: ["Running_A", "Running_B"],
  jump: ["Jump_Start", "Jump_Full_Short", "Jump_Idle"],
  mine: ["Use_Item", "Hit_A", "Interact"],
};

export function resolveClip(candidates: string[], available: string[]): string | null {
  const lowered = new Set(available.map((name) => name.toLowerCase()));
  for (const candidate of candidates) if (lowered.has(candidate.toLowerCase())) return candidate.toLowerCase();
  return null;
}

export function kaykitPart(name: string): "torso" | "arms" | "legs" | null {
  if (/(body|chest|torso)/i.test(name)) return "torso";
  if (/arm/i.test(name)) return "arms";
  if (/leg/i.test(name)) return "legs";
  return null;
}

const ANIM_FILES = [
  "assets/models/kaykit/anims/Rig_Medium_MovementBasic.glb",
  "assets/models/kaykit/anims/Rig_Medium_General.glb",
];

export type AvatarClothing = { torso: string; arms: string; legs: string };

export class Avatar {
  readonly object: THREE.Group;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Record<string, THREE.AnimationAction> = {};
  private active?: THREE.AnimationAction;
  private motion: AvatarMotion = "idle";
  private requested: AvatarMotion = "idle";
  private frozen = false;

  private constructor(object: THREE.Group, animations: THREE.AnimationClip[]) {
    this.object = object;
    this.mixer = new THREE.AnimationMixer(object);
    for (const clip of animations) this.actions[clip.name.toLowerCase()] = this.mixer.clipAction(clip);
    this.setMotion("idle");
  }

  static async load(
    id: PlayerAvatarId,
    accentColor: THREE.ColorRepresentation,
    clothing?: AvatarClothing,
    scale = 0.85
  ): Promise<Avatar> {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const [model, ...animGltfs] = await Promise.all([
      loader.loadAsync(`/${assetManifest.models[id]}`),
      ...ANIM_FILES.map((file) => loader.loadAsync(`/${file}`)),
    ]);
    const accent = new THREE.Color(accentColor);
    model.scene.scale.setScalar(scale);
    model.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const part = kaykitPart(object.name);
      const partColor = part ? clothing?.[part] : undefined;
      const targetColor = partColor ? new THREE.Color(partColor) : accent;
      const weight = partColor ? 0.85 : 0.08;
      const tint = (material: THREE.Material): THREE.Material => {
        const copy = material.clone();
        if ("color" in copy && copy.color instanceof THREE.Color) copy.color.lerp(targetColor, weight);
        return copy;
      };
      object.material = Array.isArray(object.material) ? object.material.map(tint) : tint(object.material);
    });
    return new Avatar(model.scene, [...model.animations, ...animGltfs.flatMap((gltf) => gltf.animations)]);
  }

  get currentMotion(): AvatarMotion {
    return this.motion;
  }

  get requestedMotion(): AvatarMotion {
    return this.requested;
  }

  setMotion(motion: AvatarMotion): void {
    this.requested = motion;
    if (motion === this.motion && this.active?.isRunning()) return;
    this.motion = motion;
    const clipName = resolveClip(ANIM_MAP[motion], Object.keys(this.actions));
    if (!clipName) return;
    const next = this.actions[clipName];
    if (next === this.active) return;
    if (this.active && next && !this.frozen) this.active.crossFadeTo(next, 0.18, true);
    next?.reset().play();
    this.active = next;
  }

  freezePose(time = 0.5): void {
    this.frozen = true;
    const clipName = resolveClip(ANIM_MAP.idle, Object.keys(this.actions));
    const action = clipName ? this.actions[clipName] : this.active;
    if (!action) return;
    this.mixer.stopAllAction();
    action.reset().play();
    action.timeScale = 0;
    action.time = time;
    this.active = action;
    this.motion = "idle";
    this.mixer.update(0);
  }

  update(deltaSeconds: number): void {
    if (this.frozen) return;
    this.mixer.update(deltaSeconds);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.object.removeFromParent();
  }
}
