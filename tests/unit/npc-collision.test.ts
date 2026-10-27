import { describe, expect, it } from "vitest";
import { NPCInstance, NPCS } from "../../src/client/entities/npc";

describe("NPC wander collision", () => {
  it("never walks into a solid wall in its path", () => {
    const npc = new NPCInstance(NPCS[0]);
    npc.position.set(0.5, 60, 0.5);
    npc.walkTo(8, 0.5);
    const wallAtX3 = (x: number, _y: number, _z: number) => x >= 3;
    for (let i = 0; i < 2000; i++) npc.update(1 / 60, () => 59, wallAtX3);
    expect(npc.position.x).toBeLessThan(3);
  });

  it("walks freely when nothing blocks it", () => {
    const npc = new NPCInstance(NPCS[0]);
    npc.position.set(0.5, 60, 0.5);
    npc.walkTo(5, 0.5);
    for (let i = 0; i < 600; i++) npc.update(1 / 60, () => 59, () => false);
    expect(npc.position.x).toBeGreaterThan(3);
  });
});
