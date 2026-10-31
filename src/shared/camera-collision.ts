import { raycastVoxels, type Vec3 } from "./raycast";

const WALL_MARGIN = 0.35;
const MIN_DISTANCE = 0.5;
const COMFORT_DISTANCE = 3.2;
const LIFT_STEPS = [1.2, 2.4, 3.6];
const ORBIT_ANGLES = [0.35, -0.35, 0.7, -0.7, 1.05, -1.05];

function pullIn(target: Vec3, desired: Vec3, isSolid: (x: number, y: number, z: number) => boolean): { pos: Vec3; distance: number; blocked: boolean } {
  const dx = desired.x - target.x;
  const dy = desired.y - target.y;
  const dz = desired.z - target.z;
  const length = Math.hypot(dx, dy, dz);
  if (length === 0) return { pos: { ...desired }, distance: 0, blocked: false };
  const hit = raycastVoxels(target, { x: dx, y: dy, z: dz }, length, (x, y, z) => (isSolid(x, y, z) ? 1 : 0));
  if (!hit) return { pos: { ...desired }, distance: length, blocked: false };
  const distance = Math.min(length, Math.max(MIN_DISTANCE, hit.distance - WALL_MARGIN));
  const scale = distance / length;
  return { pos: { x: target.x + dx * scale, y: target.y + dy * scale, z: target.z + dz * scale }, distance, blocked: true };
}

function orbit(target: Vec3, desired: Vec3, angle: number): Vec3 {
  const dx = desired.x - target.x;
  const dz = desired.z - target.z;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: target.x + dx * cos - dz * sin, y: desired.y, z: target.z + dx * sin + dz * cos };
}

export function collideCamera(target: Vec3, desired: Vec3, isSolid: (x: number, y: number, z: number) => boolean): Vec3 {
  const first = pullIn(target, desired, isSolid);
  if (!first.blocked || first.distance >= COMFORT_DISTANCE) return first.pos;
  let best = first;
  for (const angle of ORBIT_ANGLES) {
    const alt = pullIn(target, orbit(target, desired, angle), isSolid);
    if (alt.distance > best.distance) best = alt;
    if (alt.distance >= COMFORT_DISTANCE) return best.pos;
  }
  for (const lift of LIFT_STEPS) {
    const alt = pullIn(target, { x: desired.x, y: desired.y + lift, z: desired.z }, isSolid);
    if (alt.distance > best.distance) best = alt;
    if (alt.distance >= COMFORT_DISTANCE) break;
  }
  return best.pos;
}
