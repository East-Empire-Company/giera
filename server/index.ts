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
import { handleNemotronProxyRequest, MAX_OUTPUT_TOKENS } from "./nemotron-proxy";

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

const NPC_RATE_LIMIT = 10;
const NPC_RATE_WINDOW_MS = 60_000;
const npcRateBuckets = new Map<string, { count: number; windowStart: number }>();

function npcRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = npcRateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart >= NPC_RATE_WINDOW_MS) {
    if (npcRateBuckets.size > 10_000) {
      for (const [key, b] of npcRateBuckets) {
        if (now - b.windowStart >= NPC_RATE_WINDOW_MS) npcRateBuckets.delete(key);
      }
    }
    npcRateBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > NPC_RATE_LIMIT;
}

function buildNpcSystemPrompt(npcId: string): string {
  const personaPath = resolve("agents", npcId, "prompt.md");
  const persona = existsSync(personaPath)
    ? readFileSync(personaPath, "utf8").trim()
    : "Jesteś przyjaznym NPC w grze dla dzieci.";
  const tools = NPC_TOOLS[npcId] ?? [];
  const toolList = tools.map((t) => `"${t}"`).join(" | ");
  return [
    persona,
    "",
    "Odpowiadasz WYŁĄCZNIE jedną linią poprawnego JSON, bez markdownu, bez komentarzy:",
    '{"say": "<krótka wypowiedź po polsku, maks 12 słów>", "tool": null, "walk_to": null}',
    toolList
      ? `Dostępne narzędzia (pole "tool"): ${toolList}. Przy narzędziu dodaj "args".`
      : 'Zawsze używaj "tool": null.',
    'Formaty args: give_block {"block_type": "planks"|"cobblestone"|"glass"|"iron_block", "count": 1-16}; give_quest {"step_id": "gather_wood"|"craft_planks"|"craft_sticks"|"find_stone"|"craft_tool"|"build_house"}; share_map_hint {"topic": "drewno"|"kamień"|"rzemiosło"|"domek"|"jaskinia"}.',
    'Pole "walk_to": {"x": liczba, "z": liczba} — idź tam, gdy warto pokazać coś dzieciom (np. drzewa przy zbieraniu drewna). Punkty orientacyjne: polana startowa (0,0), drzewa na północ (0,-10), staw na wschodzie (12,0), skaliste zbocze (-10,8), manekin treningowy (2,3), maszyna tycoona (-3,7).',
  ].join("\n");
}

async function handleNpcReason(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (npcRateLimited(ip)) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }
  let body: { npcId?: unknown; message?: unknown; history?: unknown };
  try {
    const parsed: unknown = await req.json();
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    body = parsed as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const npcId = typeof body.npcId === "string" && Object.hasOwn(NPC_TOOLS, body.npcId) ? body.npcId : "mina";
  const message = typeof body.message === "string" ? body.message.slice(0, 300) : "";
  if (!message.trim()) {
    return new Response(JSON.stringify({ error: "Empty message" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const history = Array.isArray(body.history)
    ? (body.history as { role?: unknown; content?: unknown }[])
        .filter(
          (m) =>
            m &&
            (m.role === "assistant" || m.role === "user") &&
            typeof m.content === "string" &&
            m.content.length > 0
        )
        .slice(-6)
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: (m.content as string).slice(0, 300),
        }))
    : [];
  const payload = {
    messages: [
      { role: "system", content: buildNpcSystemPrompt(npcId) },
      ...history,
      { role: "user", content: message },
    ],
    max_tokens: MAX_OUTPUT_TOKENS,
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = req.headers.get("authorization");
  if (auth) headers.authorization = auth;
  const proxied = new Request(req.url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return handleNemotronProxyRequest(proxied);
}

const server = Bun.serve<WsData>({
  port: PORT,
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

    // Static assets from dist
    let filePath = resolve("dist", url.pathname.slice(1));
    if (!existsSync(filePath) || url.pathname === "/") {
      filePath = resolve("dist", "index.html");
    }
    if (existsSync(filePath)) {
      return new Response(Bun.file(filePath));
    }
    return new Response("Not found", { status: 404 });
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
