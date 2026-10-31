import { BLOCK_ID, type BlockId } from "../../shared/blocks";
import type { InventoryState } from "./recipes";

export const MAX_EDITS_PER_CHUNK = 20_000;

export type SerializedInventory = {
  creative: boolean;
  activeSlot: number;
  hotbar: BlockId[];
  blocks: Record<string, number>;
  items: Record<string, number>;
  chunkEdits: Record<string, number>;
};

export const DEFAULT_HOTBAR: BlockId[] = [
  BLOCK_ID.air,
  BLOCK_ID.air,
  BLOCK_ID.air,
  BLOCK_ID.air,
  BLOCK_ID.air,
  BLOCK_ID.air,
  BLOCK_ID.air,
  BLOCK_ID.air,
  BLOCK_ID.air,
];

export class GameInventory {
  public creative: boolean;
  public activeSlot: number;
  public hotbar: BlockId[];
  blocks: Record<string, number>;
  items: Record<string, number>;
  private chunkEdits: Record<string, number>;

  constructor(options?: {
    creative?: boolean;
    activeSlot?: number;
    hotbar?: BlockId[];
    blocks?: Record<string, number>;
    items?: Record<string, number>;
    chunkEdits?: Record<string, number>;
  }) {
    this.creative = options?.creative ?? true;
    this.activeSlot = options?.activeSlot ?? 0;
    this.hotbar = options?.hotbar ? [...options.hotbar] : [...DEFAULT_HOTBAR];
    this.blocks = { ...(options?.blocks ?? {}) };
    this.items = { ...(options?.items ?? {}) };
    this.chunkEdits = { ...(options?.chunkEdits ?? {}) };
  }

  get activeBlockId(): BlockId {
    return this.hotbar[this.activeSlot] ?? BLOCK_ID.air;
  }

  selectSlot(slotIndex: number): void {
    if (slotIndex >= 0 && slotIndex < this.hotbar.length) {
      this.activeSlot = slotIndex;
    }
  }

  cycleSlot(delta: number): void {
    const len = this.hotbar.length;
    this.activeSlot = (((this.activeSlot + delta) % len) + len) % len;
  }

  setHotbarSlot(slotIndex: number, blockId: BlockId): void {
    if (slotIndex >= 0 && slotIndex < this.hotbar.length) {
      this.hotbar[slotIndex] = blockId;
    }
  }

  swapHotbarSlots(fromIndex: number, toIndex: number): void {
    if (
      fromIndex >= 0 &&
      fromIndex < this.hotbar.length &&
      toIndex >= 0 &&
      toIndex < this.hotbar.length
    ) {
      const temp = this.hotbar[fromIndex];
      this.hotbar[fromIndex] = this.hotbar[toIndex];
      this.hotbar[toIndex] = temp;
    }
  }

  clearHotbarSlot(slotIndex: number): void {
    if (slotIndex >= 0 && slotIndex < this.hotbar.length) {
      this.hotbar[slotIndex] = BLOCK_ID.air;
    }
  }

  getBlockCount(key: string): number {
    return this.blocks[key] ?? 0;
  }

  getItemCount(key: string): number {
    return this.items[key] ?? 0;
  }

  addMinedBlock(key: string, count = 1): void {
    this.blocks[key] = (this.blocks[key] ?? 0) + count;
    const blockId = (BLOCK_ID as Record<string, number>)[key];
    if (blockId && blockId > 0 && !this.hotbar.includes(blockId as BlockId)) {
      const emptyIdx = this.hotbar.indexOf(BLOCK_ID.air);
      if (emptyIdx !== -1) {
        this.hotbar[emptyIdx] = blockId as BlockId;
      }
    }
  }

  consumeBlockForPlacement(key: string): boolean {
    if (this.creative) return true;
    const current = this.blocks[key] ?? 0;
    if (current <= 0) return false;
    this.blocks[key] = current - 1;
    return true;
  }

  canEditChunk(chunkKey: string): boolean {
    const count = this.chunkEdits[chunkKey] ?? 0;
    return count < MAX_EDITS_PER_CHUNK;
  }

  recordChunkEdit(chunkKey: string, delta = 1): void {
    this.chunkEdits[chunkKey] = (this.chunkEdits[chunkKey] ?? 0) + delta;
  }

  toState(): InventoryState {
    return {
      blocks: { ...this.blocks },
      items: { ...this.items },
    };
  }

  applyState(state: InventoryState): void {
    this.blocks = { ...state.blocks };
    this.items = { ...state.items };
  }

  toJSON(): SerializedInventory {
    return {
      creative: this.creative,
      activeSlot: this.activeSlot,
      hotbar: [...this.hotbar],
      blocks: { ...this.blocks },
      items: { ...this.items },
      chunkEdits: { ...this.chunkEdits },
    };
  }

  static fromJSON(data: SerializedInventory): GameInventory {
    return new GameInventory(data);
  }
}
