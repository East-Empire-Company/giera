import { raycastVoxels, type Vec3 } from "./raycast";

const WALL_MARGIN = 0.35;
const MIN_DISTANCE = 0.5;

export function collideCamera(target: Vec3, desired: Vec3, isSolid: (x: number, y: number, z: number) => boolean): Vec3 {
  const dx = desired.x - target.x;
  const dy = desired.y - target.y;
  const dz = desired.z - target.z;
  const length = Math.hypot(dx, dy, dz);
  if (length === 0) return { ...desired };
  const hit = raycastVoxels(target, { x: dx, y: dy, z: dz }, length, (x, y, z) => (isSolid(x, y, z) ? 1 : 0));
  if (!hit) return { ...desired };
  const distance = Math.min(length, Math.max(MIN_DISTANCE, hit.distance - WALL_MARGIN));
  const scale = distance / length;
  return { x: target.x + dx * scale, y: target.y + dy * scale, z: target.z + dz * scale };
}
