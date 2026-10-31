export type LaunchSettings = { splitScreen: boolean };
export type LaunchStartSource = "control" | "gamepad";

type LaunchMenuOptions = {
  root: HTMLElement;
  startButton: HTMLButtonElement;
  modeButton: HTMLButtonElement;
  onStart: (settings: LaunchSettings, source: LaunchStartSource) => void;
};

export class LaunchMenuController {
  private readonly controls: readonly HTMLElement[];
  private focusedIndex = 0;
  private splitScreen = false;
  private started = false;
  private previousButtons = new Set<number>();
  private previousStickDirection: number | null = null;

  constructor(private readonly options: LaunchMenuOptions) {
    const { root, startButton, modeButton } = options;
    const audioInputs = Array.from(root.querySelectorAll<HTMLInputElement>("input[data-audio-volume]"));
    this.controls = [startButton, modeButton, ...audioInputs];
    this.renderMode();

    startButton.addEventListener("click", () => this.start("control"));
    modeButton.addEventListener("click", () => this.toggleSplitScreen());
    root.addEventListener("focusin", (event) => {
      const index = this.controls.indexOf(event.target as HTMLElement);
      if (index >= 0) this.focusedIndex = index;
    });
    root.addEventListener("keydown", (event) => this.handleKeydown(event));
  }

  get settings(): LaunchSettings {
    return { splitScreen: this.splitScreen };
  }

  get isStarted(): boolean {
    return this.started;
  }

  show(): void {
    if (this.started) return;
    this.options.root.hidden = false;
    this.options.startButton.disabled = false;
    this.options.modeButton.disabled = false;
    this.focusControl(0);
  }

  pollGamepad(gamepads?: readonly (Gamepad | null)[]): void {
    gamepads ??= typeof navigator !== "undefined" && navigator.getGamepads
      ? Array.from(navigator.getGamepads())
      : [];
    const pad = gamepads.find((candidate) => candidate?.connected) ?? null;
    const pressed = new Set<number>();
    if (pad) {
      for (let index = 0; index < pad.buttons.length; index++) {
        if (pad.buttons[index]?.pressed) pressed.add(index);
      }
    }
    const edge = (index: number): boolean => pressed.has(index) && !this.previousButtons.has(index);
    const stickDirection = this.readStickDirection(pad);

    if (!this.started && !this.options.root.hidden) {
      const dpadDirection = [12, 13, 14, 15].find(edge);
      const direction = dpadDirection ?? (stickDirection !== null && stickDirection !== this.previousStickDirection ? stickDirection : null);
      if (direction !== null) this.handleDirection(direction);
      if (edge(0)) this.activate("gamepad");
      if (!this.started && edge(1)) this.focusControl(0);
    }

    this.previousButtons = pressed;
    this.previousStickDirection = stickDirection;
  }

  private readStickDirection(pad: Gamepad | null): number | null {
    if (!pad) return null;
    const horizontal = pad.axes[0] ?? 0;
    const vertical = pad.axes[1] ?? 0;
    if (vertical <= -0.6) return 12;
    if (vertical >= 0.6) return 13;
    if (horizontal <= -0.6) return 14;
    if (horizontal >= 0.6) return 15;
    return null;
  }

  private handleDirection(button: number): void {
    if (button === 12) this.moveFocus(-1);
    else if (button === 13) this.moveFocus(1);
    else if (button === 14) this.adjustSelection(-1);
    else if (button === 15) this.adjustSelection(1);
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (this.started || this.options.root.hidden) return;
    const active = document.activeElement;
    if (event.key === "Tab") {
      const index = this.controls.indexOf(active as HTMLElement);
      if (event.shiftKey && index === 0) {
        event.preventDefault();
        this.focusControl(this.controls.length - 1);
      } else if (!event.shiftKey && index === this.controls.length - 1) {
        event.preventDefault();
        this.focusControl(0);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.moveFocus(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (active === this.options.modeButton) {
        event.preventDefault();
        this.toggleSplitScreen();
      }
    } else if (event.key === "Escape" && active !== this.options.startButton) {
      event.preventDefault();
      this.focusControl(0);
    }
  }

  private moveFocus(amount: number): void {
    this.focusControl((this.focusedIndex + amount + this.controls.length) % this.controls.length);
  }

  private focusControl(index: number): void {
    this.focusedIndex = index;
    const control = this.controls[index];
    const details = control.closest("details");
    if (details instanceof HTMLDetailsElement) details.open = true;
    control.focus();
  }

  private adjustSelection(amount: number): void {
    if (this.focusedIndex === 1) {
      this.toggleSplitScreen();
      return;
    }
    const control = this.controls[this.focusedIndex];
    if (!(control instanceof HTMLInputElement) || control.type !== "range") return;
    const step = Number(control.step) || 0.05;
    const min = Number(control.min);
    const max = Number(control.max);
    const next = Math.min(max, Math.max(min, Number(control.value) + amount * step));
    control.value = String(next);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }

  private activate(source: LaunchStartSource): void {
    if (this.focusedIndex === 0) this.start(source);
    else if (this.focusedIndex === 1) this.toggleSplitScreen();
  }

  private toggleSplitScreen(): void {
    this.splitScreen = !this.splitScreen;
    this.renderMode();
  }

  private renderMode(): void {
    this.options.modeButton.setAttribute("aria-pressed", String(this.splitScreen));
    this.options.modeButton.setAttribute("aria-label", this.splitScreen ? "Tryb dla 2 graczy" : "Tryb dla 1 gracza");
    this.options.modeButton.textContent = this.splitScreen ? "2 gracze" : "1 gracz";
  }

  private start(source: LaunchStartSource): void {
    if (this.started || this.options.root.hidden || this.options.startButton.disabled) return;
    this.started = true;
    this.options.root.hidden = true;
    this.options.startButton.disabled = true;
    this.options.modeButton.disabled = true;
    this.options.onStart(this.settings, source);
  }
}
