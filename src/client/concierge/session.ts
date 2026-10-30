import { Conversation, type Conversation as ConversationHandle } from "@elevenlabs/client";
import { createConciergeTools, type ConciergeHost, type ConciergeToolHandler } from "./actions";
import { ConciergeAvatar, type ConciergeAvatarState } from "./avatar";

export type ConciergeMenu = "launch" | "pause";
export type ConciergePhase = "closed" | "connecting" | "live" | "failed";
export type ConciergeCloseReason = "menu" | "hidden" | "error" | "disconnect" | "user";

const STATUS_TEXT: Record<ConciergePhase, string> = {
  closed: "",
  connecting: "Iskra się budzi…",
  live: "Mów do Iskry.",
  failed: "Iskra nie może się teraz połączyć.",
};

export type ConciergeSessionOptions = {
  host: ConciergeHost;
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  statusEl: HTMLElement;
  slots: Record<ConciergeMenu, HTMLElement>;
  fetchSignedUrl?: () => Promise<string>;
  onClosed?: (reason: ConciergeCloseReason) => void;
  onPhaseChange?: (phase: ConciergePhase) => void;
};

export class ConciergeSession {
  private phase: ConciergePhase = "closed";
  private conversation: ConversationHandle | null = null;
  private menu: ConciergeMenu | null = null;
  private generation = 0;
  private readonly avatar: ConciergeAvatar;
  private readonly tools: Record<string, ConciergeToolHandler>;

  constructor(private readonly options: ConciergeSessionOptions) {
    this.avatar = new ConciergeAvatar(options.canvas);
    this.tools = createConciergeTools(options.host);
    document.addEventListener("visibilitychange", this.handleVisibility);
    window.addEventListener("pagehide", this.handlePageHide);
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
    this.options.root.hidden = false;
    this.avatar.show(this.phase === "live" ? "listening" : "idle");
    if (this.conversation) return;
    await this.connect();
  }

  async close(reason: ConciergeCloseReason = "menu"): Promise<void> {
    const wasOpen = this.menu !== null;
    this.menu = null;
    this.generation += 1;
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
    void this.close("user");
    this.avatar.dispose();
  }

  resize(): void {
    this.avatar.resize();
  }

  private readonly handleVisibility = (): void => {
    if (document.hidden) void this.close("hidden");
  };

  private readonly handlePageHide = (): void => {
    void this.close("hidden");
  };

  private async connect(): Promise<void> {
    const generation = ++this.generation;
    this.setPhase("connecting");
    try {
      const signedUrl = await this.resolveSignedUrl();
      if (this.isStale(generation)) return;
      const conversation = await Conversation.startSession({
        signedUrl,
        connectionType: "websocket",
        clientTools: this.clientTools(),
        onConnect: () => {
          if (this.isStale(generation)) return;
          this.setPhase("live");
          this.avatar.setState("listening");
        },
        onModeChange: ({ mode }) => {
          if (this.isStale(generation)) return;
          this.avatar.setState(mode === "speaking" ? "speaking" : "listening");
        },
        onDisconnect: () => {
          if (this.isStale(generation)) return;
          this.conversation = null;
          this.setPhase("failed");
          void this.close("disconnect");
        },
        onError: () => {
          if (this.isStale(generation)) return;
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

  private setPhase(phase: ConciergePhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.options.statusEl.textContent = STATUS_TEXT[phase];
    this.options.statusEl.dataset.phase = phase;
    this.options.onPhaseChange?.(phase);
  }

  setAvatarState(state: ConciergeAvatarState): void {
    this.avatar.setState(state);
  }
}