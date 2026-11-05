import { BLOCK_BY_ID, BLOCK_ID } from "../src/shared/blocks";
import { CHUNK_SIZE, WORLD_HEIGHT } from "../src/shared/chunk";
import {
  COMPANION_ANIMS,
  COMPANION_TASKS,
  MAX_PLAYER_SPEED,
  encodeBinaryChunkFrame,
  isValidPlayerMotion,
  isValidPlayerSpeed,
  type BuildBlock,
  type BuildTask,
  type CompanionProfileId,
  type CompanionState,
  type PlayerProfile,
  type ServerMessage,
} from "../src/shared/lan-protocol";
import { COMPANION_PROFILES } from "../src/shared/companion";
import { createHousePlan } from "../src/shared/house-plan";
import { MAX_TYCOON_SLOTS, TYCOON_SITE_BOUNDS, tycoonSiteSlot, tycoonSlotOrigin } from "../src/shared/tycoon-slots";
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
export const SYNC_PAGE_SIZE = 256;
export const SYNC_EXPIRY_MS = 10_000;
export const COMPANION_SPAWN_RADIUS = 4;
export const PLACE_REACH_BLOCKS = 8;
export const PROTECTED_DUMMY_RADIUS = 1;
export const TRAINING_DUMMY_POS = { x: 1.5, z: 3 };

const ROOM_CODE_PATTERN = /^[A-Z0-9_-]+$/;
const MIN_PLAYER_Y = -64;
const MAX_PLAYER_Y = WORLD_HEIGHT * 4;
const MAX_CHUNK_Y = WORLD_HEIGHT / CHUNK_SIZE - 1;
const MAX_CHUNK_HORIZONTAL = Math.floor(MAX_COORD / CHUNK_SIZE);

type SyncSession = {
  syncId: string;
  entries: BuildBlock[];
  next: number;
  lastProgress: number;
};

export type WsConnection = {
  id: string;
  roomCode: string;
  name: string;
  lastAcceptTime: number;
  hadInput: boolean;
  joined: boolean;
  sync: SyncSession | null;
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
  return { id, roomCode: DEFAULT_ROOM, name: DEFAULT_NAME, lastAcceptTime: now, hadInput: false, joined: false, sync: null };
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

  const isFirstConnection = room.getPlayerCount() === 0 && room.getOwnerId() === null;
  if (isFirstConnection) {
    room.setOwnerId(data.id);
    if (msg.host === true && typeof msg.roomName === "string") {
      room.setName(msg.roomName);
    }
    if (msg.host === true && typeof msg.seed === "number" && Number.isInteger(msg.seed)) {
      room.setSeedIfFresh(msg.seed);
    }
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
  ws.subscribe(`room:${code}`);

  const welcome: ServerMessage = {
    t: "welcome",
    id: data.id,
    seed: room.seed,
    spawn: [player.x, player.y, player.z],
    slot: player.slot ?? 0,
    players: room.getAllPlayers().filter((p) => p.id !== data.id),
    roomName: room.getName(),
    profile,
    ownerId: room.getOwnerId(),
    companion: room.getCompanion(),
    generation: room.getGeneration(),
    buildPreview: room.getBuildPreview(),
  };
  ws.send(JSON.stringify(welcome));
  const join: ServerMessage = { t: "join", id: data.id, name, profile, slot: player.slot ?? 0 };
  deps.publish(`room:${code}`, JSON.stringify(join));
  startRoomSync(ws, room, deps);
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
  const preview = room.getBuildPreview();
  const conflicts = preview ? preview.blocks.some((b, i) => !preview.placed.includes(i) && b.x === x && b.y === y && b.z === z) : false;
  room.setBlock(x, y, z, id);
  const broadcast: ServerMessage = { t: "block", x, y, z, id, by: ws.data.id };
  deps.publish(`room:${ws.data.roomCode}`, JSON.stringify(broadcast));
  if (conflicts && preview) {
    room.setBuildPreview(null);
    room.bumpGeneration();
    deps.publish(`room:${ws.data.roomCode}`, JSON.stringify({ t: "build_cancelled", planId: preview.planId, reason: "human_edit" } satisfies ServerMessage));
    const stop: ServerMessage = { t: "companion_command", task: "stop", by: ws.data.id, generation: room.getGeneration() };
    deps.publish(`room:${ws.data.roomCode}`, JSON.stringify(stop));
  }
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
  if (room.getOwnerId() === data.id) room.markOwnerPose();
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
  else if (m.t === "companion_spawn") handleCompanionSpawn(ws, m, deps);
  else if (m.t === "companion_state") handleCompanionState(ws, m, deps);
  else if (m.t === "companion_remove") handleCompanionRemove(ws, m, deps);
  else if (m.t === "companion_command") handleCompanionCommand(ws, m, deps);
  else if (m.t === "companion_stop") handleCompanionStop(ws, m, deps);
  else if (m.t === "companion_place") handleCompanionPlace(ws, m, deps);
  else if (m.t === "companion_say") handleCompanionSay(ws, m, deps);
  else if (m.t === "build_preview") handleBuildPreview(ws, m, deps);
  else if (m.t === "build_confirm") handleBuildConfirm(ws, m, deps);
  else if (m.t === "room_sync_start" || m.t === "room_sync_ack" || m.t === "room_sync_abort") handleRoomSyncMessage(ws, m, deps);
}

export function handleWsClose(ws: WsSocket, deps: WsDeps): void {
  if (!ws.data.joined) return;
  const room = deps.rooms.get(ws.data.roomCode);
  if (!room) return;
  room.removePlayer(ws.data.id);
  ws.data.sync = null;
  const leave: ServerMessage = { t: "leave", id: ws.data.id };
  deps.publish(`room:${ws.data.roomCode}`, JSON.stringify(leave));
  if (room.getOwnerId() !== ws.data.id) return;
  if (room.getCompanion()) {
    const removed: ServerMessage = { t: "companion_remove", id: room.getCompanion()!.id };
    room.setCompanion(null);
    deps.publish(`room:${ws.data.roomCode}`, JSON.stringify(removed));
  }
  if (room.getBuildPreview()) {
    const cancelled: ServerMessage = { t: "build_cancelled", planId: room.getBuildPreview()!.planId, reason: "owner_left" };
    room.setBuildPreview(null);
    deps.publish(`room:${ws.data.roomCode}`, JSON.stringify(cancelled));
  }
  const heir = room.getAllPlayers()[0];
  room.setOwnerId(heir ? heir.id : null);
  room.bumpGeneration();
  const changed: ServerMessage = { t: "owner_changed", ownerId: room.getOwnerId() };
  deps.publish(`room:${ws.data.roomCode}`, JSON.stringify(changed));
}

function sendCompanionError(ws: WsSocket, room: RoomState, message: string): void {
  ws.send(JSON.stringify({ t: "companion_error", message, generation: room.getGeneration() } satisfies ServerMessage));
}

const isOwner = (ws: WsSocket, room: RoomState): boolean => room.getOwnerId() === ws.data.id;

const joinedRoom = (ws: WsSocket, deps: WsDeps): RoomState | undefined =>
  ws.data.joined ? deps.rooms.get(ws.data.roomCode) : undefined;

const publish = (ws: WsSocket, deps: WsDeps, message: ServerMessage): void =>
  deps.publish(`room:${ws.data.roomCode}`, JSON.stringify(message));

function startRoomSync(ws: WsSocket, room: RoomState, deps: WsDeps): void {
  const session: SyncSession = {
    syncId: crypto.randomUUID(),
    entries: room.editEntries(),
    next: 0,
    lastProgress: deps.now(),
  };
  ws.data.sync = session;
  ws.send(JSON.stringify({ t: "room_sync_begin", syncId: session.syncId } satisfies ServerMessage));
  sendNextSyncPage(ws, session);
}

function sendNextSyncPage(ws: WsSocket, session: SyncSession): void {
  const start = session.next * SYNC_PAGE_SIZE;
  if (start >= session.entries.length) {
    ws.send(JSON.stringify({ t: "room_sync_end", syncId: session.syncId } satisfies ServerMessage));
    ws.data.sync = null;
    return;
  }
  const edits = session.entries.slice(start, start + SYNC_PAGE_SIZE);
  ws.send(JSON.stringify({ t: "room_sync_page", syncId: session.syncId, index: session.next, edits } satisfies ServerMessage));
  session.next += 1;
}

function handleRoomSyncMessage(ws: WsSocket, msg: Record<string, unknown>, deps: WsDeps): void {
  const room = joinedRoom(ws, deps);
  if (!room) return;
  if (msg.t === "room_sync_start") {
    startRoomSync(ws, room, deps);
    return;
  }
  if (msg.t === "room_sync_abort") {
    if (ws.data.sync && ws.data.sync.syncId === msg.syncId) ws.data.sync = null;
    return;
  }
  const session = ws.data.sync;
  if (!session || session.syncId !== msg.syncId) return;
  if (deps.now() - session.lastProgress > SYNC_EXPIRY_MS) {
    ws.data.sync = null;
    return;
  }
  const { index } = msg;
  if (!isInt(index, 0, session.next) || index !== session.next - 1) return;
  session.lastProgress = deps.now();
  sendNextSyncPage(ws, session);
}

function findCompanionSpawn(room: RoomState, owner: { x: number; z: number }): { x: number; y: number; z: number } | null {
  const baseX = Math.round(owner.x);
  const baseZ = Math.round(owner.z);
  const candidates: { dx: number; dz: number }[] = [];
  for (let dx = -COMPANION_SPAWN_RADIUS; dx <= COMPANION_SPAWN_RADIUS; dx++) {
    for (let dz = -COMPANION_SPAWN_RADIUS; dz <= COMPANION_SPAWN_RADIUS; dz++) {
      candidates.push({ dx, dz });
    }
  }
  candidates.sort((a, b) => (a.dx * a.dx + a.dz * a.dz) - (b.dx * b.dx + b.dz * b.dz) || a.dx - b.dx || a.dz - b.dz);
  for (const { dx, dz } of candidates) {
    const x = baseX + dx;
    const z = baseZ + dz;
    const top = room.surfaceColumnTop(x, z);
    const feet = top + 1;
    if (feet + 1 >= WORLD_HEIGHT) continue;
    if (room.getWorldBlock(x, feet, z) !== BLOCK_ID.air) continue;
    if (room.getWorldBlock(x, feet + 1, z) !== BLOCK_ID.air) continue;
    return { x: x + 0.5, y: feet, z: z + 0.5 };
  }
  return null;
}

function validateCompanionState(room: RoomState, msg: Record<string, unknown>, deps: WsDeps): CompanionState | null {
  const companion = room.getCompanion();
  if (!companion) return null;
  const raw = msg.companion;
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (c.id !== companion.id || c.profile !== companion.profile) return null;
  const { x, y, z, yaw, anim } = c;
  if (!isFiniteNum(x) || Math.abs(x) > MAX_COORD) return null;
  if (!isFiniteNum(y) || y < MIN_PLAYER_Y || y > MAX_PLAYER_Y) return null;
  if (!isFiniteNum(z) || Math.abs(z) > MAX_COORD) return null;
  if (!isFiniteNum(yaw)) return null;
  if (typeof anim !== "string" || !COMPANION_ANIMS.includes(anim as never)) return null;
  const dt = Math.max(0.01, (deps.now() - room.getCompanionMoveAt()) / 1000);
  if (!isValidPlayerMotion(companion, { x, y, z }, dt)) return null;
  return { ...companion, x, y, z, yaw, anim: anim as CompanionState["anim"] };
}

function handleCompanionSpawn(ws: WsSocket, msg: Record<string, unknown>, deps: WsDeps): void {
  const room = joinedRoom(ws, deps);
  if (!room || !room.getPlayer(ws.data.id)) return;
  if (!isOwner(ws, room)) return sendCompanionError(ws, room, "Tylko wlasciciel pokoju moze dodac kompana.");
  if (room.getCompanion()) return sendCompanionError(ws, room, "Kompan jest juz w swiecie.");
  const profile = typeof msg.profile === "string" && msg.profile in COMPANION_PROFILES ? msg.profile as CompanionProfileId : null;
  if (!profile) return sendCompanionError(ws, room, "Nieznany kompan.");
  const player = room.getPlayer(ws.data.id)!;
  if (!room.hasOwnerPose()) return sendCompanionError(ws, room, "Chwile pobadaj w swiecie, potem dodaj kompana.");
  const spot = findCompanionSpawn(room, player);
  if (!spot) return sendCompanionError(ws, room, "Brak bezpiecznego miejsca dla kompana.");
  const companion: CompanionState = {
    id: `cmp_${crypto.randomUUID().slice(0, 8)}`,
    profile,
    x: spot.x,
    y: spot.y,
    z: spot.z,
    yaw: player.yaw,
    anim: "idle",
  };
  room.setCompanion(companion);
  room.setCompanionMoveAt(deps.now());
  room.bumpGeneration();
  publish(ws, deps, { t: "companion_state", companion, generation: room.getGeneration() });
}

function handleCompanionState(ws: WsSocket, msg: Record<string, unknown>, deps: WsDeps): void {
  const room = joinedRoom(ws, deps);
  if (!room || !room.getPlayer(ws.data.id)) return;
  if (!isOwner(ws, room)) return sendCompanionError(ws, room, "Tylko wlasciciel steruje kompanem.");
  const next = validateCompanionState(room, msg, deps);
  if (!next) return sendCompanionError(ws, room, "Nie mozna przyjac ruchu kompana.");
  room.setCompanion(next);
  room.setCompanionMoveAt(deps.now());
  publish(ws, deps, { t: "companion_state", companion: next, generation: room.getGeneration() });
}

function handleCompanionRemove(ws: WsSocket, msg: Record<string, unknown>, deps: WsDeps): void {
  const room = joinedRoom(ws, deps);
  if (!room || !room.getPlayer(ws.data.id)) return;
  if (!isOwner(ws, room)) return sendCompanionError(ws, room, "Tylko wlasciciel moze odeslac kompana.");
  const companion = room.getCompanion();
  if (!companion || companion.id !== msg.id) return sendCompanionError(ws, room, "Nie ma takiego kompana.");
  room.setCompanion(null);
  publish(ws, deps, { t: "companion_remove", id: companion.id });
}

function handleCompanionCommand(ws: WsSocket, msg: Record<string, unknown>, deps: WsDeps): void {
  const room = joinedRoom(ws, deps);
  if (!room || !room.getPlayer(ws.data.id)) return;
  const task = typeof msg.task === "string" && COMPANION_TASKS.includes(msg.task as BuildTask) && msg.task !== "stop" ? msg.task as BuildTask : null;
  if (!task) return sendCompanionError(ws, room, "Nieznane polecenie.");
  if (msg.expectedGeneration !== room.getGeneration()) return sendCompanionError(ws, room, "Polecenie nieaktualne, sprobuj jeszcze raz.");
  const generation = room.bumpGeneration();
  publish(ws, deps, { t: "companion_command", task, by: ws.data.id, generation });
}

function handleCompanionStop(ws: WsSocket, msg: Record<string, unknown>, deps: WsDeps): void {
  void msg;
  const room = joinedRoom(ws, deps);
  if (!room || !room.getPlayer(ws.data.id)) return;
  const generation = room.bumpGeneration();
  if (room.getBuildPreview()) {
    room.setBuildPreview(null);
    publish(ws, deps, { t: "build_cancelled", planId: "", reason: "stopped" });
  }
  publish(ws, deps, { t: "companion_command", task: "stop", by: ws.data.id, generation });
}

function handleCompanionSay(ws: WsSocket, msg: Record<string, unknown>, deps: WsDeps): void {
  const room = joinedRoom(ws, deps);
  if (!room || !room.getPlayer(ws.data.id)) return;
  if (!isOwner(ws, room)) return sendCompanionError(ws, room, "Tylko wlasciciel mowi za kompana.");
  const companion = room.getCompanion();
  if (!companion || companion.id !== msg.id) return sendCompanionError(ws, room, "Nie ma takiego kompana.");
  if (typeof msg.line !== "string" || !/^[a-z0-9_]{1,32}$/.test(msg.line)) return sendCompanionError(ws, room, "Nieznana wypowiedz.");
  const evidence = msg.evidence;
  if (evidence !== undefined) {
    if (typeof evidence !== "object" || evidence === null) return sendCompanionError(ws, room, "Zly dowod.");
    const e = evidence as Record<string, unknown>;
    const { block, x, y, z } = e;
    if (typeof block !== "string" || !/^\d+$/.test(block)) return sendCompanionError(ws, room, "Zly dowod.");
    if (!isInt(x, -MAX_COORD, MAX_COORD) || !isInt(y, 0, WORLD_HEIGHT - 1) || !isInt(z, -MAX_COORD, MAX_COORD)) return sendCompanionError(ws, room, "Zly dowod.");
    if (room.getWorldBlock(x, y, z) !== Number(block)) return sendCompanionError(ws, room, "Zly dowod.");
  }
  publish(ws, deps, { t: "companion_say", id: companion.id, line: msg.line, evidence } as ServerMessage);
}

function protectedBlock(x: number, z: number): boolean {
  if (tycoonSiteSlot(x, z) !== null) return true;
  if (Math.hypot(x - TRAINING_DUMMY_POS.x, z - TRAINING_DUMMY_POS.z) <= PROTECTED_DUMMY_RADIUS) return true;
  return false;
}

function actorOverlapsCell(room: RoomState, x: number, y: number, z: number, exceptCompanionId?: string): boolean {
  const bodies = [...room.getAllPlayers().map((p) => ({ x: p.x, y: p.y, z: p.z })), room.getCompanion()].filter(
    (b): b is { x: number; y: number; z: number } => Boolean(b),
  );
  return bodies.some(
    (b, i) =>
      !(exceptCompanionId && room.getCompanion() && i === room.getAllPlayers().length && room.getCompanion()!.id === exceptCompanionId) &&
      Math.abs(b.x - (x + 0.5)) < 0.8 &&
      Math.abs(b.z - (z + 0.5)) < 0.8 &&
      b.y < y + 1 &&
      b.y + 1.8 > y,
  );
}

function handleBuildPreview(ws: WsSocket, msg: Record<string, unknown>, deps: WsDeps): void {
  const room = joinedRoom(ws, deps);
  if (!room) return;
  const player = room.getPlayer(ws.data.id);
  if (!player) return;
  if (msg.expectedGeneration !== room.getGeneration()) return sendCompanionError(ws, room, "Projekt nieaktualny, sprobuj jeszcze raz.");
  if (protectedBlock(player.x, player.z)) return sendCompanionError(ws, room, "Tu nie mozna budowac.");
  const world = {
    getBlock: (x: number, y: number, z: number) => room.getWorldBlock(x, y, z),
    surfaceColumnTop: (x: number, z: number) => room.surfaceColumnTop(x, z),
    hasEdit: (x: number, y: number, z: number) => room.getBlock(x, y, z) !== undefined,
  };
  const siteOccupied = (x: number, z: number, radius: number): boolean => {
    const minX = Math.floor(x - radius);
    const maxX = Math.ceil(x + radius);
    const minZ = Math.floor(z - radius);
    const maxZ = Math.ceil(z + radius);
    for (let slot = 0; slot < MAX_TYCOON_SLOTS; slot++) {
      const origin = tycoonSlotOrigin(slot);
      if (
        maxX >= origin.x + TYCOON_SITE_BOUNDS.minX &&
        minX <= origin.x + TYCOON_SITE_BOUNDS.maxX &&
        maxZ >= origin.z + TYCOON_SITE_BOUNDS.minZ &&
        minZ <= origin.z + TYCOON_SITE_BOUNDS.maxZ
      ) return true;
    }
    if (Math.hypot(x - TRAINING_DUMMY_POS.x, z - TRAINING_DUMMY_POS.z) <= radius + PROTECTED_DUMMY_RADIUS) return true;
    return false;
  };
  const plan = createHousePlan(world, { x: player.x, z: player.z, yaw: player.yaw }, room.seed, siteOccupied, "cabin");
  if (!plan || plan.blocks.length === 0 || plan.blocks.length > 150) return sendCompanionError(ws, room, "Brak miejsca na domek.");
  const blocks: BuildBlock[] = plan.blocks.map(({ x, y, z, id }) => ({ x, y, z, id }));
  const planId = room.nextPlanId();
  const previous = room.getBuildPreview();
  if (previous) publish(ws, deps, { t: "build_cancelled", planId: previous.planId, reason: "superseded" });
  room.setBuildPreview({ planId, requestedBy: ws.data.id, blocks, reserved: false, placed: [] });
  room.bumpGeneration();
  publish(ws, deps, { t: "build_preview", requestId: String(msg.requestId ?? ""), planId, blocks });
}

function handleBuildConfirm(ws: WsSocket, msg: Record<string, unknown>, deps: WsDeps): void {
  const room = joinedRoom(ws, deps);
  if (!room || !room.getPlayer(ws.data.id)) return;
  const preview = room.getBuildPreview();
  if (!preview || preview.planId !== msg.planId) return sendCompanionError(ws, room, "Nie ma takiego projektu.");
  if (preview.requestedBy !== ws.data.id) return sendCompanionError(ws, room, "Tylko zamawiajacy moze potwierdzic budowe.");
  for (const block of preview.blocks) {
    if (!isInt(block.x, -MAX_COORD, MAX_COORD) || !isInt(block.y, 0, WORLD_HEIGHT - 1) || !isInt(block.z, -MAX_COORD, MAX_COORD)) {
      return sendCompanionError(ws, room, "Projekt poza swiatem.");
    }
    if (room.getWorldBlock(block.x, block.y, block.z) !== BLOCK_ID.air) {
      room.setBuildPreview(null);
      publish(ws, deps, { t: "build_cancelled", planId: preview.planId, reason: "cells_changed" });
      return sendCompanionError(ws, room, "Miejsce sie zmienilo, zamow projekt jeszcze raz.");
    }
    if (protectedBlock(block.x, block.z)) {
      room.setBuildPreview(null);
      publish(ws, deps, { t: "build_cancelled", planId: preview.planId, reason: "occupied" });
      return sendCompanionError(ws, room, "Miejsce zajete.");
    }
  }
  room.setBuildPreview({ ...preview, reserved: true });
  room.bumpGeneration();
  publish(ws, deps, { t: "build_reserved", planId: preview.planId, blocks: preview.blocks });
}

function handleCompanionPlace(ws: WsSocket, msg: Record<string, unknown>, deps: WsDeps): void {
  const room = joinedRoom(ws, deps);
  if (!room || !room.getPlayer(ws.data.id)) return;
  if (!isOwner(ws, room)) return sendCompanionError(ws, room, "Tylko kompan wlasciciela buduje.");
  const companion = room.getCompanion();
  if (!companion || companion.id !== msg.id) return sendCompanionError(ws, room, "Nie ma takiego kompana.");
  const preview = room.getBuildPreview();
  if (!preview || !preview.reserved || preview.planId !== msg.planId) return sendCompanionError(ws, room, "Brak potwierdzonego projektu.");
  const index = msg.blockIndex;
  if (!isInt(index, 0, preview.blocks.length - 1) || preview.placed.includes(index)) return sendCompanionError(ws, room, "Ten block jest juz polozony.");
  const block = preview.blocks[index]!;
  if (Math.hypot(block.x + 0.5 - companion.x, block.y + 0.5 - companion.y, block.z + 0.5 - companion.z) > PLACE_REACH_BLOCKS) {
    return sendCompanionError(ws, room, "Kompan jest za daleko, podnies go blizej.");
  }
  if (room.getWorldBlock(block.x, block.y, block.z) !== BLOCK_ID.air) return sendCompanionError(ws, room, "Miejsce zajete.");
  if (protectedBlock(block.x, block.z) || actorOverlapsCell(room, block.x, block.y, block.z, companion.id)) return sendCompanionError(ws, room, "Ktos stoi w tym miejscu.");
  if (room.getBlock(block.x, block.y, block.z) === undefined && room.getEditCount() >= MAX_EDITS_PER_ROOM) {
    return sendCompanionError(ws, room, "Swiat osiagnal limit zmian.");
  }
  room.setBlock(block.x, block.y, block.z, block.id);
  const placed = [...preview.placed, index];
  room.setBuildPreview(placed.length >= preview.blocks.length ? null : { ...preview, placed });
  publish(ws, deps, { t: "block", x: block.x, y: block.y, z: block.z, id: block.id, by: companion.id });
}
