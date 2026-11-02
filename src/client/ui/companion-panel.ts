import type { CompanionProfileId } from "../../shared/companion";

export type CompanionPanelHost = {
  onAdd(profile: CompanionProfileId): void;
  onRemove(): void;
  onFollow(): void;
  onScout(): void;
  onPreviewCabin(): void;
  onConfirmCabin(): void;
  onStop(): void;
  onMute(muted: boolean): void;
  onVolume(level: number): void;
  onTalkStart(): void;
  onTalkEnd(): void;
};

export type CompanionPanel = {
  root: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  setModelChoice(profile: CompanionProfileId): void;
  setBusy(busy: boolean): void;
  destroy(): void;
};

function makeButton(label: string, icon: string, onClick?: () => void, className = ""): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `companion-panel__button ${className}`.trim();
  const glyph = document.createElement("span");
  glyph.className = "companion-panel__icon";
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = icon;
  const text = document.createElement("span");
  text.textContent = label;
  button.append(glyph, text);
  if (onClick) button.addEventListener("click", onClick);
  return button;
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])")];
}

export function createCompanionPanel(host: CompanionPanelHost): CompanionPanel {
  const root = document.createElement("aside");
  root.className = "companion-panel";
  root.setAttribute("aria-label", "Panel towarzysza");
  root.hidden = true;

  const header = document.createElement("header");
  header.className = "companion-panel__header";
  const title = document.createElement("h2");
  title.textContent = "Towarzysz";
  const emblem = document.createElement("span");
  emblem.className = "companion-panel__emblem";
  emblem.setAttribute("aria-hidden", "true");
  emblem.textContent = "♙";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "companion-panel__close";
  closeButton.setAttribute("aria-label", "Zamknij panel towarzysza");
  closeButton.textContent = "×";
  header.append(emblem, title, closeButton);
  root.append(header);

  const modelLabel = document.createElement("label");
  modelLabel.className = "companion-panel__model-label";
  modelLabel.htmlFor = "companion-model-choice";
  modelLabel.textContent = "Wybierz towarzysza";
  const modelSelect = document.createElement("select");
  modelSelect.id = "companion-model-choice";
  modelSelect.setAttribute("aria-label", "Model towarzysza");
  for (const [value, label] of [["staszek", "Staszek"], ["mina", "Mina"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    modelSelect.append(option);
  }
  const modelRow = document.createElement("div");
  modelRow.className = "companion-panel__model";
  modelRow.append(modelLabel, modelSelect);
  root.append(modelRow);

  const actions = document.createElement("div");
  actions.className = "companion-panel__actions";
  const busyControls: HTMLButtonElement[] = [];
  const addButton = makeButton("Dodaj", "+", () => host.onAdd(modelSelect.value as CompanionProfileId), "companion-panel__primary");
  const removeButton = makeButton("Usuń", "−", () => host.onRemove());
  const followButton = makeButton("Idź za mną", "↗", () => host.onFollow());
  const scoutButton = makeButton("Szukaj", "⌕", () => host.onScout());
  const previewButton = makeButton("Zbuduj domek", "⌂", () => host.onPreviewCabin(), "companion-panel__wide");
  const confirmButton = makeButton("Potwierdź", "✓", () => host.onConfirmCabin());
  const stopButton = makeButton("Stop", "■", () => host.onStop(), "companion-panel__stop");
  busyControls.push(addButton, removeButton, followButton, scoutButton, previewButton, confirmButton);
  actions.append(addButton, removeButton, followButton, scoutButton, previewButton, confirmButton, stopButton);
  root.append(actions);

  let muted = false;
  const muteButton = makeButton("Wycisz", "◖", () => {
    muted = !muted;
    muteButton.setAttribute("aria-pressed", String(muted));
    muteButton.setAttribute("aria-label", muted ? "Włącz dźwięk pomocnika" : "Wycisz pomocnika");
    muteButton.lastElementChild!.textContent = muted ? "Włącz dźwięk" : "Wycisz";
    host.onMute(muted);
  }, "companion-panel__mute");
  muteButton.setAttribute("aria-label", "Wycisz pomocnika");
  muteButton.setAttribute("aria-pressed", "false");

  const volumeLabel = document.createElement("label");
  volumeLabel.htmlFor = "companion-volume";
  volumeLabel.textContent = "Głośność";
  const volume = document.createElement("input");
  volume.id = "companion-volume";
  volume.type = "range";
  volume.min = "0";
  volume.max = "1";
  volume.step = "0.05";
  volume.value = "0.7";
  volume.setAttribute("aria-label", "Głośność pomocnika");
  volume.addEventListener("input", () => host.onVolume(volume.valueAsNumber));
  const audioControls = document.createElement("div");
  audioControls.className = "companion-panel__audio";
  audioControls.append(muteButton, volumeLabel, volume);
  root.append(audioControls);

  let talkActive = false;
  const talkButton = makeButton("Przytrzymaj, aby mówić", "◉", undefined, "companion-panel__talk");
  talkButton.setAttribute("aria-label", "Przytrzymaj, aby mówić");
  const startTalk = (): void => {
    if (talkActive) return;
    talkActive = true;
    host.onTalkStart();
  };
  const endTalk = (): void => {
    if (!talkActive) return;
    talkActive = false;
    host.onTalkEnd();
  };
  talkButton.addEventListener("pointerdown", startTalk);
  talkButton.addEventListener("pointerup", endTalk);
  talkButton.addEventListener("pointerleave", endTalk);
  talkButton.addEventListener("pointercancel", endTalk);
  talkButton.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      startTalk();
    }
  });
  talkButton.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") endTalk();
  });
  talkButton.addEventListener("blur", endTalk);
  root.append(talkButton);

  let previousFocus: HTMLElement | null = null;
  let open = false;
  const trapFocus = (event: FocusEvent): void => {
    if (!open || (event.target instanceof Node && root.contains(event.target))) return;
    focusableElements(root)[0]?.focus();
  };
  const close = (): void => {
    if (!open) return;
    open = false;
    document.removeEventListener("focusin", trapFocus);
    root.hidden = true;
    endTalk();
    const focus = previousFocus;
    previousFocus = null;
    focus?.focus();
  };
  closeButton.addEventListener("click", close);
  const onKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = focusableElements(root);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  const stopPropagation = (event: Event): void => event.stopPropagation();
  const containedEvents = ["keyup", "keypress", "click", "input", "change", "wheel", "pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "pointercancel", "pointerleave", "mousedown", "mouseup", "touchstart", "touchend"] as const;
  root.addEventListener("keydown", onKeyDown);
  for (const type of containedEvents) root.addEventListener(type, stopPropagation);

  return {
    root,
    open() {
      if (open) return;
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      open = true;
      document.addEventListener("focusin", trapFocus);
      root.hidden = false;
      focusableElements(root)[0]?.focus();
    },
    close,
    get isOpen() {
      return open;
    },
    setModelChoice(profile) {
      modelSelect.value = profile;
    },
    setBusy(busy) {
      root.setAttribute("aria-busy", String(busy));
      for (const control of busyControls) control.disabled = busy;
    },
    destroy() {
      close();
      for (const type of containedEvents) root.removeEventListener(type, stopPropagation);
      root.removeEventListener("keydown", onKeyDown);
      root.remove();
    },
  };
}
