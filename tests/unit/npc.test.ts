import { describe, expect, it } from "vitest";
import { createParrotObject, NPCManager, NPCS } from "../../src/client/entities/npc";

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
