// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { LanMenuController } from "../../src/client/game/lan-menu";
import type { LanServerSummary } from "../../src/shared/lan-protocol";

function makeRoot(): HTMLElement {
  const root = document.createElement("div");
  root.id = "pause-lan-panel";
  document.body.appendChild(root);
  return root;
}

const FAKE_SERVERS: LanServerSummary[] = [
  {
    host: "macstudio",
    ip: "192.168.1.10",
    port: 8080,
    rooms: [{ code: "DOM1", name: "Dom Ziemka", players: 1, seed: 424242 }],
  },
];

function makeController(overrides: {
  onHost?: ReturnType<typeof vi.fn<(roomName: string, seed: number) => Promise<boolean>>>;
  onJoin?: ReturnType<typeof vi.fn<(url: string, room: string, seed: number) => Promise<boolean>>>;
  onScan?: ReturnType<typeof vi.fn<() => Promise<LanServerSummary[]>>>;
  onClose?: ReturnType<typeof vi.fn<() => void>>;
} = {}): { controller: LanMenuController; root: HTMLElement; fns: Record<string, ReturnType<typeof vi.fn>> } {
  const root = makeRoot();
  const onHost = overrides.onHost ?? vi.fn<(roomName: string, seed: number) => Promise<boolean>>().mockResolvedValue(true);
  const onJoin = overrides.onJoin ?? vi.fn<(url: string, room: string, seed: number) => Promise<boolean>>().mockResolvedValue(true);
  const onScan = overrides.onScan ?? vi.fn<() => Promise<LanServerSummary[]>>().mockResolvedValue(FAKE_SERVERS);
  const onClose = overrides.onClose ?? vi.fn<() => void>();
  const controller = new LanMenuController({ root, onHost, onJoin, onScan, onClose });
  return { controller, root, fns: { onHost, onJoin, onScan, onClose } };
}

describe("LanMenuController", () => {
  it("open renders choice view with host and join buttons", () => {
    const { controller, root } = makeController();
    controller.openMenu();
    expect(controller.isOpen).toBe(true);
    expect(root.hidden).toBe(false);
    const buttons = root.querySelectorAll("button");
    const texts = Array.from(buttons).map((b) => b.textContent);
    expect(texts).toContain("🏠 Załóż nową grę");
    expect(texts).toContain("🔍 Dołącz do gry");
  });

  it("clicking host shows room-name input", () => {
    const { controller, root } = makeController();
    controller.openMenu();
    const hostBtn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "🏠 Załóż nową grę")!;
    hostBtn.click();
    expect(root.querySelector("#lan-host-name")).toBeTruthy();
  });

  it("clicking join triggers onScan and renders server cards", async () => {
    const { controller, root, fns } = makeController();
    controller.openMenu();
    const joinBtn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "🔍 Dołącz do gry")!;
    joinBtn.click();
    await vi.waitFor(() => {
      expect(fns.onScan).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(root.querySelectorAll(".lan-room-card").length).toBe(1);
    });
  });

  it("clicking a room card calls onJoin with the server URL, room code, and seed", async () => {
    const { controller, root, fns } = makeController();
    controller.openMenu();
    const joinBtn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "🔍 Dołącz do gry")!;
    joinBtn.click();
    await vi.waitFor(() => {
      expect(root.querySelector(".lan-room-card")).toBeTruthy();
    });
    const card = root.querySelector(".lan-room-card") as HTMLButtonElement;
    card.click();
    await vi.waitFor(() => {
      expect(fns.onJoin).toHaveBeenCalledWith("ws://192.168.1.10:8080/ws", "DOM1", 424242);
    });
  });

  it("manual-address submit calls onJoin with the typed URL", async () => {
    const { controller, root, fns } = makeController({ onScan: vi.fn().mockResolvedValue([]) });
    controller.openMenu();
    const joinBtn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "🔍 Dołącz do gry")!;
    joinBtn.click();
    await vi.waitFor(() => {
      expect(fns.onScan).toHaveBeenCalled();
    });
    const urlInput = root.querySelector("#lan-manual-url") as HTMLInputElement;
    urlInput.value = "ws://127.0.0.1:8791/ws";
    const connectBtn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "✅ Połącz")!;
    connectBtn.click();
    await vi.waitFor(() => {
      expect(fns.onJoin).toHaveBeenCalledWith("ws://127.0.0.1:8791/ws", "DOM1", 0);
    });
  });
  it("does not let a pending scan overwrite manual connection status", async () => {
    let finishScan!: (servers: LanServerSummary[]) => void;
    const onScan = vi.fn(() => new Promise<LanServerSummary[]>((resolve) => { finishScan = resolve; }));
    const { controller, root } = makeController({ onScan });
    controller.openMenu();
    root.querySelectorAll("button")[1].click();
    const urlInput = root.querySelector("#lan-manual-url") as HTMLInputElement;
    urlInput.value = "ws://127.0.0.1:8791/ws";
    (Array.from(root.querySelectorAll("button")).find((button) => button.textContent === "✅ Połącz") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector("#lan-status")?.textContent).toBe("Połączono"));
    finishScan([]);
    await Promise.resolve();
    expect(root.querySelector("#lan-status")?.textContent).toBe("Połączono");
  });

  it("close hides the panel and calls onClose", () => {
    const { controller, root, fns } = makeController();
    controller.openMenu();
    controller.close();
    expect(controller.isOpen).toBe(false);
    expect(root.hidden).toBe(true);
    expect(fns.onClose).toHaveBeenCalled();
  });
});
