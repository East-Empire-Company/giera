import { describe, expect, it } from "vitest";
import { getSplitViewports, SplitScreenManager } from "../../src/client/render/split-screen";

describe("SplitScreenManager", () => {
  it("calculates correct viewports for 1-player mode", () => {
    const viewports = getSplitViewports(1920, 1080, false);
    expect(viewports.length).toBe(1);
    expect(viewports[0]).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      aspect: 1920 / 1080,
    });
  });

  it("calculates side-by-side viewports for 2-player mode", () => {
    const viewports = getSplitViewports(1920, 1080, true);
    expect(viewports.length).toBe(2);
    expect(viewports[0]).toEqual({
      x: 0,
      y: 0,
      width: 960,
      height: 1080,
      aspect: 960 / 1080,
    });
    expect(viewports[1]).toEqual({
      x: 960,
      y: 0,
      width: 960,
      height: 1080,
      aspect: 960 / 1080,
    });
  });

  it("toggles 1-player and 2-player modes", () => {
    const manager = new SplitScreenManager();
    expect(manager.isSplitScreen).toBe(false);

    manager.setSplitScreen(true);
    expect(manager.isSplitScreen).toBe(true);

    manager.toggle();
    expect(manager.isSplitScreen).toBe(false);
  });

  it("maps Xbox pad buttons correctly without cross-binding", () => {
    const manager = new SplitScreenManager(true);
    const mockPad = {
      connected: true,
      axes: [0, 0, 0, 0],
      buttons: [
        { pressed: true },  // 0: A (jump)
        { pressed: false }, // 1: B
        { pressed: true },  // 2: X (inventory)
        { pressed: false }, // 3: Y
        { pressed: true },  // 4: LB (prevSlot)
        { pressed: false }, // 5: RB
        { pressed: true },  // 6: LT (place)
        { pressed: false }, // 7: RT (mine)
        { pressed: false }, // 8: View
        { pressed: true },  // 9: Menu (toggleSplit)
        { pressed: true },  // 10: LS (sprint)
      ],
    } as unknown as Gamepad;

    const input = manager.pollGamepad(0, () => [mockPad])!;
    expect(input).not.toBeNull();
    expect(input.jump).toBe(true);
    expect(input.toggleInventory).toBe(true);
    expect(input.mine).toBe(false); // X MUST NOT trigger mine!
    expect(input.place).toBe(true); // LT triggers place
    expect(input.toggleSplit).toBe(true); // Menu triggers toggleSplit
    expect(input.prevSlot).toBe(true); // LB
    expect(input.sprint).toBe(true); // LS
  });
});
