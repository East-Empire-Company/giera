import { describe, expect, it } from "vitest";
import { createParrotObject, NPCManager, NPCInstance, NPCS } from "../../src/client/entities/npc";
import { makeRng } from "../../src/shared/rng";

describe("NPCManager", () => {
  it("initializes three distinct NPCs in the clearing", () => {
    const manager = new NPCManager();
    expect(manager.npcs.length).toBe(3);
    const names = manager.npcs.map((n) => n.name);
    expect(names).toEqual(["Mina", "Staszek", "Papuga"]);
  });

  it("detects when player is within conversation distance", () => {
    const manager = new NPCManager();
    // Mina is at [4, 50, 4]
    const nearMina = manager.getNearestNPC(4.5, 50, 4.2, 3.0);
    expect(nearMina?.name).toBe("Mina");

    // Far from all NPCs
    const far = manager.getNearestNPC(50, 50, 50, 3.0);
    expect(far).toBeNull();
  });

  it("builds dedicated 3D bird geometry for Papuga with beak and wings", () => {
    const parrot = createParrotObject();
    expect(parrot).toBeDefined();
    expect(parrot.getObjectByName("bird-pivot")).toBeDefined();
    expect(parrot.children.length).toBeGreaterThanOrEqual(2); // Post + Bird
  });
});

describe("NPC wander", () => {
  const flatTerrain = () => 50;

  it("stays within the home radius while wandering", () => {
    const mina = new NPCInstance(NPCS[0], makeRng(424242));
    for (let i = 0; i < 3600; i++) {
      mina.update(1 / 60, flatTerrain);
      const dx = mina.position.x - mina.home.x;
      const dz = mina.position.z - mina.home.z;
      expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(6.01);
    }
  });

  it("is deterministic for the same seed and differs across seeds", () => {
    const run = (seed: number) => {
      const mina = new NPCInstance(NPCS[0], makeRng(seed));
      const trail: string[] = [];
      for (let i = 0; i < 600; i++) {
        mina.update(1 / 60, flatTerrain);
        if (i % 60 === 0) trail.push(`${mina.position.x.toFixed(3)},${mina.position.z.toFixed(3)}`);
      }
      return trail;
    };
    expect(run(424242)).toEqual(run(424242));
    expect(run(424242)).not.toEqual(run(777));
  });

  it("keeps the parrot perched on its spot", () => {
    const papuga = new NPCInstance(NPCS[2], makeRng(424242));
    for (let i = 0; i < 600; i++) papuga.update(1 / 60, flatTerrain);
    expect(papuga.position.x).toBeCloseTo(papuga.home.x, 5);
    expect(papuga.position.z).toBeCloseTo(papuga.home.z, 5);
  });

  it("follows terrain height while walking", () => {
    const mina = new NPCInstance(NPCS[0], makeRng(424242));
    let calls = 0;
    const terrain = (x: number, z: number) => {
      calls++;
      return 40 + x * 0.1;
    };
    for (let i = 0; i < 600; i++) mina.update(1 / 60, terrain);
    expect(calls).toBeGreaterThan(0);
    expect(mina.position.y).toBeCloseTo(40 + mina.position.x * 0.1 + 1, 5);
  });
});
