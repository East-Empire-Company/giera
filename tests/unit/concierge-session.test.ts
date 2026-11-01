// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const endSession = vi.fn(async () => {});
const setConversationVolume = vi.fn();
const startSession = vi.fn();

vi.mock("@elevenlabs/client", () => ({
  Conversation: { startSession: (...args: unknown[]) => startSession(...args) },
}));

import { ConciergeSession } from "../../src/client/concierge/session";
import type { ConciergeHost } from "../../src/client/concierge/actions";
import type { ConciergeSessionOptions } from "../../src/client/concierge/session";
import { BLOCK_ID } from "../../src/shared/blocks";
import { createMinePlan, applyMinePlan } from "../../src/client/game/terrain-cheats";
import { GameInventory } from "../../src/client/game/inventory";

const host: ConciergeHost = {
  status: () => ({
    started: false,
    splitScreen: false,
    volume: 0.8,
    coins: 0,
    stars: 0,
    tier: 0,
  }),
  setSplitScreen: () => {},
  setVolume: (level) => level,
  setJumpHeight: () => 0,
  setFlying: () => false,
  buildHouse: () => null,
  digMine: () => null,
  buyExpansion: () => ({ bought: false, stars: 0, cost: 20 }),
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

const build = (
  signedUrl = Promise.resolve("wss://signed"),
  overrides: Partial<ConciergeSessionOptions> = {},
): Harness => {
  document.body.innerHTML = `
    <div id="launch-slot"></div>
    <div id="pause-slot"></div>
    <div id="panel" hidden><canvas id="canvas"></canvas><p id="status"></p><button id="retry" hidden></button></div>
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
    retryEl: document.querySelector<HTMLButtonElement>("#retry"),
    fetchSignedUrl: () => signedUrl,
    probeMicrophone: async () => ({ ok: true, code: null }),
    onClosed,
    ...overrides,
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
    setConversationVolume.mockClear();
    startSession.mockReset();
    startSession.mockImplementation(async () => ({ endSession, type: "voice", setVolume: setConversationVolume }));
    setHidden(false);
  });
  it("executes a mine request through the connected conversation tool callback", async () => {
    const terrain = new Map<string, number>();
    const edited = new Set<string>();
    for (let x = -2; x <= 2; x++) {
      for (let y = 41; y <= 42; y++) {
        for (let z = 0; z <= 12; z++) terrain.set(`${x},${y},${z}`, BLOCK_ID.stone);
      }
    }
    const world = {
      getBlock: (x: number, y: number, z: number) => terrain.get(`${x},${y},${z}`) ?? BLOCK_ID.air,
      hasEdit: (x: number, y: number, z: number) => edited.has(`${x},${y},${z}`),
      setBlock: (x: number, y: number, z: number, id: number) => {
        const key = `${x},${y},${z}`;
        terrain.set(key, id);
        edited.add(key);
      },
    };
    const inventory = new GameInventory();
    const miningHost: ConciergeHost = {
      ...host,
      status: () => ({ ...host.status(), started: true }),
      digMine: () => {
        const plan = createMinePlan(world, { x: 0.5, y: 41, z: 0.5, yaw: Math.PI });
        return plan && applyMinePlan(plan, world, inventory) ? plan.blocks.length : null;
      },
    };
    let tools: Record<string, (parameters: unknown) => Promise<string>> | undefined;
    startSession.mockImplementationOnce(async (options: {
      clientTools?: Record<string, (parameters: unknown) => Promise<string>>;
      onConnect?: () => void;
    }) => {
      tools = options.clientTools;
      options.onConnect?.();
      return { endSession, type: "voice", setVolume: setConversationVolume };
    });
    const h = build(Promise.resolve("wss://signed"), { host: miningHost });
    await h.session.open("pause");

    const response = await tools!.dig_mine({});

    expect(response).toContain("32 bloków");
    expect(terrain.get("0,41,1")).toBe(BLOCK_ID.air);
    expect(terrain.get("0,41,2")).toBe(BLOCK_ID.air);
    expect(Object.values(inventory.toJSON().chunkEdits).reduce((sum, count) => sum + count, 0)).toBe(32);
    await h.session.close();
  });
  it("keeps speech volume changes made while connecting", async () => {
    const { promise: pending, resolve: resolveStart } = Promise.withResolvers<unknown>();
    startSession.mockImplementation(() => pending);
    const h = build();
    const opening = h.session.open("launch");
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledTimes(1));

    h.session.setSpeechVolume(0.35);
    resolveStart({ endSession, type: "voice", setVolume: setConversationVolume });
    await opening;

    expect(setConversationVolume).toHaveBeenLastCalledWith({ volume: 0.35 });
    h.session.setSpeechVolume(0.65);
    expect(setConversationVolume).toHaveBeenLastCalledWith({ volume: 0.65 });
    h.session.dispose();
  });

  it("does not apply speech volume to text-only conversations", async () => {
    const unsupportedVolume = vi.fn(() => {
      throw new Error("text conversations do not support volume");
    });
    startSession.mockImplementationOnce(async () => ({ endSession, type: "text", setVolume: unsupportedVolume }));
    const h = build();

    await h.session.open("launch");
    h.session.setSpeechVolume(0.5);

    expect(unsupportedVolume).not.toHaveBeenCalled();
    h.session.dispose();
  });

  it("restores selected speech volume after reopening", async () => {
    const h = build();
    await h.session.open("launch");
    h.session.setSpeechVolume(0.35);
    await h.session.close("menu");

    await h.session.open("pause");

    expect(setConversationVolume).toHaveBeenLastCalledWith({ volume: 0.35 });
    h.session.dispose();
  });

  it("mounts the panel into the open menu slot and starts one session", async () => {
    const h = build();
    await h.session.open("launch");

    expect(h.panel.parentElement).toBe(h.launchSlot);
    expect(h.panel.hidden).toBe(false);
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(startSession.mock.calls[0][0].overrides?.agent?.firstMessage).toContain("Siema, kapuchy");

    await h.session.close("menu");
    await h.session.open("pause");
    expect(h.panel.parentElement).toBe(h.pauseSlot);
    expect(startSession).toHaveBeenCalledTimes(2);
    expect(startSession.mock.calls[1][0].overrides?.agent?.firstMessage).toContain("No co tam, ziomy");
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

  it("fails the panel when the conversation never connects", async () => {
    vi.useFakeTimers();
    try {
      const h = build(Promise.resolve("wss://signed"), { connectTimeoutMs: 100 });
      await h.session.open("launch");

      await vi.advanceTimersByTimeAsync(100);

      const status = document.querySelector<HTMLElement>("#status")!;
      expect(status.dataset.phase).toBe("failed");
      expect(status.textContent).toContain("połączyć");
      expect(h.panel.hidden).toBe(false);
      h.session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays live when the conversation connects before the timeout", async () => {
    startSession.mockImplementation(async (options: { onConnect?: () => void }) => {
      options.onConnect?.();
      return { endSession, type: "voice", setVolume: setConversationVolume };
    });
    vi.useFakeTimers();
    try {
      const h = build(Promise.resolve("wss://signed"), { connectTimeoutMs: 100 });
      await h.session.open("launch");
      expect(h.session.currentPhase).toBe("live");

      await vi.advanceTimersByTimeAsync(500);

      expect(h.session.currentPhase).toBe("live");
      h.session.dispose();
    } finally {
      vi.useRealTimers();
    }
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
      probeMicrophone: async () => ({ ok: true, code: null }),
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

  it("explains the microphone problem and never connects when capture is denied", async () => {
    const h = build(Promise.resolve("wss://signed"), {
      probeMicrophone: async () => ({ ok: false, code: "denied" }),
    });

    await h.session.open("launch");

    const status = document.querySelector<HTMLElement>("#status")!;
    expect(status.dataset.phase).toBe("failed");
    expect(status.textContent).toContain("mikrofon");
    expect(startSession).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLButtonElement>("#retry")!.hidden).toBe(false);
    h.session.dispose();
  });

  it("connects on retry once the microphone works", async () => {
    let micOk = false;
    const h = build(Promise.resolve("wss://signed"), {
      probeMicrophone: async () => (micOk ? { ok: true, code: null } : { ok: false, code: "busy" }),
    });
    await h.session.open("launch");
    expect(startSession).not.toHaveBeenCalled();

    micOk = true;
    document.querySelector<HTMLButtonElement>("#retry")!.click();

    await vi.waitFor(() => expect(startSession).toHaveBeenCalledTimes(1));
    expect(document.querySelector<HTMLButtonElement>("#retry")!.hidden).toBe(true);
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
      probeMicrophone: async () => ({ ok: true, code: null }),
    });
    await session.open("launch");

    const tools = startSession.mock.calls[0][0].clientTools as Record<string, (params: unknown) => Promise<string>>;
    await expect(tools.teleport_to_spawn({})).resolves.toContain("spróbował");
    session.dispose();
    h.session.dispose();
  });
});