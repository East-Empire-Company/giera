import { describe, expect, it } from "vitest";
import { TouchController } from "../../src/client/input/touch";

describe("TouchController", () => {
  it("initializes with zero movement and look deltas", () => {
    const touch = new TouchController();
    const input = touch.getInput();
    expect(input.forward).toBe(0);
    expect(input.right).toBe(0);
    expect(input.lookX).toBe(0);
    expect(input.lookY).toBe(0);
    expect(input.jump).toBe(false);
  });

  it("calculates clamped joystick vector from touch offset", () => {
    const touch = new TouchController();
    // Start joystick touch at (100, 300)
    touch.handleTouchStart("joy-1", 100, 300, 800); // screen width 800 -> left half
    // Drag forward by 50px (y decreases)
    touch.handleTouchMove("joy-1", 100, 250);

    const input = touch.getInput();
    expect(input.forward).toBeGreaterThan(0.5);
    expect(input.right).toBe(0);

    touch.handleTouchEnd("joy-1");
    expect(touch.getInput().forward).toBe(0);
  });

  it("handles camera rotation from right half touch drag", () => {
    const touch = new TouchController();
    // Start look touch on right half (500, 300)
    touch.handleTouchStart("look-1", 500, 300, 800);
    touch.handleTouchMove("look-1", 520, 290);

    const input = touch.consumeLook();
    expect(input.lookX).toBe(20);
    expect(input.lookY).toBe(-10);

    // consumeLook resets accumulator
    expect(touch.consumeLook().lookX).toBe(0);
  });
});
