import { BLOCK_BY_ID } from "../src/shared/blocks";
import { CHUNK_SIZE, WORLD_HEIGHT } from "../src/shared/chunk";
import { MAX_PLAYER_SPEED, encodeBinaryChunkFrame, isValidPlayerSpeed, type PlayerProfile, type ServerMessage } from "../src/shared/lan-protocol";
import type { RoomState } from "./room";

export const DEFAULT_ROOM = "DOM1";
export const DEFAULT_NAME = "Gracz";
export const MAX_ROOM_CODE_LENGTH = 16;
export const MAX_NAME_LENGTH = 24;
export const MAX_ANIM_LENGTH = 32;
export const MAX_ROOMS = 64;
export const MAX_EDITS_PER_ROOM = 200_000;
export const MAX_COORD = 1 << 20;
export const MAX_FIRST_INPUT_DISTANCE = 512;

const ROOM_CODE_PATTERN = /^[A-Z0-9_-]+$/;
const MIN_PLAYER_Y = -64;
const MAX_PLAYER_Y = WORLD_HEIGHT * 4;
const MAX_CHUNK_Y = WORLD_HEIGHT / CHUNK_SIZE - 1;
const MAX_CHUNK_HORIZONTAL = Math.floor(MAX_COORD / CHUNK_SIZE);

export type WsConnection = {
  id: string;
  roomCode: string;
  name: string;
  lastAcceptTime: number;
  hadInput: boolean;
  joined: boolean;
};

export type WsSocket = {
  data: WsConnection;
  send(payload: string | Uint8Array): void;
  subscribe(topic: string): void;
};

export type RoomRegistry = {
  get(code: string): RoomState | undefined;
  getOrCreate(code: string): RoomState | undefined;
  entries(): IterableIterator<[string, RoomState]>;
};

export type WsDeps = {
  rooms: RoomRegistry;
  publish: (topic: string, payload: string) => void;
  now: () => number;
};

export function createWsConnection(id: string, now: number): WsConnection {
  return { id, roomCode: DEFAULT_ROOM, name: DEFAULT_NAME, lastAcceptTime: now, hadInput: false, joined: false };
}

export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase() || DEFAULT_ROOM;
  if (code.length > MAX_ROOM_CODE_LENGTH || !ROOM_CODE_PATTERN.test(code)) return null;
  return code;
}

export function createRoomRegistry(
  maxRooms: number,
  load: (code: string) => RoomState,
  onEvict: (code: string, room: RoomState) => boolean = () => true,
): RoomRegistry {
  const rooms = new Map<string, RoomState>();
  return {
    get: (code) => rooms.get(code),
    getOrCreate(code) {
      let room = rooms.get(code);
      if (!room) {
        if (rooms.size >= maxRooms) {
          let idle: [string, RoomState] | undefined;
          for (const entry of rooms) {
            if (entry[1].getPlayerCount() === 0) {
              idle = entry;
              break;
            }
          }
          if (!idle || !onEvict(idle[0], idle[1])) return undefined;
          rooms.delete(idle[0]);
        }
        room = load(code);
        rooms.set(code, room);
      }
      return room;
    },
    entries: () => rooms.entries(),
  };
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function handleHello(ws: WsSocket, msg: Record<string, unknown>, deps: WsDeps): void {
  const data = ws.data;
  if (data.joined) return;
  const code = normalizeRoomCode(msg.room);
  if (code === null) return;
  const name = (typeof msg.name === "string" ? msg.name.trim() : "").slice(0, MAX_NAME_LENGTH) || DEFAULT_NAME;
  const room = deps.rooms.getOrCreate(code);
  if (!room) return;

  if (msg.host === true && typeof msg.roomName === "string") {
    room.setName(msg.roomName);
  }

  if (msg.host === true && typeof msg.seed === "number" && Number.isInteger(msg.seed)) {
    room.setSeedIfFresh(msg.seed);
  }

  data.roomCode = code;
  data.name = name;
  data.joined = true;

  const requested = (typeof msg.profile === "string" && (msg.profile === "ziemek" || msg.profile === "gniewko")) ? msg.profile as PlayerProfile : "ziemek";
  const existing = room.getAllPlayers().map((p) => p.profile);
  let profile = requested;
  if (existing.includes(profile)) {
    profile = profile === "ziemek" ? "gniewko" : "ziemek";
    if (existing.includes(profile)) {
      profile = requested; // both taken, allow duplicate for >2 players
    }
  }

  const player = room.addPlayer(data.id, name, profile);

  const welcome: ServerMessage = {
    t: "welcome",
    id: data.id,
    seed: room.seed,
    spawn: [player.x, player.y, player.z],
    slot: player.slot ?? 0,
    players: room.getAllPlayers().filter((p) => p.id !== data.id),
    roomName: room.getName(),
    profile,
  };
  ws.send(JSON.stringify(welcome));
  const join: ServerMessage = { t: "join", id: data.id, name, profile, slot: player.slot ?? 0 };
  deps.publish(`room:${code}`, JSON.stringify(join));
  ws.subscribe(`room:${code}`);
}

function handleNeed(ws: WsSocket, msg: Record<string, unknown>, deps: WsDeps): void {
  const room = ws.data.joined ? deps.rooms.get(ws.data.roomCode) : undefined;
  if (!room) return;
  const { cx, cy, cz } = msg;
  if (!isInt(cx, -MAX_CHUNK_HORIZONTAL, MAX_CHUNK_HORIZONTAL)) return;
  if (!isInt(cy, 0, MAX_CHUNK_Y)) return;
  if (!isInt(cz, -MAX_CHUNK_HORIZONTAL, MAX_CHUNK_HORIZONTAL)) return;
  ws.send(encodeBinaryChunkFrame([{ cx, cy, cz, rleData: room.getChunkRLE(cx, cy, cz) }]));
}

function handleBlock(ws: WsSocket, msg: Record<string, unknown>, deps: WsDeps): void {
  const room = ws.data.joined ? deps.rooms.get(ws.data.roomCode) : undefined;
  if (!room) return;
  const { x, y, z, id } = msg;
  if (!isInt(x, -MAX_COORD, MAX_COORD)) return;
  if (!isInt(y, 0, WORLD_HEIGHT - 1)) return;
  if (!isInt(z, -MAX_COORD, MAX_COORD)) return;
  if (typeof id !== "number" || !Object.hasOwn(BLOCK_BY_ID, id)) return;
  if (room.getBlock(x, y, z) === undefined && room.getEditCount() >= MAX_EDITS_PER_ROOM) return;
  room.setBlock(x, y, z, id);
  const broadcast: ServerMessage = { t: "block", x, y, z, id, by: ws.data.id };
  deps.publish(`room:${ws.data.roomCode}`, JSON.stringify(broadcast));
}

function handleInput(ws: WsSocket, msg: Record<string, unknown>, deps: WsDeps): void {
  const data = ws.data;
  const room = data.joined ? deps.rooms.get(data.roomCode) : undefined;
  const player = room?.getPlayer(data.id);
  if (!room || !player) return;
  const { x, y, z, yaw, pitch, anim } = msg;
  if (!isFiniteNum(x) || Math.abs(x) > MAX_COORD) return;
  if (!isFiniteNum(y) || y < MIN_PLAYER_Y || y > MAX_PLAYER_Y) return;
  if (!isFiniteNum(z) || Math.abs(z) > MAX_COORD) return;
  if (!isFiniteNum(yaw) || !isFiniteNum(pitch)) return;
  if (typeof anim !== "string" || anim.length > MAX_ANIM_LENGTH) return;

  const now = deps.now();
  if (data.hadInput) {
    const dt = Math.max(0.01, (now - data.lastAcceptTime) / 1000);
    if (!isValidPlayerSpeed(player, { x, y, z }, dt)) return;
  } else {
    const reach = MAX_FIRST_INPUT_DISTANCE + MAX_PLAYER_SPEED * Math.max(0, (now - data.lastAcceptTime) / 1000);
    if (Math.hypot(x - player.x, y - player.y, z - player.z) > reach) return;
  }
  data.hadInput = true;
  data.lastAcceptTime = now;
  room.updatePlayer(data.id, { x, y, z, yaw, pitch, anim });
  const state: ServerMessage = { t: "player", id: data.id, name: data.name, profile: player.profile, x, y, z, yaw, pitch, anim };
  deps.publish(`room:${data.roomCode}`, JSON.stringify(state));
}

export function handleWsMessage(ws: WsSocket, raw: unknown, deps: WsDeps): void {
  if (typeof raw !== "string") return;
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof msg !== "object" || msg === null) return;
  const m = msg as Record<string, unknown>;
  if (m.t === "hello") handleHello(ws, m, deps);
  else if (m.t === "need") handleNeed(ws, m, deps);
  else if (m.t === "block") handleBlock(ws, m, deps);
  else if (m.t === "input") handleInput(ws, m, deps);
}

export function handleWsClose(ws: WsSocket, deps: WsDeps): void {
  if (!ws.data.joined) return;
  const room = deps.rooms.get(ws.data.roomCode);
  if (!room) return;
  room.removePlayer(ws.data.id);
  const leave: ServerMessage = { t: "leave", id: ws.data.id };
  deps.publish(`room:${ws.data.roomCode}`, JSON.stringify(leave));
}
