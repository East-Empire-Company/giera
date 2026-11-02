import * as THREE from "three";
import type { AABB } from "../../shared/physics";
import { stepActor } from "../../shared/actor-motion";
import { Avatar, type AvatarClothing, type AvatarMotion } from "./avatar";
import type { PlayerProfile } from "../../shared/lan-protocol";

export type PlayerId = "p1" | "p2";
export type ProtagonistProfile = {
  name: string;
  role: string;
  clothing: AvatarClothing;
};

export const PROTAGONISTS: Record<PlayerProfile, ProtagonistProfile> = {
  ziemek: {
    name: "Ziemek",
    role: "Starszy brat — pixelowa bluza w creepery",
    clothing: { torso: "#22998a", arms: "#22998a", legs: "#24272e" },
  },
  gniewko: {
    name: "Gniewko",
    role: "Młodszy brat — białe polo i granatowe spodnie",
    clothing: { torso: "#f6f8fb", arms: "#f6f8fb", legs: "#1d2d48" },
  },
};

const MAX_PITCH = (85 * Math.PI) / 180; // ~1.4835 rad
const GRAVITY = 32;
const MIN_JUMP_HEIGHT = 1;
const MAX_JUMP_HEIGHT = 12;
const DEFAULT_JUMP_HEIGHT = (9 * 9) / (2 * GRAVITY);
const HEAD_PIVOT_Y = 1.55;
const ARM_OFFSET = new THREE.Vector3(0.65, 0.15, 0);

export class PlayerController {
  readonly id: PlayerId;
  characterProfile: PlayerProfile;
  profile: ProtagonistProfile;
  readonly spawn: [number, number, number];
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  yaw: number = Math.PI;
  pitch: number = 0;
  onGround: boolean = false;
  isActing: boolean = false;
  jumpHeight = DEFAULT_JUMP_HEIGHT;
  flying = false;
  avatar?: Avatar;

  constructor(options: { id: PlayerId; spawn: [number, number, number]; yaw?: number; profile?: PlayerProfile }) {
    this.id = options.id;
    const defaultProfile: PlayerProfile = this.id === "p1" ? "ziemek" : "gniewko";
    this.characterProfile = options.profile || defaultProfile;
    this.profile = PROTAGONISTS[this.characterProfile];
    this.spawn = [...options.spawn];
    this.position = new THREE.Vector3(...options.spawn);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.yaw = options.yaw ?? Math.PI;
  }

  async loadAvatar(): Promise<Avatar> {
    const modelId = this.characterProfile === "ziemek" ? "ziemek" : "gniewko";
    const targetHeight = this.characterProfile === "ziemek" ? 2.16 : 1.85;
    const avatar = await Avatar.load(modelId, { targetHeight });
    this.avatar = avatar;
    this.syncAvatar();
    return avatar;
  }
  setCharacterProfile(profile: PlayerProfile): void {
    this.characterProfile = profile;
    this.profile = PROTAGONISTS[profile];
  }

  setJumpHeight(height: number): number {
    this.jumpHeight = Math.min(MAX_JUMP_HEIGHT, Math.max(MIN_JUMP_HEIGHT, Number.isFinite(height) ? height : this.jumpHeight));
    return this.jumpHeight;
  }

  setFlying(enabled: boolean): boolean {
    this.flying = enabled;
    this.velocity.set(0, 0, 0);
    if (enabled) this.onGround = false;
    return this.flying;
  }

  rotateCamera(deltaYaw: number, deltaPitch: number): void {
    this.yaw = (this.yaw - deltaYaw) % (Math.PI * 2);
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + deltaPitch));
  }

  getCameraTarget(): THREE.Vector3 {
    return new THREE.Vector3(this.position.x, this.position.y + HEAD_PIVOT_Y, this.position.z);
  }

  getCameraPosition(distance = 5.5): THREE.Vector3 {
    const target = this.getCameraTarget();
    const rotatedArm = ARM_OFFSET.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    const backDir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();

    return target.add(rotatedArm).add(backDir.multiplyScalar(distance));
  }

  getBoundingBox(): AABB {
    return {
      minX: this.position.x - 0.3,
      minY: this.position.y,
      minZ: this.position.z - 0.3,
      maxX: this.position.x + 0.3,
      maxY: this.position.y + 1.8,
      maxZ: this.position.z + 0.3,
    };
  }

  syncAvatar(): void {
    if (!this.avatar) return;
    this.avatar.object.position.copy(this.position);
    this.avatar.object.rotation.y = this.yaw + Math.PI;
  }

  updateMotion(isMoving: boolean, isSprinting: boolean): void {
    if (!this.avatar) return;
    const motion: AvatarMotion = this.isActing
      ? "mine"
      : !this.onGround
      ? "jump"
      : !isMoving
      ? "idle"
      : isSprinting
      ? "sprint"
      : "walk";
    this.avatar.setMotion(motion);
  }

  step(
    delta: number,
    world: (x: number, y: number, z: number) => boolean,
    moveInput: { forward: number; right: number; jump: boolean; sprint: boolean }
  ): void {
    const { landed, impactSpeed } = stepActor(world, this, moveInput, delta);
    if (landed && impactSpeed > 6) this.avatar?.playOnce("land");

    if (this.position.y < -20) {
      this.position.set(this.spawn[0], this.spawn[1], this.spawn[2]);
      this.velocity.set(0, 0, 0);
      this.onGround = false;
    }
    const isMoving = Math.hypot(this.velocity.x, this.velocity.z) > 0.2;
    this.updateMotion(isMoving, moveInput.sprint);
    this.syncAvatar();
  }
}
