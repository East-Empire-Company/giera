import { describe, expect, it } from "vitest";
import { TycoonElevator } from "../../src/client/game/tycoon-elevator";

const origin = { x: 0, y: 60, z: 0 };
const ground = { x: 1.5, y: 61, z: 1.5 };
const upper = { x: 1.5, y: 65, z: 3.5 };

function finishRide(elevator: TycoonElevator, start: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  let pose = start;
  for (let frame = 0; frame < 90; frame++) pose = elevator.step(0, pose, 1 / 60, true) ?? pose;
  return pose;
}

describe("TycoonElevator", () => {
  it("rides up in 1.2 seconds and does not immediately reverse", () => {
    const elevator = new TycoonElevator(origin);
    expect(elevator.step(0, ground, 1 / 60, true)).toEqual(ground);
    const arrived = finishRide(elevator, ground);

    expect(arrived).toEqual(upper);
    expect(elevator.platformHeight()).toBe(4);
    expect(elevator.step(0, arrived, 1 / 60, true)).toBeNull();
  });

  it("rides down only after leaving and re-entering the upper call pad", () => {
    const elevator = new TycoonElevator(origin);
    elevator.step(0, ground, 1 / 60, true);
    const arrived = finishRide(elevator, ground);
    expect(elevator.step(0, arrived, 1 / 60, true)).toBeNull();

    const away = { x: 1.5, y: 65, z: 5.5 };
    expect(elevator.step(0, away, 1 / 60, true)).toBeNull();
    expect(elevator.step(0, upper, 1 / 60, true)).toEqual(upper);
    const returned = finishRide(elevator, upper);

    expect(returned).toEqual(ground);
    expect(elevator.platformHeight()).toBe(0);
    expect(elevator.step(0, returned, 1 / 60, true)).toBeNull();
  });

  it("allows only one split player to own the platform", () => {
    const elevator = new TycoonElevator(origin);
    expect(elevator.step(0, ground, 1 / 60, true)).toEqual(ground);
    expect(elevator.step(1, ground, 1 / 60, true)).toBeNull();
    expect(elevator.step(0, ground, 1 / 60, true)).not.toBeNull();
  });

  it("stays inactive without stage 2 and resets an interrupted ride", () => {
    const elevator = new TycoonElevator(origin);
    expect(elevator.step(0, ground, 1 / 60, false)).toBeNull();
    elevator.step(0, ground, 1 / 60, true);
    elevator.step(0, ground, 0.3, true);
    expect(elevator.platformHeight()).toBeGreaterThan(0);

    elevator.reset();
    expect(elevator.platformHeight()).toBe(0);
    expect(elevator.step(1, ground, 1 / 60, true)).toEqual(ground);
  });
});
