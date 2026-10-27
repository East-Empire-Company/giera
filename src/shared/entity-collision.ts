export type Cylinder = { x: number; y: number; z: number; radius: number; height: number };

export function pushOutOfCylinders(
  pos: { x: number; y: number; z: number },
  radius: number,
  height: number,
  others: readonly Cylinder[]
): { x: number; z: number; pushed: boolean } {
  let x = pos.x;
  let z = pos.z;
  let pushed = false;
  for (const o of others) {
    if (pos.y >= o.y + o.height || pos.y + height <= o.y) continue;
    const dx = x - o.x;
    const dz = z - o.z;
    const min = radius + o.radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    const nx = d > 1e-6 ? dx / d : 1;
    const nz = d > 1e-6 ? dz / d : 0;
    x = o.x + nx * min;
    z = o.z + nz * min;
    pushed = true;
  }
  return { x, z, pushed };
}

export function blockedByCylinders(
  x: number,
  z: number,
  y: number,
  radius: number,
  height: number,
  others: readonly Cylinder[]
): boolean {
  return pushOutOfCylinders({ x, y, z }, radius, height, others).pushed;
}
