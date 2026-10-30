// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LaunchMenuController } from "../../src/client/startup/launch-menu";

function createMenu() {
  document.body.innerHTML = `
    <section id="launch-menu" hidden>
      <button id="launch-start" disabled>Start</button>
      <button id="launch-mode" disabled aria-pressed="false"></button>
      <select id="launch-music" disabled></select>
    </section>
  `;
  const root = document.querySelector<HTMLElement>("#launch-menu")!;
  const startButton = document.querySelector<HTMLButtonElement>("#launch-start")!;
  const modeButton = document.querySelector<HTMLButtonElement>("#launch-mode")!;
  const musicSelect = document.querySelector<HTMLSelectElement>("#launch-music")!;
  const onStart = vi.fn();
  const menu = new LaunchMenuController({ root, startButton, modeButton, musicSelect, onStart });
  return { root, startButton, modeButton, musicSelect, onStart, menu };
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

  it("waits for explicit start and applies the selected real settings", () => {
    const { root, startButton, modeButton, musicSelect, onStart, menu } = createMenu();
    expect(root.hidden).toBe(true);
    expect(onStart).not.toHaveBeenCalled();

    menu.show();
    modeButton.click();
    musicSelect.value = "combat_phonk";
    musicSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(menu.settings).toEqual({ splitScreen: true, musicTrackId: "combat_phonk" });
    expect(onStart).not.toHaveBeenCalled();

    startButton.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

    expect(onStart).toHaveBeenCalledWith({ splitScreen: true, musicTrackId: "combat_phonk" }, "control");
    expect(root.hidden).toBe(true);
  });

  it("moves gamepad focus once per d-pad press", () => {
    const { menu, modeButton, musicSelect } = createMenu();
    menu.show();
    const down = gamepad([13]);

    menu.pollGamepad([down]);
    menu.pollGamepad([down]);
    expect(document.activeElement).toBe(modeButton);

    menu.pollGamepad([gamepad()]);
    menu.pollGamepad([down]);
    expect(document.activeElement).toBe(musicSelect);
  });
  it("edge-triggers analog stick navigation", () => {
    const { menu, modeButton, musicSelect } = createMenu();
    menu.show();
    const down = gamepad([], [0, 0.8]);

    menu.pollGamepad([down]);
    menu.pollGamepad([down]);
    expect(document.activeElement).toBe(modeButton);

    menu.pollGamepad([gamepad()]);
    menu.pollGamepad([down]);
    expect(document.activeElement).toBe(musicSelect);
  });

  it("starts once from the Xbox A button edge", () => {
    const { menu, onStart, root } = createMenu();
    menu.show();
    const confirm = gamepad([0]);

    menu.pollGamepad([confirm]);
    menu.pollGamepad([confirm]);

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith({ splitScreen: false, musicTrackId: "sigma_protocol" }, "gamepad");
    expect(root.hidden).toBe(true);
  });

  it("starts from the first connected gamepad", () => {
    const { menu, onStart } = createMenu();
    menu.show();

    menu.pollGamepad([null, gamepad([0])]);

    expect(onStart).toHaveBeenCalledWith({ splitScreen: false, musicTrackId: "sigma_protocol" }, "gamepad");
  });


  it("supports keyboard focus and setting changes", () => {
    const { menu, modeButton, musicSelect } = createMenu();
    menu.show();

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(modeButton);
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(menu.settings.splitScreen).toBe(true);

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(musicSelect);
    musicSelect.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(menu.settings.musicTrackId).toBe("drift_phonk");
  });
});
