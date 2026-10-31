import { Conversation, type Conversation as ConversationHandle } from "@elevenlabs/client";
import { createConciergeTools, type ConciergeHost, type ConciergeToolHandler } from "./actions";
import { ConciergeAvatar, type ConciergeAvatarState } from "./avatar";
import { MIC_ERROR_MESSAGES, classifyMicError, type MicErrorCode } from "../../shared/mic-errors";

export type ConciergeMenu = "launch" | "pause";
export type ConciergePhase = "closed" | "connecting" | "live" | "failed";
export type ConciergeCloseReason = "menu" | "hidden" | "error" | "disconnect" | "user";

export const CONNECT_TIMEOUT_MS = 12_000;

const STATUS_TEXT: Record<ConciergePhase, string> = {
  closed: "",
  connecting: "Iskra się budzi…",
  live: "Mów do Iskry.",
  failed: "Iskra nie może się teraz połączyć.",
};

export type MicProbeResult = { ok: boolean; code: MicErrorCode | null };

export type ConciergeSessionOptions = {
  host: ConciergeHost;
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  statusEl: HTMLElement;
  slots: Record<ConciergeMenu, HTMLElement>;
  retryEl?: HTMLElement | null;
  fetchSignedUrl?: () => Promise<string>;
  connectTimeoutMs?: number;
  probeMicrophone?: () => Promise<MicProbeResult>;
  onClosed?: (reason: ConciergeCloseReason) => void;
  onPhaseChange?: (phase: ConciergePhase) => void;
};

export class ConciergeSession {
  private phase: ConciergePhase = "closed";
  private conversation: ConversationHandle | null = null;
  private menu: ConciergeMenu | null = null;
  private lastMenu: ConciergeMenu | null = null;
  private generation = 0;
  private connectTimer: number | null = null;
  private speechVolume = 1;
  private readonly avatar: ConciergeAvatar;
  private readonly tools: Record<string, ConciergeToolHandler>;

  constructor(private readonly options: ConciergeSessionOptions) {
    this.avatar = new ConciergeAvatar(options.canvas);
    this.tools = createConciergeTools(options.host);
    document.addEventListener("visibilitychange", this.handleVisibility);
    window.addEventListener("pagehide", this.handlePageHide);
    this.options.retryEl?.addEventListener("click", this.handleRetry);
  }

  get isOpen(): boolean {
    return this.menu !== null;
  }

  get currentMenu(): ConciergeMenu | null {
    return this.menu;
  }

  get currentPhase(): ConciergePhase {
    return this.phase;
  }

  async open(menu: ConciergeMenu): Promise<void> {
    if (document.hidden) return;
    const slot = this.options.slots[menu];
    if (this.options.root.parentElement !== slot) slot.append(this.options.root);
    this.menu = menu;
    this.lastMenu = menu;
    this.hideRetry();
    this.options.root.hidden = false;
    this.avatar.show(this.phase === "live" ? "listening" : "idle");
    if (this.conversation) return;
    await this.connect();
  }

  async close(reason: ConciergeCloseReason = "menu"): Promise<void> {
    const wasOpen = this.menu !== null;
    this.menu = null;
    this.generation += 1;
    this.clearConnectTimeout();
    this.avatar.hide();
    this.options.root.hidden = reason !== "error" && reason !== "disconnect";
    const conversation = this.conversation;
    this.conversation = null;
    if (reason !== "error" && reason !== "disconnect") this.setPhase("closed");
    if (conversation) {
      try {
        await conversation.endSession();
      } catch {
        void 0;
      }
    }
    if (wasOpen) this.options.onClosed?.(reason);
  }

  dispose(): void {
    document.removeEventListener("visibilitychange", this.handleVisibility);
    window.removeEventListener("pagehide", this.handlePageHide);
    this.options.retryEl?.removeEventListener("click", this.handleRetry);
    void this.close("user");
    this.avatar.dispose();
  }

  resize(): void {
    this.avatar.resize();
  }

  async retry(): Promise<void> {
    if (!this.lastMenu || this.conversation) return;
    this.menu = this.lastMenu;
    this.options.root.hidden = false;
    this.hideRetry();
    await this.connect();
  }

  private readonly handleRetry = (): void => {
    void this.retry();
  };

  private readonly handleVisibility = (): void => {
    if (document.hidden) void this.close("hidden");
  };

  private readonly handlePageHide = (): void => {
    void this.close("hidden");
  };

  private async connect(): Promise<void> {
    const generation = ++this.generation;
    this.setPhase("connecting");
    this.armConnectTimeout(generation);
    try {
      const mic = await this.probeMicrophone();
      if (this.isStale(generation)) return;
      if (!mic.ok) {
        this.clearConnectTimeout();
        this.setPhase("failed");
        this.options.statusEl.textContent = mic.code ? MIC_ERROR_MESSAGES[mic.code] : STATUS_TEXT.failed;
        this.showRetry();
        return;
      }
      const signedUrl = await this.resolveSignedUrl();
      if (this.isStale(generation)) return;
      const firstMessage =
        this.menu === "pause"
          ? "No co tam, ziomy"
          : "Siema, kapuchy. Jestem Iskra, dawaj do gry";
      const conversation = await Conversation.startSession({
        signedUrl,
        connectionType: "websocket",
        clientTools: this.clientTools(),
        overrides: {
          agent: {
            firstMessage,
          },
        },
        onConnect: () => {
          if (this.isStale(generation)) return;
          this.clearConnectTimeout();
          this.setPhase("live");
          this.avatar.setState("listening");
        },
        onModeChange: ({ mode }) => {
          if (this.isStale(generation)) return;
          this.avatar.setState(mode === "speaking" ? "speaking" : "listening");
        },
        onDisconnect: () => {
          if (this.isStale(generation)) return;
          this.clearConnectTimeout();
          this.conversation = null;
          this.setPhase("failed");
          void this.close("disconnect");
        },
        onError: () => {
          if (this.isStale(generation)) return;
          this.clearConnectTimeout();
          this.conversation = null;
          this.setPhase("failed");
          void this.close("error");
        },
      });
      if (this.isStale(generation)) {
        await conversation.endSession().catch(() => void 0);
        return;
      }
      this.conversation = conversation;
      if (conversation.type === "voice") conversation.setVolume({ volume: this.speechVolume });
    } catch {
      if (this.isStale(generation)) return;
      this.setPhase("failed");
      await this.close("error");
    }
  }

  private clientTools(): Record<string, (parameters: unknown) => Promise<string>> {
    const wrapped: Record<string, (parameters: unknown) => Promise<string>> = {};
    for (const [name, handler] of Object.entries(this.tools)) {
      wrapped[name] = async (parameters) => {
        try {
          const params = parameters && typeof parameters === "object" ? (parameters as Record<string, unknown>) : {};
          return await handler(params);
        } catch {
          return "Nie udało się. Powiedz dziecku, żeby spróbował jeszcze raz.";
        }
      };
    }
    return wrapped;
  }

  private async probeMicrophone(): Promise<MicProbeResult> {
    if (this.options.probeMicrophone) return this.options.probeMicrophone();
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!media || typeof media.getUserMedia !== "function") return { ok: false, code: "unsupported" };
    try {
      const stream = await media.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      return { ok: true, code: null };
    } catch (error) {
      return { ok: false, code: classifyMicError(error) };
    }
  }

  private showRetry(): void {
    const retryEl = this.options.retryEl;
    if (retryEl) retryEl.hidden = false;
  }

  private hideRetry(): void {
    const retryEl = this.options.retryEl;
    if (retryEl) retryEl.hidden = true;
  }

  private async resolveSignedUrl(): Promise<string> {
    if (this.options.fetchSignedUrl) return this.options.fetchSignedUrl();
    const response = await fetch("/concierge/session", { method: "POST" });
    if (!response.ok) throw new Error(`concierge_session_${response.status}`);
    const body = (await response.json()) as { signedUrl?: string };
    if (!body.signedUrl) throw new Error("concierge_signed_url_missing");
    return body.signedUrl;
  }

  private isStale(generation: number): boolean {
    return generation !== this.generation || this.menu === null;
  }

  private armConnectTimeout(generation: number): void {
    this.clearConnectTimeout();
    this.connectTimer = window.setTimeout(() => {
      this.connectTimer = null;
      if (this.isStale(generation)) return;
      this.conversation = null;
      this.setPhase("failed");
      void this.close("error");
    }, this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);
  }

  private clearConnectTimeout(): void {
    if (this.connectTimer === null) return;
    window.clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private setPhase(phase: ConciergePhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.options.statusEl.textContent = STATUS_TEXT[phase];
    this.options.statusEl.dataset.phase = phase;
    this.options.onPhaseChange?.(phase);
  }

  setSpeechVolume(volume: number): void {
    this.speechVolume = volume;
    if (this.conversation?.type === "voice") this.conversation.setVolume({ volume });
  }

  setAvatarState(state: ConciergeAvatarState): void {
    this.avatar.setState(state);
  }
}