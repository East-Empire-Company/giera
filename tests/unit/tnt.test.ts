import { describe, expect, it } from "vitest";
import { TntFuseQueue, TNT_CHAIN_FUSE_SECONDS, TNT_FUSE_SECONDS, TNT_RADIUS } from "../../src/client/game/tnt";

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
