import { describe, expect, it } from "vitest";
import { BLOCK_ID } from "../../src/shared/blocks";
import { TntFuseQueue, TNT_CHAIN_FUSE_SECONDS, TNT_FUSE_SECONDS, TNT_RADIUS, planBlast } from "../../src/client/game/tnt";

describe("TntFuseQueue", () => {
  it("ignites each block once and reports lit state", () => {
    const queue = new TntFuseQueue();
    expect(queue.ignite(5, 61, -104, TNT_FUSE_SECONDS)).toBe(true);
    expect(queue.ignite(5, 61, -104, TNT_FUSE_SECONDS)).toBe(false);
    expect(queue.isLit(5, 61, -104)).toBe(true);
    expect(queue.isLit(5, 61, -103)).toBe(false);
    expect(queue.size).toBe(1);
  });

  it("explodes after the fuse elapses and only once", () => {
    const queue = new TntFuseQueue();
    queue.ignite(1, 2, 3, 1.2);
    const exploded: string[] = [];
    const step = (delta: number): void => queue.update(delta, (x, y, z) => exploded.push(`${x},${y},${z}`));
    step(0.5);
    step(0.5);
    expect(exploded).toEqual([]);
    step(0.3);
    expect(exploded).toEqual(["1,2,3"]);
    step(1);
    expect(exploded).toEqual(["1,2,3"]);
    expect(queue.size).toBe(0);
  });

  it("emits sparks on the spark interval until detonation", () => {
    const queue = new TntFuseQueue();
    queue.ignite(0, 0, 0, 0.5);
    const sparks: number[] = [];
    queue.update(0.2, () => {}, () => sparks.push(1));
    queue.update(0.2, () => {}, () => sparks.push(1));
    queue.update(0.2, () => {}, () => sparks.push(1));
    expect(sparks.length).toBeGreaterThanOrEqual(2);
  });

  it("lets a chain explosion ignite new blocks for later ticks", () => {
    const queue = new TntFuseQueue();
    const exploded: string[] = [];
    const explode = (x: number, y: number, z: number): void => {
      exploded.push(`${x},${y},${z}`);
      queue.ignite(x + 1, y, z, TNT_CHAIN_FUSE_SECONDS);
    };
    queue.ignite(0, 0, 0, 0.1);
    queue.update(0.2, explode);
    expect(exploded).toEqual(["0,0,0"]);
    expect(queue.size).toBe(1);
    queue.update(0.1, explode);
    expect(exploded).toEqual(["0,0,0"]);
    queue.update(0.2, explode);
    expect(exploded).toEqual(["0,0,0", "1,0,0"]);
  });

  it("keeps constants matching the gameplay contract", () => {
    expect(TNT_FUSE_SECONDS).toBe(1.2);
    expect(TNT_CHAIN_FUSE_SECONDS).toBe(0.25);
    expect(TNT_RADIUS).toBe(3.2);
  });
});

describe("planBlast", () => {
  const world = (cells: Record<string, number>) => (x: number, y: number, z: number): number => cells[`${x},${y},${z}`] ?? 0;

  it("clears solid blocks inside the radius, leaves bedrock, air and outside blocks alone", () => {
    const get = world({ "0,0,0": BLOCK_ID.tnt, "1,0,0": BLOCK_ID.stone, "0,-1,0": BLOCK_ID.bedrock, "3,0,0": BLOCK_ID.stone, "4,0,0": BLOCK_ID.stone });
    const plan = planBlast(get, 0, 0, 0);
    const keys = plan.cleared.map((c) => `${c.x},${c.y},${c.z}`).sort();
    expect(keys).toEqual(["0,0,0", "1,0,0", "3,0,0"]);
  });

  it("never chains the exploding block itself but chains other TNT in range", () => {
    const get = world({ "0,0,0": BLOCK_ID.tnt, "2,0,0": BLOCK_ID.tnt, "9,0,0": BLOCK_ID.tnt });
    const plan = planBlast(get, 0, 0, 0);
    expect(plan.chained).toEqual([{ x: 2, y: 0, z: 0 }]);
  });

  it("detonates a lone TNT exactly once and a neighbour exactly once, through the real queue", () => {
    const cells: Record<string, number> = { "0,0,0": BLOCK_ID.tnt, "2,0,0": BLOCK_ID.tnt, "0,-1,0": BLOCK_ID.stone };
    const queue = new TntFuseQueue();
    const blasts: string[] = [];
    const explode = (x: number, y: number, z: number): void => {
      blasts.push(`${x},${y},${z}`);
      const plan = planBlast((px, py, pz) => cells[`${px},${py},${pz}`] ?? 0, x, y, z);
      for (const c of plan.cleared) delete cells[`${c.x},${c.y},${c.z}`];
      for (const c of plan.chained) queue.ignite(c.x, c.y, c.z, TNT_CHAIN_FUSE_SECONDS);
    };
    queue.ignite(0, 0, 0, TNT_FUSE_SECONDS);
    for (let i = 0; i < 400; i++) queue.update(0.016, explode);
    expect(blasts).toEqual(["0,0,0", "2,0,0"]);
    expect(queue.size).toBe(0);
    expect(Object.keys(cells)).toEqual([]);
  });
});
