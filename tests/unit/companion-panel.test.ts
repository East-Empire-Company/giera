// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompanionPanel, type CompanionPanel, type CompanionPanelHost } from "../../src/client/ui/companion-panel";

function createHost() {
  return {
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onFollow: vi.fn(),
    onScout: vi.fn(),
    onPreviewCabin: vi.fn(),
    onConfirmCabin: vi.fn(),
    onStop: vi.fn(),
    onMute: vi.fn(),
    onVolume: vi.fn(),
    onTalkStart: vi.fn(),
    onTalkEnd: vi.fn(),
  };
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text));
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

describe("companion panel", () => {
  let panel: CompanionPanel;
  let host: CompanionPanelHost;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = createHost();
    panel = createCompanionPanel(host);
    document.body.append(panel.root);
  });

  afterEach(() => panel.destroy());

  it("renders accessible Polish controls for every companion action", () => {
    expect(panel.root.getAttribute("aria-label")).toBe("Panel towarzysza");
    for (const text of ["Staszek", "Mina", "Dodaj", "Usuń", "Idź za mną", "Szukaj", "Zbuduj domek", "Potwierdź", "Stop", "Głośność", "Przytrzymaj, aby mówić"]) {
      expect(panel.root.textContent).toContain(text);
    }
    expect(panel.root.querySelector('[aria-label="Wycisz pomocnika"]')).not.toBeNull();
  });

  it("calls action callbacks from controls and keeps the chosen model", () => {
    const model = panel.root.querySelector<HTMLSelectElement>("[aria-label='Model towarzysza']");
    expect(model).not.toBeNull();
    if (model) {
      model.value = "mina";
      model.dispatchEvent(new Event("change", { bubbles: true }));
    }

    button(panel.root, "Dodaj").click();
    button(panel.root, "Usuń").click();
    button(panel.root, "Idź za mną").click();
    button(panel.root, "Szukaj").click();
    button(panel.root, "Zbuduj domek").click();
    button(panel.root, "Potwierdź").click();
    button(panel.root, "Stop").click();
    panel.setModelChoice("staszek");

    expect(host.onAdd).toHaveBeenCalledWith("mina");
    expect(host.onRemove).toHaveBeenCalledOnce();
    expect(host.onFollow).toHaveBeenCalledOnce();
    expect(host.onScout).toHaveBeenCalledOnce();
    expect(host.onPreviewCabin).toHaveBeenCalledOnce();
    expect(host.onConfirmCabin).toHaveBeenCalledOnce();
    expect(host.onStop).toHaveBeenCalledOnce();
    expect(model?.value).toBe("staszek");
  });

  it("reports mute and volume changes", () => {
    button(panel.root, "Wycisz").click();
    const volume = panel.root.querySelector<HTMLInputElement>("[aria-label='Głośność pomocnika']");
    expect(volume).not.toBeNull();
    if (volume) {
      volume.value = "0.7";
      volume.dispatchEvent(new Event("input", { bubbles: true }));
    }

    expect(host.onMute).toHaveBeenCalledWith(true);
    expect(host.onVolume).toHaveBeenCalledWith(0.7);
  });

  it("starts and ends hold-to-talk from pointer and keyboard", () => {
    const talk = button(panel.root, "Przytrzymaj, aby mówić");
    talk.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    talk.dispatchEvent(new Event("pointerup", { bubbles: true }));
    talk.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    talk.dispatchEvent(new Event("pointerleave", { bubbles: true }));
    talk.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    talk.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));

    expect(host.onTalkStart).toHaveBeenCalledTimes(3);
    expect(host.onTalkEnd).toHaveBeenCalledTimes(3);
  });

  it("swallows keyboard events and traps focus while open", () => {
    const outside = document.createElement("button");
    document.body.prepend(outside);
    outside.focus();
    panel.open();
    expect(panel.isOpen).toBe(true);
    const focusables = [...panel.root.querySelectorAll<HTMLElement>("button, input, select")].filter((item) => !item.hasAttribute("disabled"));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    outside.focus();
    expect(document.activeElement).toBe(first);
    const bubbled = vi.fn();
    const pointerBubbled = vi.fn();
    document.addEventListener("keydown", bubbled);
    document.addEventListener("pointerdown", pointerBubbled);

    last.focus();
    last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(last);
    button(panel.root, "Przytrzymaj, aby mówić").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(bubbled).not.toHaveBeenCalled();
    expect(pointerBubbled).not.toHaveBeenCalled();

    panel.close();
    expect(panel.isOpen).toBe(false);
    expect(document.activeElement).toBe(outside);
    document.removeEventListener("keydown", bubbled);
    document.removeEventListener("pointerdown", pointerBubbled);
  });
});
