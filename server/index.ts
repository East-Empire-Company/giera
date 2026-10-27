import { networkInterfaces } from "os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  encodeBinaryChunkFrame,
  isValidPlayerSpeed,
  type ClientMessage,
  type ServerMessage,
} from "../src/shared/lan-protocol";
import { RoomState, type WorldSnapshot } from "./room";
import { WORLDGEN_VERSION } from "../src/shared/worldgen";
import { NPC_ALLOWED_TOOLS as NPC_TOOLS } from "./npc-bridge";
import { handleNpcReason } from "./npc-reason";
import { handleNpcTts } from "./npc-tts";
import { serveStatic } from "./static";

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = resolve(process.env.GIERA_DATA_DIR ?? "server/data");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const rooms = new Map<string, RoomState>();

function getOrCreateRoom(code: string): RoomState {
  const normalized = code.toUpperCase().trim() || "DOM1";
  let room = rooms.get(normalized);
  if (!room) {
    const saveFile = resolve(DATA_DIR, `world-${normalized}.json`);
    if (existsSync(saveFile)) {
      try {
        const data = JSON.parse(readFileSync(saveFile, "utf-8")) as WorldSnapshot;
        room = RoomState.fromJSON(normalized, data);
        console.log(`Loaded saved world for room ${normalized}`);
      } catch (e) {
        console.error(`Failed to load world-${normalized}.json:`, e);
      }
    }
    if (!room) {
      room = new RoomState(normalized, Math.floor(Math.random() * 1_000_000) + 1, WORLDGEN_VERSION);
    }
    rooms.set(normalized, room);
  }
  return room;
}

function saveAllRooms(): void {
  for (const [code, room] of rooms) {
    const file = resolve(DATA_DIR, `world-${code}.json`);
    try {
      writeFileSync(file, JSON.stringify(room.toJSON(), null, 2), "utf-8");
    } catch (e) {
      console.error(`Failed to save room ${code}:`, e);
    }
  }
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

type WsData = {
  id: string;
  roomCode: string;
  name: string;
  lastAcceptTime: number;
  hadInput: boolean;
};

for (const npcId of Object.keys(NPC_TOOLS)) {
  if (!existsSync(resolve("agents", npcId, "prompt.md"))) {
    console.warn(`[npc] missing persona agents/${npcId}/prompt.md — generic fallback in use`);
  }
}


const server = Bun.serve<WsData>({
  port: PORT,
  idleTimeout: 60,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const id = crypto.randomUUID().slice(0, 8);
      const upgraded = server.upgrade(req, {
        data: {
          id,
          roomCode: "DOM1",
          name: "Gracz",
          lastAcceptTime: Date.now(),
          hadInput: false,
        },
      });
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
    open(ws) {
      // Client connected, wait for hello
    },
    message(ws, message) {
      const data = ws.data;
      if (typeof message === "string") {
        try {
          const msg = JSON.parse(message) as ClientMessage;
          const room = getOrCreateRoom(data.roomCode);

          if (msg.t === "hello") {
            data.roomCode = msg.room.toUpperCase().trim() || "DOM1";
            data.name = msg.name || "Gracz";
            const activeRoom = getOrCreateRoom(data.roomCode);
            const player = activeRoom.addPlayer(data.id, data.name);

            // Subscribe to room topic
            ws.subscribe(`room:${data.roomCode}`);

            // Send welcome
            const welcome: ServerMessage = {
              t: "welcome",
              id: data.id,
              seed: activeRoom.seed,
              spawn: [player.x, player.y, player.z],
              players: activeRoom.getAllPlayers().filter((p) => p.id !== data.id),
            };
            ws.send(JSON.stringify(welcome));

            // Broadcast join to others
            const joinMsg: ServerMessage = { t: "join", id: data.id, name: data.name };
            server.publish(`room:${data.roomCode}`, JSON.stringify(joinMsg));
          } else if (msg.t === "need") {
            // Send binary chunk frame
            const rle = room.getChunkRLE(msg.cx, msg.cy, msg.cz);
            const frame = encodeBinaryChunkFrame([{ cx: msg.cx, cy: msg.cy, cz: msg.cz, rleData: rle }]);
            ws.send(frame);
          } else if (msg.t === "block") {
            room.setBlock(msg.x, msg.y, msg.z, msg.id);
            const broadcast: ServerMessage = {
              t: "block",
              x: msg.x,
              y: msg.y,
              z: msg.z,
              id: msg.id,
              by: data.id,
            };
            server.publish(`room:${data.roomCode}`, JSON.stringify(broadcast));
          } else if (msg.t === "input") {
            const player = room.getPlayer(data.id);
            if (player) {
              const now = Date.now();
              const dt = Math.max(0.01, (now - data.lastAcceptTime) / 1000);

              const next = { x: msg.x, y: msg.y, z: msg.z };
              if (!data.hadInput || isValidPlayerSpeed(player, next, dt)) {
                data.hadInput = true;
                data.lastAcceptTime = now;
                room.updatePlayer(data.id, {
                  x: msg.x,
                  y: msg.y,
                  z: msg.z,
                  yaw: msg.yaw,
                  pitch: msg.pitch,
                  anim: msg.anim,
                });

                const stateMsg: ServerMessage = {
                  t: "player",
                  id: data.id,
                  name: data.name,
                  x: msg.x,
                  y: msg.y,
                  z: msg.z,
                  yaw: msg.yaw,
                  pitch: msg.pitch,
                  anim: msg.anim,
                };
                server.publish(`room:${data.roomCode}`, JSON.stringify(stateMsg));
              }
            }
          }
        } catch (e) {
          console.error("Error processing websocket message:", e);
        }
      }
    },
    close(ws) {
      const data = ws.data;
      const room = rooms.get(data.roomCode);
      if (room) {
        room.removePlayer(data.id);
        const leaveMsg: ServerMessage = { t: "leave", id: data.id };
        server.publish(`room:${data.roomCode}`, JSON.stringify(leaveMsg));
      }
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
