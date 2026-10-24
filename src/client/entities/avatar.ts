import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import assetManifest from "../../shared/asset-manifest.json";

export type PlayerAvatarId = keyof typeof assetManifest.models;
export type AvatarMotion = "idle" | "walk" | "sprint";

export class Avatar {
  readonly object: THREE.Group;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Record<string, THREE.AnimationAction> = {};
  private active?: THREE.AnimationAction;
  private motion: AvatarMotion = "idle";

  private constructor(object: THREE.Group, animations: THREE.AnimationClip[]) {
    this.object = object;
    this.mixer = new THREE.AnimationMixer(object);
    for (const clip of animations) this.actions[clip.name.toLowerCase()] = this.mixer.clipAction(clip);
    this.setMotion("idle");
  }

  static async load(
    id: PlayerAvatarId,
    accentColor: THREE.ColorRepresentation,
    clothing?: { torso: string; arms: string; legs: string }
  ): Promise<Avatar> {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(`/${assetManifest.models[id]}`);
    const accent = new THREE.Color(accentColor);
    gltf.scene.scale.setScalar(0.66);
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const partColor = object.name.startsWith("torso")
        ? clothing?.torso
        : object.name.startsWith("arm")
        ? clothing?.arms
        : object.name.startsWith("leg")
        ? clothing?.legs
        : undefined;

      const targetColor = partColor ? new THREE.Color(partColor) : accent;
      const weight = partColor ? 0.85 : 0.08;
      const tint = (material: THREE.Material): THREE.Material => {
        const copy = material.clone();
        if ("color" in copy && copy.color instanceof THREE.Color) copy.color.lerp(targetColor, weight);
        return copy;
      };
      object.material = Array.isArray(object.material) ? object.material.map(tint) : tint(object.material);
    });
    return new Avatar(gltf.scene, gltf.animations);
  }

  setMotion(motion: AvatarMotion): void {
    if (motion === this.motion && this.active?.isRunning()) return;
    const next = this.actions[motion] ?? this.actions.idle;
    if (next === this.active) return;
    if (this.active && next) this.active.crossFadeTo(next, 0.18, true);
    next?.reset().play();
    this.active = next;
    this.motion = motion;
  }

  update(deltaSeconds: number): void {
    this.mixer.update(deltaSeconds);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.object.removeFromParent();
  }
}
