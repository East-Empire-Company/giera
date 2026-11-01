import type { LanRoomSummary, LanServerSummary } from "../src/shared/lan-protocol";
import type { RoomState } from "./room";

export type LanServerMeta = {
  host: string;
  ip: string;
  port: number;
};

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function buildRoomSummary(room: RoomState): LanRoomSummary {
  return { code: room.code, name: room.getName(), players: room.getPlayerCount(), seed: room.seed };
}

export function buildLanRoomsPayload(rooms: RoomState[], host: string, ip: string, port: number): LanServerSummary {
  const occupied = rooms
    .filter((room) => room.getPlayerCount() > 0)
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { host, ip, port, rooms: occupied.map(buildRoomSummary) };
}

export function handleLanRooms(req: Request, rooms: RoomState[], meta: LanServerMeta): Response {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "content-type": "application/json; charset=utf-8" },
    });
  }

  const payload = buildLanRoomsPayload(rooms, meta.host, meta.ip, meta.port);
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
