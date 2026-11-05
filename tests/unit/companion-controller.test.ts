import { describe, expect, it } from "vitest";
import { createCompanionController, type CompanionController, type CompanionControllerSend, type VisibleCompanionBlock } from "../../src/client/game/companion-controller";

const flatWorld = (_x: number, y: number, _z: number): number => y < 1 ? 1 : 0;
const makeController = (options: { owner?: { x: number; y: number; z: number }; visible?: VisibleCompanionBlock[]; world?: (x: number, y: number, z: number) => number } = {}) => {
  const sent: { states: unknown[]; lines: unknown[]; places: unknown[]; stops: number } = { states: [], lines: [], places: [], stops: 0 };
  const send: CompanionControllerSend = {
    state: (state) => sent.states.push(state),
    say: (_id, line, evidence) => sent.lines.push({ line, evidence }),
    place: (id, planId, blockIndex) => sent.places.push({ id, planId, blockIndex }),
    stop: () => { sent.stops += 1; },
  };
  let visible = options.visible ?? [];
  const owner = options.owner ?? { x: 9.5, y: 1, z: 0.5 };
  const controller = createCompanionController({
    send,
    world: options.world ?? flatWorld,
    isLoaded: () => true,
    blocked: () => false,
    ownerPosition: () => owner,
    visibleBlocks: () => visible,
    selfId: "player-1",
    isOwner: true,
  });
  controller.applyServerState({ id: "buddy-1", profile: "staszek", x: 0.5, y: 1, z: 0.5, yaw: 0, anim: "idle" });
  return { controller, sent, setVisible: (blocks: VisibleCompanionBlock[]) => { visible = blocks; }, owner };
};

const tick = (controller: CompanionController, count: number): void => {
  for (let index = 0; index < count; index += 1) controller.tick(0.05);
};

describe("companion controller", () => {
  it("moves toward a reachable follow ring", () => {
    const { controller } = makeController();
    expect(controller.command("follow", 1)).toBe(true);
    tick(controller, 100);
    const buddy = controller.getState()!;
    const owner = { x: 9.5, z: 0.5 };
    const distanceSquared = (buddy.x - owner.x) ** 2 + (buddy.z - owner.z) ** 2;
    expect(distanceSquared).toBeGreaterThanOrEqual(4);
    expect(distanceSquared).toBeLessThanOrEqual(16);
  });

  it("reports observed scout evidence with its block id and coordinates", () => {
    const block = { x: 2, y: 1, z: 0, id: 3 };
    const { controller, sent } = makeController({
      visible: [block],
      world: (x, y, z) => x === 2 && y === 1 && z === 0 ? 3 : flatWorld(x, y, z),
    });
    expect(controller.command("scout", 1)).toBe(true);
    tick(controller, 80);
    expect(sent.lines).toContainEqual({ line: "found", evidence: { block: "3", x: 2, y: 1, z: 0 } });
  });

  it("does not report scout evidence after the block leaves observation", () => {
    const block = { x: 2, y: 1, z: 0, id: 3 };
    const { controller, sent, setVisible } = makeController({
      visible: [block],
      world: (x, y, z) => x === 2 && y === 1 && z === 0 ? 3 : flatWorld(x, y, z),
    });
    expect(controller.command("scout", 1)).toBe(true);
    setVisible([]);
    tick(controller, 80);
    expect(sent.lines.some((entry) => (entry as { line: string }).line === "found")).toBe(false);
  });

  it("places approved build blocks from lowest Y with coordinate tie-breaks", () => {
    const { controller, sent } = makeController({ owner: { x: 10.5, y: 1, z: 0.5 } });
    controller.reserveBuild("plan-1", [
      { x: 5, y: 3, z: 0, id: 4 },
      { x: 4, y: 1, z: 0, id: 2 },
      { x: 3, y: 1, z: 1, id: 3 },
    ]);
    tick(controller, 20);
    expect(sent.places[0]).toMatchObject({ id: "buddy-1", planId: "plan-1", blockIndex: 2 });
    controller.blockPlaced({ x: 3, y: 1, z: 1, id: 3 });
    tick(controller, 2);
    expect(sent.places[1]).toMatchObject({ blockIndex: 1 });
  });

  it("aborts stale generations before accepting commands", () => {
    const { controller, sent } = makeController();
    controller.setGeneration(4);
    const initial = controller.getState()!;
    expect(controller.command("follow", 3)).toBe(false);
    tick(controller, 30);
    expect(controller.getState()).toMatchObject({ x: initial.x, y: initial.y, z: initial.z });
    expect(sent.lines).toHaveLength(0);
    expect(sent.places).toHaveLength(0);
    expect(controller.getTask()).toBe("stop");
  });

  it("stops and speaks when companion falls below world bounds", () => {
    const { controller, sent } = makeController();
    controller.spawnLocal("staszek", { x: 0.5, y: -21, z: 0.5 });
    controller.tick(0.05);
    expect(sent.stops).toBe(1);
    expect(sent.lines).toContainEqual({ line: "stuck", evidence: undefined });
  });

  it("approaches a valid build site beyond one path segment", () => {
    const { controller, sent } = makeController();
    controller.reserveBuild("plan-far", [{ x: -7, y: 1, z: 18, id: 3 }]);
    tick(controller, 400);
    expect(sent.stops).toBe(0);
    expect(sent.places).toContainEqual({ id: "buddy-1", planId: "plan-far", blockIndex: 0 });
  });

});
