import { networkInterfaces } from "os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { WORLDGEN_VERSION } from "../src/shared/worldgen";
import { RoomState, type WorldSnapshot } from "./room";
import {
  MAX_ROOMS,
  createRoomRegistry,
  createWsConnection,
  handleWsClose,
  handleWsMessage,
  type WsConnection,
  type WsDeps,
} from "./ws-handler";
import { NPC_ALLOWED_TOOLS as NPC_TOOLS } from "./npc-bridge";
import { handleNpcReason } from "./npc-reason";
import { handleNpcTts } from "./npc-tts";
import { serveStatic } from "./static";

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = resolve(process.env.GIERA_DATA_DIR ?? "server/data");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function loadOrCreateRoom(normalized: string): RoomState {
  const saveFile = resolve(DATA_DIR, `world-${normalized}.json`);
  if (existsSync(saveFile)) {
    try {
      const data = JSON.parse(readFileSync(saveFile, "utf-8")) as WorldSnapshot;
      console.log(`Loaded saved world for room ${normalized}`);
      return RoomState.fromJSON(normalized, data);
    } catch (e) {
      console.error(`Failed to load world-${normalized}.json:`, e);
    }
  }
  return new RoomState(normalized, Math.floor(Math.random() * 1_000_000) + 1, WORLDGEN_VERSION);
}

function saveRoom(code: string, room: RoomState): void {
  const file = resolve(DATA_DIR, `world-${code}.json`);
  try {
    writeFileSync(file, JSON.stringify(room.toJSON(), null, 2), "utf-8");
  } catch (e) {
    console.error(`Failed to save room ${code}:`, e);
  }
}

const rooms = createRoomRegistry(MAX_ROOMS, loadOrCreateRoom, saveRoom);

function saveAllRooms(): void {
  for (const [code, room] of rooms.entries()) saveRoom(code, room);
}

setInterval(saveAllRooms, 30_000);

function getLanIp(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}


for (const npcId of Object.keys(NPC_TOOLS)) {
  if (!existsSync(resolve("agents", npcId, "prompt.md"))) {
    console.warn(`[npc] missing persona agents/${npcId}/prompt.md — generic fallback in use`);
  }
}


const wsDeps: WsDeps = {
  rooms,
  publish: (topic, payload) => server.publish(topic, payload),
  now: () => Date.now(),
};

const server = Bun.serve<WsConnection>({
  port: PORT,
  idleTimeout: 60,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const id = crypto.randomUUID().slice(0, 8);
      const upgraded = server.upgrade(req, { data: createWsConnection(id, Date.now()) });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/npc/reason") {
      return handleNpcReason(req);
    }

    if (url.pathname === "/npc/tts") {
      return handleNpcTts(req);
    }

    return serveStatic(req, "dist");
  },
  websocket: {
    message(ws, message) {
      handleWsMessage(ws, message, wsDeps);
    },
    close(ws) {
      handleWsClose(ws, wsDeps);
    },
  },
});

const lanIp = getLanIp();
console.log(`\n=================================================`);
console.log(`🏰 Giera LAN Server działający na porcie ${PORT}`);
console.log(`📡 Połącz się w sieci domowej: ws://${lanIp}:${PORT}/ws`);
console.log(`🌐 Przeglądarka: http://${lanIp}:${PORT}/`);
console.log(`🔑 Domyślny pokój: DOM1`);
console.log(`=================================================\n`);
