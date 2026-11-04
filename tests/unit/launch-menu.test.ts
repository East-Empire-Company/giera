// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LaunchMenuController } from "../../src/client/startup/launch-menu";

function createMenu() {
  document.body.innerHTML = `
    <section id="launch-menu" hidden>
      <button id="launch-start" disabled>Start</button>
      <button id="launch-mode" disabled aria-pressed="false"></button>
    </section>
  `;
  const root = document.querySelector<HTMLElement>("#launch-menu")!;
  const startButton = document.querySelector<HTMLButtonElement>("#launch-start")!;
  const modeButton = document.querySelector<HTMLButtonElement>("#launch-mode")!;
  const onStart = vi.fn();
  const menu = new LaunchMenuController({
    root,
    startButton,
    modeButton,
    onStart,
    conciergeSession: { close: async () => {} },
  });
  return { root, startButton, modeButton, onStart, menu };
}

function gamepad(pressedButtons: number[] = [], axes: number[] = []): Gamepad {
  return {
    connected: true,
    buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: pressedButtons.includes(index), value: pressedButtons.includes(index) ? 1 : 0 })),
    axes,
  } as unknown as Gamepad;
}

describe("LaunchMenuController", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("waits for start and applies player mode", () => {
    const { root, startButton, modeButton, onStart, menu } = createMenu();
    expect(root.hidden).toBe(true);
    expect(onStart).not.toHaveBeenCalled();

    menu.show();
    modeButton.click();

    expect(menu.settings).toEqual({ splitScreen: true, profile: "ziemek" });
    expect(onStart).not.toHaveBeenCalled();
    startButton.click();

    expect(onStart).toHaveBeenCalledWith({ splitScreen: true, profile: "ziemek" }, "control");
    expect(root.hidden).toBe(true);
  });

  it("moves gamepad focus once per d-pad press", () => {
    const { menu, startButton, modeButton } = createMenu();
    menu.show();
    const down = gamepad([13]);

    menu.pollGamepad([down]);
    menu.pollGamepad([down]);
    expect(document.activeElement).toBe(modeButton);

    menu.pollGamepad([gamepad()]);
    menu.pollGamepad([down]);
    expect(document.activeElement).toBe(startButton);
  });

  it("edge-triggers analog stick navigation", () => {
    const { menu, startButton, modeButton } = createMenu();
    menu.show();
    const down = gamepad([], [0, 0.8]);

    menu.pollGamepad([down]);
    menu.pollGamepad([down]);
    expect(document.activeElement).toBe(modeButton);

    menu.pollGamepad([gamepad()]);
    menu.pollGamepad([down]);
    expect(document.activeElement).toBe(startButton);
  });

  it("starts once from the Xbox A button edge", () => {
    const { menu, onStart, root } = createMenu();
    menu.show();
    const confirm = gamepad([0]);

    menu.pollGamepad([confirm]);
    menu.pollGamepad([confirm]);

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith({ splitScreen: false, profile: "ziemek" }, "gamepad");
    expect(root.hidden).toBe(true);
  });

  it("starts from the first connected gamepad", () => {
    const { menu, onStart } = createMenu();
    menu.show();
    menu.pollGamepad([null, gamepad([0])]);
    expect(onStart).toHaveBeenCalledWith({ splitScreen: false, profile: "ziemek" }, "gamepad");
  });

  it("supports keyboard focus and player-mode changes", () => {
    const { menu, modeButton, startButton } = createMenu();
    menu.show();

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(modeButton);
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(menu.settings.splitScreen).toBe(true);

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(startButton);
  });

  it("reaches the audio sliders with the gamepad and changes volume", () => {
    document.body.innerHTML = `
      <section id="launch-menu" hidden>
        <button id="launch-start" disabled>Start</button>
        <button id="launch-mode" disabled aria-pressed="false"></button>
        <details id="launch-audio-category">
          <summary>Audio</summary>
          <input id="launch-music-volume" data-audio-volume="music" type="range" min="0" max="1" step="0.05" value="0.5" />
        </details>
      </section>
    `;
    const root = document.querySelector<HTMLElement>("#launch-menu")!;
    const startButton = document.querySelector<HTMLButtonElement>("#launch-start")!;
    const modeButton = document.querySelector<HTMLButtonElement>("#launch-mode")!;
    const slider = document.querySelector<HTMLInputElement>("#launch-music-volume")!;
    const details = document.querySelector<HTMLDetailsElement>("#launch-audio-category")!;
    const menu = new LaunchMenuController({
      root,
      startButton,
      modeButton,
      onStart: vi.fn(),
      conciergeSession: { close: async () => {} },
    });
    const volumes: number[] = [];
    slider.addEventListener("input", () => volumes.push(Number(slider.value)));
    menu.show();

    const down = gamepad([13]);
    menu.pollGamepad([down]);
    expect(document.activeElement).toBe(modeButton);
    menu.pollGamepad([gamepad()]);
    menu.pollGamepad([down]);
    expect(document.activeElement).toBe(slider);
    expect(details.open).toBe(true);

    menu.pollGamepad([gamepad([15])]);
    expect(Number(slider.value)).toBeCloseTo(0.55, 5);
    expect(volumes).toEqual([0.55]);
  });
});
