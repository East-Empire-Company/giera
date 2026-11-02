import { describe, expect, it } from "vitest";
import { stepActor, stepActorSubdivided, type ActorMotionState } from "../../src/shared/actor-motion";

const move = { forward: 0, right: 0, jump: false, sprint: false };
const air = () => false;
const stateAt = (position: ActorMotionState["position"], overrides: Partial<ActorMotionState> = {}): ActorMotionState => ({
  position: { ...position },
  velocity: { x: 0, y: 0, z: 0 },
  yaw: Math.PI,
  pitch: 0,
  onGround: false,
  jumpHeight: (9 * 9) / (2 * 32),
  flying: false,
  ...overrides,
});

describe("stepActor", () => {
  it("keeps the original 4.3 walk and 5.6 sprint speeds", () => {
    const walker = stateAt({ x: 0, y: 1, z: 0 }, { onGround: true });
    const sprinter = stateAt({ x: 0, y: 1, z: 0 }, { onGround: true });

    stepActor((_, y) => y < 1, walker, { ...move, forward: 1 }, 1 / 60);
    stepActor((_, y) => y < 1, sprinter, { ...move, forward: 1, sprint: true }, 1 / 60);

    expect(Math.hypot(walker.velocity.x, walker.velocity.z)).toBeCloseTo(4.3, 8);
    expect(Math.hypot(sprinter.velocity.x, sprinter.velocity.z)).toBeCloseTo(5.6, 8);
  });

  it("keeps the 9-block jump impulse and 32 gravity", () => {
    const jumper = stateAt({ x: 0, y: 1, z: 0 }, { onGround: true });
    const falling = stateAt({ x: 0, y: 20, z: 0 });

    stepActor((_, y) => y < 1, jumper, { ...move, jump: true }, 1 / 60);
    stepActor(air, falling, move, 0.1);

    expect(jumper.velocity.y).toBe(9);
    expect(falling.velocity.y).toBeCloseTo(-3.2, 8);
  });

  it("uses the original 0.3 horizontal AABB origin and 1.8 height", () => {
    const lowerBody = stateAt({ x: 1.25, y: 1.1958, z: 1.25 }, { flying: true });
    const lowerBodyCells = new Set<string>();
    stepActor((x, y, z) => {
      lowerBodyCells.add(`${x},${y},${z}`);
      return false;
    }, lowerBody, { ...move, jump: true }, 0.001);

    const upperBody = stateAt({ x: 1.25, y: 0.9958, z: 1.25 }, { flying: true });
    const upperBodyCells = new Set<string>();
    stepActor((x, y, z) => {
      upperBodyCells.add(`${x},${y},${z}`);
      return false;
    }, upperBody, { ...move, jump: true }, 0.001);

    expect(lowerBodyCells.has("0,1,0")).toBe(true);
    expect(lowerBodyCells.has("0,3,0")).toBe(true);
    expect(upperBodyCells.has("0,3,0")).toBe(false);
  });

  it("sweeps the Y axis before X and Z", () => {
    const state = stateAt({ x: 1.15, y: 0.95, z: 1.5 }, { flying: true });
    const visited: [number, number, number][] = [];

    stepActor((x, y, z) => {
      visited.push([x, y, z]);
      return false;
    }, state, { ...move, right: 1, jump: true }, 0.1);

    expect(visited[0]).toEqual([0, 1, 1]);
  });

  it("returns landing impact and mutates the supplied state", () => {
    const state = stateAt({ x: 0, y: 1.5, z: 0 }, { velocity: { x: 0, y: -8, z: 0 } });

    const result = stepActor((_, y) => y < 1, state, move, 0.2);

    expect(result).toEqual({ landed: true, impactSpeed: 14.4 });
    expect(state.onGround).toBe(true);
    expect(state.position.y).toBeGreaterThanOrEqual(1);
  });
});

describe("stepActorSubdivided", () => {
  it("caps elapsed time at 0.25 seconds and uses steps no larger than 0.05", () => {
    const state = stateAt({ x: 0, y: 100, z: 0 });

    stepActorSubdivided(air, state, { ...move, forward: 1 }, 1);

    expect(state.velocity.z).toBeCloseTo(4.3 * 0.3 * 0.25, 8);
    expect(state.position.z).toBeCloseTo(0.048375, 8);
  });
});
