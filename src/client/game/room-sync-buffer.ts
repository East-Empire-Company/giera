export type RoomSyncBuffer<T> = {
  readonly syncing: boolean;
  readonly bufferedCount: number;
  start(): void;
  begin(syncId: string): boolean;
  buffer(item: T): "apply" | "buffered" | "overflow";
  applyPage(syncId: string, index: number, items: readonly T[], apply: (item: T) => void): boolean;
  end(syncId: string, apply: (item: T) => void): boolean;
  abort(): void;
};

export function createRoomSyncBuffer<T>(limit = 8192): RoomSyncBuffer<T> {
  let syncing = false;
  let syncId: string | null = null;
  let nextPage = 0;
  let buffered: T[] = [];

  return {
    get syncing() {
      return syncing;
    },
    get bufferedCount() {
      return buffered.length;
    },
    start() {
      syncing = true;
      syncId = null;
      nextPage = 0;
      buffered = [];
    },
    begin(id) {
      if (!syncing) this.start();
      syncId = id;
      nextPage = 0;
      return true;
    },
    buffer(item) {
      if (!syncing) return "apply";
      if (buffered.length >= Math.max(0, limit)) return "overflow";
      buffered.push(item);
      return "buffered";
    },
    applyPage(id, index, items, apply) {
      if (!syncing || id !== syncId || index !== nextPage) return false;
      for (const item of items) apply(item);
      nextPage += 1;
      return true;
    },
    end(id, apply) {
      if (!syncing || id !== syncId) return false;
      for (const item of buffered) apply(item);
      buffered = [];
      syncId = null;
      nextPage = 0;
      syncing = false;
      return true;
    },
    abort() {
      this.start();
    },
  };
}
