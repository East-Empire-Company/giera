import { detailCharacter, type CharacterKind } from "./character-detail";
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

export type AvatarOneShot = "place" | "craft" | "pickup" | "land" | "hit";

export const ONE_SHOT_MAP: Record<AvatarOneShot, string[]> = {
  place: ["Interact", "Use_Item"],
  craft: ["Use_Item", "Interact"],
  pickup: ["PickUp", "Interact"],
  land: ["Jump_Land"],
  hit: ["Hit_A", "Throw"],
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

  private life = 0;
  private static count = 0;
  private readonly phase = (Avatar.count++ * 2.399963) % 6.28;
  private oneShot?: THREE.AnimationAction;
  private readonly bones: { spine?: THREE.Bone; chest?: THREE.Bone; head?: THREE.Bone; hips?: THREE.Bone; armL?: THREE.Bone; armR?: THREE.Bone } = {};

  private constructor(object: THREE.Group, animations: THREE.AnimationClip[]) {
    this.object = object;
    this.mixer = new THREE.AnimationMixer(object);
    for (const clip of animations) this.actions[clip.name.toLowerCase()] = this.mixer.clipAction(clip);
    object.traverse((o) => {
      if (!(o instanceof THREE.Bone)) return;
      const n = o.name.toLowerCase();
      if (n === "spine") this.bones.spine = o;
      else if (n === "chest") this.bones.chest = o;
      else if (n === "head") this.bones.head = o;
      else if (n === "hips") this.bones.hips = o;
      else if (n === "upperarm.l") this.bones.armL = o;
      else if (n === "upperarm.r") this.bones.armR = o;
    });
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
    const kind: CharacterKind = id === "playerOne" ? "ziemek" : id === "playerTwo" ? "gniewko" : "generic";
    detailCharacter(model.scene, kind, clothing);
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
    if (this.oneShot) {
      this.motion = motion;
      return;
    }
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
    this.layerLife(deltaSeconds);
  }

  private layerLife(deltaSeconds: number): void {
    this.life += deltaSeconds;
    const t = this.life + this.phase;
    const amp = this.motion === "idle" && !this.oneShot ? 1 : this.motion === "walk" ? 0.35 : 0.2;
    const b = this.bones;
    if (b.spine) b.spine.rotation.x += Math.sin(t * 1.7) * 0.02 * amp;
    if (b.chest) {
      b.chest.rotation.x += Math.sin(t * 1.7 + 0.5) * 0.025 * amp;
      b.chest.rotation.y += Math.sin(t * 0.45) * 0.03 * amp;
    }
    if (b.head) {
      b.head.rotation.y += Math.sin(t * 0.5) * 0.12 * amp + Math.sin(t * 1.3) * 0.02 * amp;
      b.head.rotation.x += Math.sin(t * 0.8 + 1.0) * 0.04 * amp;
      b.head.rotation.z += Math.sin(t * 0.37) * 0.02 * amp;
    }
    if (b.hips) {
      b.hips.rotation.z += Math.sin(t * 0.6) * 0.035 * amp;
      b.hips.position.y += Math.sin(t * 1.7) * 0.004 * amp;
    }
    if (b.armL) b.armL.rotation.x += Math.sin(t * 1.7 + 0.8) * 0.03 * amp;
    if (b.armR) b.armR.rotation.x += Math.sin(t * 1.7 + 1.6) * 0.03 * amp;
  }

  playOnce(motion: AvatarOneShot): void {
    const clipName = resolveClip(ONE_SHOT_MAP[motion], Object.keys(this.actions));
    if (!clipName || this.frozen) return;
    const next = this.actions[clipName];
    next.reset();
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = false;
    next.play();
    if (this.active && this.active !== next) this.active.crossFadeTo(next, 0.1, true);
    this.oneShot = next;
    this.active = next;
    const onDone = (event: { action: THREE.AnimationAction }): void => {
      if (event.action !== next) return;
      this.mixer.removeEventListener("finished", onDone as never);
      this.oneShot = undefined;
      this.active = undefined;
      this.setMotion(this.motion);
    };
    this.mixer.addEventListener("finished", onDone as never);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.object.removeFromParent();
  }
}
