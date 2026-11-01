import { describe, expect, it } from "vitest";
import { NPCManager, NPCInstance, NPCS } from "../../src/client/entities/npc";
import { makeRng } from "../../src/shared/rng";

describe("NPCManager", () => {
  it("initializes three distinct NPCs in the clearing", () => {
    const manager = new NPCManager();
    expect(manager.npcs.length).toBe(3);
    const names = manager.npcs.map((n) => n.name);
    expect(names).toEqual(["Tata", "Mama", "Ciocia Ewelina"]);
  });

  it("detects when player is within conversation distance", () => {
    const manager = new NPCManager();
    // Tata is at [4, 50, 4]
    const nearTata = manager.getNearestNPC(4.5, 50, 4.2, 3.0);
    expect(nearTata?.name).toBe("Tata");

    // Far from all NPCs
    const far = manager.getNearestNPC(50, 50, 50, 3.0);
    expect(far).toBeNull();
  });
});

describe("NPC wander", () => {
  const flatTerrain = () => 50;

  it("stays within the home radius while wandering", () => {
    const tata = new NPCInstance(NPCS[0], makeRng(424242));
    for (let i = 0; i < 3600; i++) {
      tata.update(1 / 60, flatTerrain);
      const dx = tata.position.x - tata.home.x;
      const dz = tata.position.z - tata.home.z;
      expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(6.01);
    }
  });

  it("is deterministic for the same seed and differs across seeds", () => {
    const run = (seed: number) => {
      const tata = new NPCInstance(NPCS[0], makeRng(seed));
      const trail: string[] = [];
      for (let i = 0; i < 600; i++) {
        tata.update(1 / 60, flatTerrain);
        if (i % 60 === 0) trail.push(`${tata.position.x.toFixed(3)},${tata.position.z.toFixed(3)}`);
      }
      return trail;
    };
    expect(run(424242)).toEqual(run(424242));
    expect(run(424242)).not.toEqual(run(777));
  });

  it("keeps ciocia near her home spot", () => {
    const ciocia = new NPCInstance(NPCS[2], makeRng(424242));
    for (let i = 0; i < 600; i++) ciocia.update(1 / 60, flatTerrain);
    const dx = ciocia.position.x - ciocia.home.x;
    const dz = ciocia.position.z - ciocia.home.z;
    expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(6.01);
  });

  it("follows terrain height while walking", () => {
    const tata = new NPCInstance(NPCS[0], makeRng(424242));
    let calls = 0;
    const terrain = (x: number, z: number) => {
      calls++;
      return 40 + x * 0.1;
    };
    for (let i = 0; i < 600; i++) tata.update(1 / 60, terrain);
    expect(calls).toBeGreaterThan(0);
    expect(tata.position.y).toBeCloseTo(40 + tata.position.x * 0.1 + 1, 5);
  });

  it("walks toward a commanded target", () => {
    const tata = new NPCInstance(NPCS[0], makeRng(424242));
    const targetDist = (npc: NPCInstance) => Math.hypot(npc.position.x - 0, npc.position.z - -10);
    const start = targetDist(tata);
    tata.walkTo(0, -10);
    for (let i = 0; i < 300; i++) tata.update(1 / 60, flatTerrain);
    expect(targetDist(tata)).toBeLessThan(start);
  });

  it("clamps commanded targets to 12 blocks from home", () => {
    const tata = new NPCInstance(NPCS[0], makeRng(424242));
    tata.walkTo(1000, 1000);
    for (let i = 0; i < 60 * 30; i++) tata.update(1 / 60, flatTerrain);
    const dx = tata.position.x - tata.home.x;
    const dz = tata.position.z - tata.home.z;
    expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(12.01);
  });
});
