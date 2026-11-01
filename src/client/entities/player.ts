import * as THREE from "three";
import { sweepAABB, type AABB } from "../../shared/physics";
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
    const modelId = this.characterProfile === "ziemek" ? "playerOne" : "playerTwo";
    const avatar = await Avatar.load(modelId, "#ffffff", this.profile.clothing, 0.85);
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
    const speed = this.flying ? 4.3 : moveInput.sprint ? 5.6 : 4.3;
    const cosPitch = Math.cos(this.pitch);
    const forward = new THREE.Vector3(
      -Math.sin(this.yaw) * cosPitch,
      this.flying ? -Math.sin(this.pitch) : 0,
      -Math.cos(this.yaw) * cosPitch
    ).normalize();
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();

    const wishDir = new THREE.Vector3();
    wishDir.addScaledVector(forward, moveInput.forward);
    wishDir.addScaledVector(right, moveInput.right);
    if (this.flying) {
      if (moveInput.jump) wishDir.y += 1;
      if (moveInput.sprint) wishDir.y -= 1;
    }
    if (wishDir.lengthSq() > 0.001) wishDir.normalize();

    if (this.flying) {
      this.velocity.copy(wishDir).multiplyScalar(speed);
    } else if (this.onGround) {
      this.velocity.x = wishDir.x * speed;
      this.velocity.z = wishDir.z * speed;
      this.velocity.y = -1.0;
      if (moveInput.jump) {
        this.velocity.y = Math.sqrt(2 * GRAVITY * this.jumpHeight);
        this.onGround = false;
      }
    } else {
      this.velocity.x += wishDir.x * speed * 0.3 * delta;
      this.velocity.z += wishDir.z * speed * 0.3 * delta;
      this.velocity.y -= GRAVITY * delta;
    }

    const box = this.getBoundingBox();
    const movement = {
      x: this.velocity.x * delta,
      y: this.velocity.y * delta,
      z: this.velocity.z * delta,
    };
    let result = sweepAABB(world, box, movement);
    if (this.onGround && (result.hitAxis === "x" || result.hitAxis === "z")) {
      const stepBox = { ...box, minY: box.minY + 1, maxY: box.maxY + 1 };
      movement.y = 0;
      const stepped = sweepAABB(world, stepBox, movement);
      const directX = result.position.x - box.minX;
      const directZ = result.position.z - box.minZ;
      const steppedX = stepped.position.x - box.minX;
      const steppedZ = stepped.position.z - box.minZ;
      if (steppedX * steppedX + steppedZ * steppedZ > directX * directX + directZ * directZ + 1e-4) {
        const offsetX = stepped.position.x - stepBox.minX;
        const offsetZ = stepped.position.z - stepBox.minZ;
        stepBox.minX += offsetX;
        stepBox.maxX += offsetX;
        stepBox.minZ += offsetZ;
        stepBox.maxZ += offsetZ;
        movement.x = 0;
        movement.y = -1;
        movement.z = 0;
        result = sweepAABB(world, stepBox, movement);
      }
    }

    this.position.x = result.position.x + 0.3;
    this.position.y = result.position.y;
    this.position.z = result.position.z + 0.3;
    const wasAirborne = !this.onGround;
    const impactSpeed = -this.velocity.y;
    this.onGround = this.flying ? false : result.onGround;
    if (wasAirborne && this.onGround && impactSpeed > 6) this.avatar?.playOnce("land");

    if (result.hitAxis === "y") this.velocity.y = 0;
    if (result.hitAxis === "x") this.velocity.x = 0;
    if (result.hitAxis === "z") this.velocity.z = 0;

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
