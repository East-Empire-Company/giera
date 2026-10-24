export type AABB = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
export type Position3 = { x: number; y: number; z: number };
export type HitAxis = "x" | "y" | "z" | null;
export type SweepResult = { position: Position3; onGround: boolean; hitAxis: HitAxis };

function collides(world: (x: number, y: number, z: number) => boolean, box: AABB): boolean {
  for (let y = Math.floor(box.minY); y < Math.ceil(box.maxY); y++) {
    for (let z = Math.floor(box.minZ); z < Math.ceil(box.maxZ); z++) {
      for (let x = Math.floor(box.minX); x < Math.ceil(box.maxX); x++) {
        if (world(x, y, z)) return true;
      }
    }
  }
  return false;
}

export function sweepAABB(world: (x: number, y: number, z: number) => boolean, box: AABB, delta: Position3): SweepResult {
  let movedX = 0;
  let movedY = 0;
  let movedZ = 0;
  let hitAxis: HitAxis = null;
  let onGround = false;
  const axes = [
    { axis: "y" as const, amount: delta.y },
    { axis: "x" as const, amount: delta.x },
    { axis: "z" as const, amount: delta.z },
  ];

  for (const { axis, amount } of axes) {
    if (amount === 0) continue;
    const steps = Math.ceil(Math.abs(amount) / 0.2);
    const increment = amount / steps;
    for (let step = 0; step < steps; step++) {
      const candidate = { ...box };
      candidate.minX += movedX;
      candidate.maxX += movedX;
      candidate.minY += movedY;
      candidate.maxY += movedY;
      candidate.minZ += movedZ;
      candidate.maxZ += movedZ;
      candidate[`min${axis.toUpperCase()}` as "minX" | "minY" | "minZ"] += increment;
      candidate[`max${axis.toUpperCase()}` as "maxX" | "maxY" | "maxZ"] += increment;
      if (collides(world, candidate)) {
        hitAxis = axis;
        if (axis === "y" && amount < 0) onGround = true;
        break;
      }
      if (axis === "x") movedX += increment;
      else if (axis === "y") movedY += increment;
      else movedZ += increment;
    }
  }

  return {
    position: { x: box.minX + movedX, y: box.minY + movedY, z: box.minZ + movedZ },
    onGround,
    hitAxis,
  };
}
