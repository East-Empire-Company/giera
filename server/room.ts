import type { PlayerState } from "../src/shared/lan-protocol";
import { nextFreeTycoonSlot } from "../src/shared/tycoon-slots";
import { generateChunk } from "../src/shared/worldgen";
import { CHUNK_SIZE, encodeRLE, getBlockIndex } from "../src/shared/chunk";

export type WorldSnapshot = {
  seed: number;
  edits: Record<string, number>;
  savedAt: string;
};

export class RoomState {
  readonly code: string;
  readonly seed: number;
  private readonly players = new Map<string, PlayerState>();
  private readonly edits = new Map<string, number>();
  private readonly chunks = new Map<string, Uint8Array>();

  constructor(code: string, seed: number) {
    this.code = code;
    this.seed = seed;
  }

  getPlayerCount(): number {
    return this.players.size;
  }

  getPlayer(socketId: string): PlayerState | undefined {
    return this.players.get(socketId);
  }

  getAllPlayers(): PlayerState[] {
    return Array.from(this.players.values());
  }

  addPlayer(socketId: string, name: string): PlayerState {
    const slot = nextFreeTycoonSlot(this.getAllPlayers().map((p) => p.slot ?? 0));
    const player: PlayerState = {
      id: socketId,
      name,
      x: 0,
      y: 50,
      z: 0,
      yaw: 0,
      pitch: 0,
      anim: "idle",
      slot,
    };
    this.players.set(socketId, player);
    return player;
  }

  removePlayer(socketId: string): void {
    this.players.delete(socketId);
  }

  updatePlayer(socketId: string, update: Partial<PlayerState>): void {
    const p = this.players.get(socketId);
    if (!p) return;
    Object.assign(p, update);
  }

  setBlock(x: number, y: number, z: number, id: number): void {
    this.edits.set(`${x},${y},${z}`, id);

    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(`${cx},${cy},${cz}`);
    if (!chunk) return;
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    chunk[getBlockIndex(lx, ly, lz)] = id;
  }

  getBlock(x: number, y: number, z: number): number | undefined {
    return this.edits.get(`${x},${y},${z}`);
  }

  getEditCount(): number {
    return this.edits.size;
  }

  getChunkRLE(cx: number, cy: number, cz: number): Uint8Array {
    const key = `${cx},${cy},${cz}`;
    let data = this.chunks.get(key);
    if (!data) {
      data = generateChunk(cx, cy, cz, this.seed);
      for (const [editKey, id] of this.edits) {
        const [ex, ey, ez] = editKey.split(",").map(Number);
        const ecx = Math.floor(ex / CHUNK_SIZE);
        const ecy = Math.floor(ey / CHUNK_SIZE);
        const ecz = Math.floor(ez / CHUNK_SIZE);
        if (ecx === cx && ecy === cy && ecz === cz) {
          const lx = ((ex % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
          const ly = ((ey % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
          const lz = ((ez % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
          data[getBlockIndex(lx, ly, lz)] = id;
        }
      }
      this.chunks.set(key, data);
    }
    return encodeRLE(data);
  }

  toJSON(): WorldSnapshot {
    const edits: Record<string, number> = {};
    for (const [k, v] of this.edits) edits[k] = v;
    return {
      seed: this.seed,
      edits,
      savedAt: new Date().toISOString(),
    };
  }

  static fromJSON(code: string, json: WorldSnapshot): RoomState {
    const room = new RoomState(code, json.seed);
    for (const [k, v] of Object.entries(json.edits)) {
      room.edits.set(k, v);
    }
    return room;
  }
}
