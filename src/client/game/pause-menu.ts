import { LAUNCH_PLAYLIST } from "../startup/launch-menu";

export type PauseMenuOptions = {
  root: HTMLElement;
  resumeButton: HTMLButtonElement;
  modeButton: HTMLButtonElement;
  musicSelect: HTMLSelectElement;
  getSplitScreen: () => boolean;
  getTrackId: () => string;
  onResume: () => void;
  onToggleSplit: () => void;
  onSelectTrack: (id: string) => void;
  onOpen: () => void;
  onClose: () => void;
};

export class PauseMenuController {
  private opened = false;

  constructor(private readonly options: PauseMenuOptions) {
    const { musicSelect, resumeButton, modeButton, root } = options;
    musicSelect.replaceChildren(
      ...LAUNCH_PLAYLIST.map(({ id, name }) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = name;
        return option;
      })
    );
    resumeButton.addEventListener("click", () => this.options.onResume());
    modeButton.addEventListener("click", () => this.options.onToggleSplit());
    musicSelect.addEventListener("change", () => this.options.onSelectTrack(musicSelect.value));
    root.addEventListener("keydown", (event) => {
      if (event.key === "Tab") return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") event.preventDefault();
    });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.sync();
    this.options.root.hidden = false;
    this.options.resumeButton.focus({ preventScroll: true });
    this.options.onOpen();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.options.root.hidden = true;
    this.options.onClose();
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  sync(): void {
    const split = this.options.getSplitScreen();
    this.options.modeButton.setAttribute("aria-pressed", String(split));
    this.options.modeButton.setAttribute("aria-label", split ? "Tryb dla 2 graczy" : "Tryb dla 1 gracza");
    this.options.modeButton.textContent = split ? "2 gracze" : "1 gracz";
    this.options.musicSelect.value = this.options.getTrackId();
  }
}