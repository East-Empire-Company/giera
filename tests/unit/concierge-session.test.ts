// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const endSession = vi.fn(async () => {});
const startSession = vi.fn();

vi.mock("@elevenlabs/client", () => ({
  Conversation: { startSession: (...args: unknown[]) => startSession(...args) },
}));

vi.mock("@openavatar/core", () => ({ parse: () => ({ document: {} }) }));

vi.mock("@openavatar/three", () => ({
  OpenAvatarStage: class {
    load(): void {}
    setInput(): void {}
    start(): void {}
    stop(): void {}
    play(): void {}
    resize(): void {}
    dispose(): void {}
  },
}));

import { ConciergeSession } from "../../src/client/concierge/session";
import type { ConciergeHost } from "../../src/client/concierge/actions";

const host: ConciergeHost = {
  status: () => ({
    started: false,
    splitScreen: false,
    musicTrackId: "sigma",
    musicName: "Sigma Phonk",
    volume: 0.8,
    coins: 0,
    tier: 0,
  }),
  setMusicTrack: () => "Sigma Phonk",
  setSplitScreen: () => {},
  setVolume: (level) => level,
  teleportToSpawn: () => {},
  reload: () => {},
};

type Harness = {
  session: ConciergeSession;
  panel: HTMLElement;
  launchSlot: HTMLElement;
  pauseSlot: HTMLElement;
  onClosed: ReturnType<typeof vi.fn>;
};

const build = (signedUrl = Promise.resolve("wss://signed")): Harness => {
  document.body.innerHTML = `
    <div id="launch-slot"></div>
    <div id="pause-slot"></div>
    <div id="panel" hidden><canvas id="canvas"></canvas><p id="status"></p></div>
  `;
  const panel = document.querySelector<HTMLElement>("#panel")!;
  const onClosed = vi.fn();
  const session = new ConciergeSession({
    host,
    root: panel,
    canvas: document.querySelector<HTMLCanvasElement>("#canvas")!,
    statusEl: document.querySelector<HTMLElement>("#status")!,
    slots: {
      launch: document.querySelector<HTMLElement>("#launch-slot")!,
      pause: document.querySelector<HTMLElement>("#pause-slot")!,
    },
    fetchSignedUrl: () => signedUrl,
    onClosed,
  });
  return {
    session,
    panel,
    launchSlot: document.querySelector<HTMLElement>("#launch-slot")!,
    pauseSlot: document.querySelector<HTMLElement>("#pause-slot")!,
    onClosed,
  };
};

const setHidden = (hidden: boolean): void => {
  Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("ConciergeSession", () => {
  beforeEach(() => {
    endSession.mockClear();
    startSession.mockReset();
    startSession.mockImplementation(async () => ({ endSession }));
    setHidden(false);
  });

  it("mounts the panel into the open menu slot and starts one session", async () => {
    const h = build();
    await h.session.open("launch");

    expect(h.panel.parentElement).toBe(h.launchSlot);
    expect(h.panel.hidden).toBe(false);
    expect(startSession).toHaveBeenCalledTimes(1);

    await h.session.open("pause");
    expect(h.panel.parentElement).toBe(h.pauseSlot);
    expect(startSession).toHaveBeenCalledTimes(1);
    h.session.dispose();
  });

  it("hides the panel and ends the session when the menu closes", async () => {
    const h = build();
    await h.session.open("pause");
    await h.session.close("menu");

    expect(h.panel.hidden).toBe(true);
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(h.onClosed).toHaveBeenCalledWith("menu");
    expect(h.session.isOpen).toBe(false);
    h.session.dispose();
  });

  it("closes the session when the page is hidden", async () => {
    const h = build();
    await h.session.open("launch");

    setHidden(true);
    await vi.waitFor(() => expect(h.onClosed).toHaveBeenCalledWith("hidden"));

    expect(endSession).toHaveBeenCalledTimes(1);
    h.session.dispose();
  });

  it("does not reopen while the page stays hidden", async () => {
    const h = build();
    setHidden(true);

    await h.session.open("launch");

    expect(startSession).not.toHaveBeenCalled();
    expect(h.panel.hidden).toBe(true);
    h.session.dispose();
  });

  it("ends a connection that resolves after the menu closed", async () => {
    const lateEnd = vi.fn(async () => {});
    const { promise: pending, resolve: resolveStart } = Promise.withResolvers<unknown>();
    startSession.mockImplementation(() => pending);
    const h = build();

    const opening = h.session.open("launch");
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledTimes(1));
    await h.session.close("menu");
    resolveStart({ endSession: lateEnd });
    await opening;

    expect(lateEnd).toHaveBeenCalledTimes(1);
    h.session.dispose();
  });

  it("keeps the failure message visible when the signed url fetch fails", async () => {
    const h = build();
    const session = new ConciergeSession({
      host,
      root: h.panel,
      canvas: document.querySelector<HTMLCanvasElement>("#canvas")!,
      statusEl: document.querySelector<HTMLElement>("#status")!,
      slots: { launch: h.launchSlot, pause: h.pauseSlot },
      fetchSignedUrl: () => Promise.reject(new Error("concierge_session_429")),
    });
    await session.open("launch");

    const status = document.querySelector<HTMLElement>("#status")!;
    expect(status.dataset.phase).toBe("failed");
    expect(status.textContent).toContain("połączyć");
    expect(h.panel.hidden).toBe(false);
    expect(startSession).not.toHaveBeenCalled();
    session.dispose();
    h.session.dispose();
  });

  it("returns a kid-safe fallback when a tool throws", async () => {
    const h = build();
    const throwingHost: ConciergeHost = {
      ...host,
      teleportToSpawn: () => {
        throw new Error("boom");
      },
    };
    const session = new ConciergeSession({
      host: throwingHost,
      root: h.panel,
      canvas: document.querySelector<HTMLCanvasElement>("#canvas")!,
      statusEl: document.querySelector<HTMLElement>("#status")!,
      slots: { launch: h.launchSlot, pause: h.pauseSlot },
      fetchSignedUrl: () => Promise.resolve("wss://signed"),
    });
    await session.open("launch");

    const tools = startSession.mock.calls[0][0].clientTools as Record<string, (params: unknown) => Promise<string>>;
    await expect(tools.teleport_to_spawn({})).resolves.toContain("spróbował");
    session.dispose();
    h.session.dispose();
  });
});