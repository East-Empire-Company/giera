export type Vec3 = { x: number; y: number; z: number };
export type RayHit = { hit: { x: number; y: number; z: number }; normal: Vec3; distance: number };

export function raycastVoxels(origin: Vec3, direction: Vec3, maxDistance: number, getBlock: (x: number, y: number, z: number) => number): RayHit | null {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isFinite(length) || length === 0 || maxDistance < 0) return null;
  const dx = direction.x / length;
  const dy = direction.y / length;
  const dz = direction.z / length;
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  if (getBlock(x, y, z) !== 0) return { hit: { x, y, z }, normal: { x: 0, y: 0, z: 0 }, distance: 0 };

  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const stepZ = Math.sign(dz);
  const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
  const deltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
  const deltaZ = dz === 0 ? Infinity : Math.abs(1 / dz);
  let maxX = dx === 0 ? Infinity : ((stepX > 0 ? x + 1 : x) - origin.x) / dx;
  let maxY = dy === 0 ? Infinity : ((stepY > 0 ? y + 1 : y) - origin.y) / dy;
  let maxZ = dz === 0 ? Infinity : ((stepZ > 0 ? z + 1 : z) - origin.z) / dz;
  let normal: Vec3 = { x: 0, y: 0, z: 0 };

  while (true) {
    let distance: number;
    if (maxX <= maxY && maxX <= maxZ) {
      distance = maxX;
      maxX += deltaX;
      x += stepX;
      normal = { x: -stepX, y: 0, z: 0 };
    } else if (maxY <= maxZ) {
      distance = maxY;
      maxY += deltaY;
      y += stepY;
      normal = { x: 0, y: -stepY, z: 0 };
    } else {
      distance = maxZ;
      maxZ += deltaZ;
      z += stepZ;
      normal = { x: 0, y: 0, z: -stepZ };
    }
    if (distance > maxDistance) return null;
    if (getBlock(x, y, z) !== 0) return { hit: { x, y, z }, normal, distance };
  }
}

export function raycastInteract(
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  getBlock: (x: number, y: number, z: number) => number,
  pivot?: Vec3
): RayHit | null {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isFinite(length) || length === 0) return null;
  const ux = direction.x / length;
  const uy = direction.y / length;
  const uz = direction.z / length;
  const skip = pivot ? Math.max(0, Math.min(maxDistance, (pivot.x - origin.x) * ux + (pivot.y - origin.y) * uy + (pivot.z - origin.z) * uz)) : 0;
  const start = { x: origin.x + ux * skip, y: origin.y + uy * skip, z: origin.z + uz * skip };
  const ox = Math.floor(start.x);
  const oy = Math.floor(start.y);
  const oz = Math.floor(start.z);
  const hit = raycastVoxels(start, direction, maxDistance - skip, (x, y, z) => (x === ox && y === oy && z === oz ? 0 : getBlock(x, y, z)));
  return hit ? { ...hit, distance: hit.distance + skip } : null;
}
