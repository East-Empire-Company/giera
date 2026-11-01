import {
  decodeBinaryChunkFrame,
  type ChunkPacket,
  type ClientMessage,
  type PlayerProfile,
  type PlayerState,
  type ServerMessage,
} from "../../shared/lan-protocol";

export type LanClientCallbacks = {
  onWelcome?: (welcome: Extract<ServerMessage, { t: "welcome" }>) => void;
  onBlock?: (block: Extract<ServerMessage, { t: "block" }>) => void;
  onPlayer?: (player: Extract<ServerMessage, { t: "player" }>) => void;
  onJoin?: (join: Extract<ServerMessage, { t: "join" }>) => void;
  onLeave?: (leave: Extract<ServerMessage, { t: "leave" }>) => void;
  onChunk?: (chunk: ChunkPacket) => void;
  onStatusChange?: (status: "connecting" | "connected" | "disconnected") => void;
};

export class LanClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly room: string;
  private readonly playerName: string;
  private readonly profile?: PlayerProfile;
  private readonly host?: boolean;
  private readonly roomName?: string;
  private readonly seed?: number;
  private readonly callbacks: LanClientCallbacks;
  private seq = 0;
  private shouldReconnect = true;
  private ownId: string | null = null;

  constructor(options: {
    url: string;
    room: string;
    playerName: string;
    profile?: PlayerProfile;
    host?: boolean;
    roomName?: string;
    seed?: number;
    callbacks?: LanClientCallbacks;
  }) {
    this.url = options.url;
    this.room = options.room;
    this.playerName = options.playerName;
    this.profile = options.profile;
    this.host = options.host;
    this.roomName = options.roomName;
    this.seed = options.seed;
    this.callbacks = options.callbacks ?? {};
  }

  connect(): void {
    this.shouldReconnect = true;
    this.callbacks.onStatusChange?.("connecting");

    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.callbacks.onStatusChange?.("connected");
        const hello: ClientMessage = { t: "hello", name: this.playerName, room: this.room, profile: this.profile };
        if (this.host) {
          hello.host = true;
          if (this.roomName) hello.roomName = this.roomName;
          if (this.seed !== undefined) hello.seed = this.seed;
        }
        this.send(hello);
      };

      this.ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data);
          try {
            const chunks = decodeBinaryChunkFrame(bytes);
            for (const chunk of chunks) {
              this.callbacks.onChunk?.(chunk);
            }
          } catch (e) {
            console.error("Failed to decode binary chunk frame:", e);
          }
        } else if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data) as ServerMessage;
            if (msg.t === "welcome") {
              this.ownId = msg.id;
              this.callbacks.onWelcome?.(msg);
            } else if (msg.t === "block") this.callbacks.onBlock?.(msg);
            else if (msg.t === "player") this.callbacks.onPlayer?.(msg);
            else if (msg.t === "join") this.callbacks.onJoin?.(msg);
            else if (msg.t === "leave") this.callbacks.onLeave?.(msg);
          } catch (e) {
            console.error("Failed to parse server message:", e);
          }
        }
      };

      this.ws.onclose = () => {
        this.callbacks.onStatusChange?.("disconnected");
        setTimeout(() => {
          if (this.shouldReconnect) this.connect();
        }, 2000);
      };

      this.ws.onerror = (e) => {
        console.warn("LAN WebSocket error:", e);
      };
    } catch (e) {
      this.callbacks.onStatusChange?.("disconnected");
      setTimeout(() => {
        if (this.shouldReconnect) this.connect();
      }, 2000);
    }
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendInput(pos: { x: number; y: number; z: number }, yaw: number, pitch: number, anim: string): void {
    this.seq++;
    this.send({
      t: "input",
      seq: this.seq,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      yaw,
      pitch,
      anim,
    });
  }

  sendBlockEdit(x: number, y: number, z: number, id: number): void {
    this.send({ t: "block", x, y, z, id });
  }

  requestChunk(cx: number, cy: number, cz: number): void {
    this.send({ t: "need", cx, cy, cz });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
