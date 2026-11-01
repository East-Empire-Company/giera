import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import assetManifest from "../../shared/asset-manifest.json";
import { withRetry } from "../../shared/retry";

export type PlayerAvatarId = keyof typeof assetManifest.models;
export type AvatarMotion = "idle" | "walk" | "sprint" | "jump" | "mine";

export const ANIM_MAP: Record<AvatarMotion, string[]> = {
  idle: ["idle_neutral", "Idle_A", "Idle_B"],
  walk: ["walk", "walk_relaxed", "Walking_A", "Walking_B", "Walking_C"],
  sprint: ["run", "Running_A", "Running_B"],
  jump: ["jump", "Jump_Start", "Jump_Full_Short", "Jump_Idle"],
  mine: ["kicks", "punches", "Use_Item", "Hit_A", "Interact"],
};

export type AvatarOneShot = "place" | "craft" | "pickup" | "land" | "hit";

export const ONE_SHOT_MAP: Record<AvatarOneShot, string[]> = {
  place: ["interact", "Interact", "Use_Item"],
  craft: ["interact", "Use_Item", "Interact"],
  pickup: ["wave", "PickUp", "Interact"],
  land: ["jump", "Jump_Land"],
  hit: ["punches", "kicks", "Hit_A", "Throw"],
};

export function resolveClip(candidates: string[], available: string[]): string | null {
  const lowered = new Set(available.map((name) => name.toLowerCase()));
  for (const candidate of candidates) if (lowered.has(candidate.toLowerCase())) return candidate.toLowerCase();
  return null;
}

function findBone(root: THREE.Object3D, candidates: string[]): THREE.Bone | undefined {
  const lowered = candidates.map((candidate) => candidate.toLowerCase());
  let found: THREE.Bone | undefined;
  root.traverse((object) => {
    if (found || !(object instanceof THREE.Bone)) return;
    const name = object.name.toLowerCase();
    if (lowered.some((candidate) => candidate.endsWith("*") ? name.startsWith(candidate.slice(0, -1)) : name === candidate)) {
      found = object;
    }
  });
  return found;
}

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

    const accuBones: THREE.Bone[] = [];
    object.traverse((child) => {
      if (child instanceof THREE.Bone && child.name.toLowerCase().startsWith("spine006")) accuBones.push(child);
    });
    this.bones.hips = findBone(object, ["hips", "mixamorig:hips", "spine006*"]) ?? accuBones[0];
    this.bones.spine =
      findBone(object, ["spine", "mixamorig:spine"]) ??
      accuBones.find((bone) => bone.parent === this.bones.hips) ??
      accuBones[1];
    this.bones.chest =
      findBone(object, ["chest", "spine1", "mixamorig:spine1"]) ??
      accuBones.find((bone) => bone.parent === this.bones.spine) ??
      accuBones[2];
    this.bones.head = findBone(object, ["head", "mixamorig:head"]);
    this.bones.armL = findBone(object, ["upperarm.l", "mixamorig:leftarm", "upperarm_left"]);
    this.bones.armR = findBone(object, ["upperarm.r", "mixamorig:rightarm", "upperarm_right"]);
    this.setMotion("idle");
  }

  static async load(
    id: PlayerAvatarId,
    accentColor: THREE.ColorRepresentation,
    clothing?: AvatarClothing,
    scale = 0.85
  ): Promise<Avatar> {
    void accentColor;
    void clothing;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const model = await withRetry(() => loader.loadAsync(`/${assetManifest.models[id]}`));
    model.scene.scale.setScalar(scale);
    return new Avatar(model.scene, model.animations);
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

  private layered = new Map<string, { applied: number; delta: number }>();
  private amp = 1;

  private addLayer(bone: THREE.Bone, key: "rx" | "ry" | "rz" | "py", delta: number): void {
    const id = `${bone.name}:${key}`;
    const get = (): number => (key === "rx" ? bone.rotation.x : key === "ry" ? bone.rotation.y : key === "rz" ? bone.rotation.z : bone.position.y);
    const set = (v: number): void => {
      if (key === "rx") bone.rotation.x = v;
      else if (key === "ry") bone.rotation.y = v;
      else if (key === "rz") bone.rotation.z = v;
      else bone.position.y = v;
    };
    const prev = this.layered.get(id);
    if (prev && Math.abs(get() - prev.applied) < 1e-9) set(get() - prev.delta);
    const next = get() + delta;
    set(next);
    this.layered.set(id, { applied: next, delta });
  }

  private layerLife(deltaSeconds: number): void {
    this.life += deltaSeconds;
    const t = this.life + this.phase;
    const target = this.motion === "idle" && !this.oneShot ? 1 : this.motion === "walk" ? 0.35 : 0.2;
    this.amp += (target - this.amp) * Math.min(1, deltaSeconds * 4);
    const amp = this.amp;
    const b = this.bones;
    if (b.spine) this.addLayer(b.spine, "rx", Math.sin(t * 1.7) * 0.02 * amp);
    if (b.chest) {
      this.addLayer(b.chest, "rx", Math.sin(t * 1.7 + 0.5) * 0.025 * amp);
      this.addLayer(b.chest, "ry", Math.sin(t * 0.45) * 0.03 * amp);
    }
    if (b.head) {
      this.addLayer(b.head, "ry", Math.sin(t * 0.5) * 0.12 * amp);
      this.addLayer(b.head, "rx", Math.sin(t * 0.8 + 1.0) * 0.04 * amp);
      this.addLayer(b.head, "rz", Math.sin(t * 0.37) * 0.02 * amp);
    }
    if (b.hips) {
      this.addLayer(b.hips, "rz", Math.sin(t * 0.6) * 0.035 * amp);
      this.addLayer(b.hips, "py", Math.sin(t * 1.7) * 0.004 * amp);
    }
    if (b.armL) this.addLayer(b.armL, "rx", Math.sin(t * 1.7 + 0.8) * 0.03 * amp);
    if (b.armR) this.addLayer(b.armR, "rx", Math.sin(t * 1.7 + 1.6) * 0.03 * amp);
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
