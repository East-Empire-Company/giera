import { roomSaveKey } from "../persist/db";

export const OFFLINE_SAVE_KEY = "last_save";
export const ACTIVE_LAN_ROOM_KEY = "giera.activeLanRoom";

export type LanRoomSession = { url: string; room: string; seed?: number };

export function parseLanRoomSession(value: string | null): LanRoomSession | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const session = parsed as Partial<LanRoomSession>;
    if (typeof session.url !== "string" || typeof session.room !== "string" || !session.room.trim()) return null;
    if (session.seed !== undefined && (!Number.isSafeInteger(session.seed) || session.seed < 0)) return null;
    const url = new URL(session.url);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    return { url: url.href, room: session.room, ...(session.seed === undefined ? {} : { seed: session.seed }) };
  } catch {
    return null;
  }
}

export function serializeLanRoomSession(session: LanRoomSession): string {
  return JSON.stringify(session);
}

export function activeSaveKey(session: LanRoomSession | null): string {
  if (!session) return OFFLINE_SAVE_KEY;
  try {
    return roomSaveKey(new URL(session.url).origin, session.room);
  } catch {
    return OFFLINE_SAVE_KEY;
  }
}


export function getActiveSaveKey(storage: Pick<Storage, "getItem"> | null = getSessionStorage()): string {
  if (!storage) return OFFLINE_SAVE_KEY;
  try {
    return activeSaveKey(parseLanRoomSession(storage.getItem(ACTIVE_LAN_ROOM_KEY)));
  } catch {
    return OFFLINE_SAVE_KEY;
  }
}

function getSessionStorage(): Pick<Storage, "getItem"> | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
export async function switchSaveKey(
  currentKey: string,
  nextKey: string,
  saveCurrent: (key: string) => Promise<boolean>,
): Promise<string> {
  if (currentKey === nextKey) return currentKey;
  try {
    return await saveCurrent(currentKey) ? nextKey : currentKey;
  } catch {
    return currentKey;
  }
}
