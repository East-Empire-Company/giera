import { MAX_ROOM_NAME_LENGTH, type BuildPreviewInfo, type CompanionState, type PlayerProfile, type PlayerState } from "../src/shared/lan-protocol";
import { nextFreeTycoonSlot } from "../src/shared/tycoon-slots";
import { citySurfaceColumnTop, generateBlock, generateChunk } from "../src/shared/worldgen";
import { CHUNK_SIZE, encodeRLE, getBlockIndex, WORLD_HEIGHT } from "../src/shared/chunk";
import { BLOCK_ID } from "../src/shared/blocks";

export type WorldSnapshot = {
  seed: number;
  edits: Record<string, number>;
  savedAt: string;
  name?: string;
};
export class RoomState {
  readonly code: string;
  private _seed: number;
  get seed(): number { return this._seed; }
  private readonly players = new Map<string, PlayerState>();
  private readonly edits = new Map<string, number>();
  private readonly chunks = new Map<string, Uint8Array>();
  private loadedFromSave = false;
  private name: string;
  private ownerId: string | null = null;
  private ownerHasPose = false;
  private companion: CompanionState | null = null;
  private companionMoveAt = 0;
  private generation = 0;
  private buildPreview: BuildPreviewInfo | null = null;
  private planSequence = 0;

  constructor(code: string, seed: number) {
    this.code = code;
    this._seed = seed;
    this.name = code;
  }

  getPlayerCount(): number {
    return this.players.size;
  }

  getName(): string {
    return this.name;
  }

  setName(value: string): void {
    const trimmed = value.trim().slice(0, MAX_ROOM_NAME_LENGTH);
    if (!trimmed) return;
    this.name = trimmed;
  }

  getPlayer(socketId: string): PlayerState | undefined {
    return this.players.get(socketId);
  }

  getAllPlayers(): PlayerState[] {
    return Array.from(this.players.values());
  }

  addPlayer(socketId: string, name: string, profile: PlayerProfile = "ziemek"): PlayerState {
    const slot = nextFreeTycoonSlot(this.getAllPlayers().map((p) => p.slot ?? 0));
    const player: PlayerState = {
      id: socketId,
      name,
      profile,
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

  getWorldBlock(x: number, y: number, z: number): number {
    return this.edits.get(`${x},${y},${z}`) ?? generateBlock(x, y, z, this._seed);
  }

  surfaceColumnTop(x: number, z: number): number {
    const cityTop = citySurfaceColumnTop(x, z, (y) => this.edits.get(`${x},${y},${z}`));
    if (cityTop !== null) return cityTop;
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      if (this.getWorldBlock(x, y, z) !== BLOCK_ID.air) return y;
    }
    return 0;
  }

  getOwnerId(): string | null {
    return this.ownerId;
  }

  setOwnerId(id: string | null): void {
    this.ownerId = id;
  }

  markOwnerPose(): void {
    this.ownerHasPose = true;
  }

  hasOwnerPose(): boolean {
    return this.ownerHasPose;
  }

  getCompanion(): CompanionState | null {
    return this.companion;
  }

  setCompanion(companion: CompanionState | null): void {
    this.companion = companion;
  }

  getCompanionMoveAt(): number {
    return this.companionMoveAt;
  }

  setCompanionMoveAt(value: number): void {
    this.companionMoveAt = value;
  }

  getGeneration(): number {
    return this.generation;
  }

  bumpGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  getBuildPreview(): BuildPreviewInfo | null {
    return this.buildPreview;
  }

  setBuildPreview(preview: BuildPreviewInfo | null): void {
    this.buildPreview = preview;
  }

  nextPlanId(): string {
    this.planSequence += 1;
    return `bp_${this.planSequence}`;
  }

  editEntries(): { x: number; y: number; z: number; id: number }[] {
    const entries: { x: number; y: number; z: number; id: number }[] = [];
    for (const [key, id] of this.edits) {
      const [x, y, z] = key.split(",").map(Number);
      entries.push({ x: x!, y: y!, z: z!, id });
    }
    return entries;
  }

  getEditCount(): number {
    return this.edits.size;
  }

  setSeedIfFresh(seed: number): boolean {
    if (this.loadedFromSave || this.edits.size > 0 || this.players.size > 0) return false;
    if (!Number.isInteger(seed)) return false;
    this._seed = seed;
    return true;
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
      name: this.name,
    };
  }

  static fromJSON(code: string, json: WorldSnapshot): RoomState {
    const room = new RoomState(code, json.seed);
    room.loadedFromSave = true;
    for (const [k, v] of Object.entries(json.edits)) {
      room.edits.set(k, v);
    }
    if (typeof json.name === "string") room.setName(json.name);
    return room;
  }
}
