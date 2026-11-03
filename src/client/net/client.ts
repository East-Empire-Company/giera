import {
  decodeBinaryChunkFrame,
  type BuildTask,
  type ChunkPacket,
  type ClientMessage,
  type CompanionProfileId,
  type CompanionState,
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
  onCompanionState?: (message: Extract<ServerMessage, { t: "companion_state" }>) => void;
  onCompanionRemove?: (message: Extract<ServerMessage, { t: "companion_remove" }>) => void;
  onCompanionCommand?: (message: Extract<ServerMessage, { t: "companion_command" }>) => void;
  onOwnerChanged?: (message: Extract<ServerMessage, { t: "owner_changed" }>) => void;
  onCompanionError?: (message: Extract<ServerMessage, { t: "companion_error" }>) => void;
  onCompanionSay?: (message: Extract<ServerMessage, { t: "companion_say" }>) => void;
  onBuildPreview?: (message: Extract<ServerMessage, { t: "build_preview" }>) => void;
  onBuildReserved?: (message: Extract<ServerMessage, { t: "build_reserved" }>) => void;
  onBuildCancelled?: (message: Extract<ServerMessage, { t: "build_cancelled" }>) => void;
  onRoomSyncBegin?: (message: Extract<ServerMessage, { t: "room_sync_begin" }>) => void;
  onRoomSyncPage?: (message: Extract<ServerMessage, { t: "room_sync_page" }>) => void;
  onRoomSyncEnd?: (message: Extract<ServerMessage, { t: "room_sync_end" }>) => void;
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
            else if (msg.t === "companion_state") this.callbacks.onCompanionState?.(msg);
            else if (msg.t === "companion_remove") this.callbacks.onCompanionRemove?.(msg);
            else if (msg.t === "companion_command") this.callbacks.onCompanionCommand?.(msg);
            else if (msg.t === "owner_changed") this.callbacks.onOwnerChanged?.(msg);
            else if (msg.t === "companion_error") this.callbacks.onCompanionError?.(msg);
            else if (msg.t === "companion_say") this.callbacks.onCompanionSay?.(msg);
            else if (msg.t === "build_preview") this.callbacks.onBuildPreview?.(msg);
            else if (msg.t === "build_reserved") this.callbacks.onBuildReserved?.(msg);
            else if (msg.t === "build_cancelled") this.callbacks.onBuildCancelled?.(msg);
            else if (msg.t === "room_sync_begin") this.callbacks.onRoomSyncBegin?.(msg);
            else if (msg.t === "room_sync_page") this.callbacks.onRoomSyncPage?.(msg);
            else if (msg.t === "room_sync_end") this.callbacks.onRoomSyncEnd?.(msg);
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

  sendCompanionSpawn(profile: CompanionProfileId): void {
    this.send({ t: "companion_spawn", profile });
  }

  sendCompanionState(companion: CompanionState): void {
    this.send({ t: "companion_state", companion });
  }

  sendCompanionRemove(id: string): void {
    this.send({ t: "companion_remove", id });
  }

  sendCompanionCommand(task: Exclude<BuildTask, "stop">, expectedGeneration: number): void {
    this.send({ t: "companion_command", task, expectedGeneration });
  }

  sendCompanionStop(): void {
    this.send({ t: "companion_stop" });
  }

  sendCompanionPlace(id: string, planId: string, blockIndex: number): void {
    this.send({ t: "companion_place", id, planId, blockIndex });
  }

  sendCompanionSay(id: string, line: string, evidence?: { block: string; x: number; y: number; z: number }): void {
    this.send(evidence ? { t: "companion_say", id, line, evidence } : { t: "companion_say", id, line });
  }

  sendBuildPreview(expectedGeneration: number): void {
    this.send({ t: "build_preview", requestId: crypto.randomUUID(), expectedGeneration });
  }

  sendBuildConfirm(planId: string): void {
    this.send({ t: "build_confirm", planId });
  }

  roomSyncAck(syncId: string, index: number): void {
    this.send({ t: "room_sync_ack", syncId, index });
  }

  roomSyncStart(): void {
    this.send({ t: "room_sync_start" });
  }

  roomSyncAbort(syncId: string): void {
    this.send({ t: "room_sync_abort", syncId });
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
