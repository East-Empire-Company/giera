export const MAX_PLAYER_SPEED = 12; // blocks per second limit

export type PlayerState = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  anim: string;
};

export type ClientMessage =
  | { t: "hello"; name: string; room: string }
  | { t: "need"; cx: number; cy: number; cz: number }
  | { t: "block"; x: number; y: number; z: number; id: number }
  | { t: "input"; seq: number; x: number; y: number; z: number; yaw: number; pitch: number; anim: string };

export type ServerMessage =
  | { t: "welcome"; id: string; seed: number; spawn: [number, number, number]; players: PlayerState[] }
  | { t: "block"; x: number; y: number; z: number; id: number; by: string }
  | { t: "player"; id: string; name: string; x: number; y: number; z: number; yaw: number; pitch: number; anim: string }
  | { t: "join"; id: string; name: string }
  | { t: "leave"; id: string };
export type ChunkPacket = {
  cx: number;
  cy: number;
  cz: number;
  rleData: Uint8Array;
};

export function encodeBinaryChunkFrame(chunks: ChunkPacket[]): Uint8Array {
  let totalBytes = 1 + 2; // type (1 byte) + count (2 bytes)
  for (const c of chunks) {
    totalBytes += 4 + 4 + 4 + 4 + c.rleData.length;
  }

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint8(0, 1);
  view.setUint16(1, chunks.length, true);

  let offset = 3;
  for (const c of chunks) {
    view.setInt32(offset, c.cx, true);
    offset += 4;
    view.setInt32(offset, c.cy, true);
    offset += 4;
    view.setInt32(offset, c.cz, true);
    offset += 4;
    view.setUint32(offset, c.rleData.length, true);
    offset += 4;
    bytes.set(c.rleData, offset);
    offset += c.rleData.length;
  }

  return bytes;
}

export function decodeBinaryChunkFrame(data: Uint8Array): ChunkPacket[] {
  if (data.length < 3) throw new RangeError("Chunk frame too short");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const type = view.getUint8(0);
  if (type !== 1) throw new Error(`Unknown binary frame type: ${type}`);

  const count = view.getUint16(1, true);
  const chunks: ChunkPacket[] = [];
  let offset = 3;

  for (let i = 0; i < count; i++) {
    if (offset + 16 > data.length) throw new RangeError("Corrupt chunk header");
    const cx = view.getInt32(offset, true);
    offset += 4;
    const cy = view.getInt32(offset, true);
    offset += 4;
    const cz = view.getInt32(offset, true);
    offset += 4;
    const len = view.getUint32(offset, true);
    offset += 4;
    if (offset + len > data.length) throw new RangeError("Corrupt chunk payload");
    const rleData = data.subarray(offset, offset + len);
    offset += len;
    chunks.push({ cx, cy, cz, rleData });
  }
  return chunks;
}

export function isValidPlayerSpeed(
  prev: { x: number; y: number; z: number },
  curr: { x: number; y: number; z: number },
  deltaSeconds: number
): boolean {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return false;
  const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y, curr.z - prev.z);
  return dist / deltaSeconds <= MAX_PLAYER_SPEED;
}
