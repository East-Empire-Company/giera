import type { SerializedInventory } from "../game/inventory";

export type SavedGameState = {
  seed: number;
  inventory: SerializedInventory;
  objectives: {
    stepIndex: number;
    currentProgress: number;
  };
  edits: Record<string, number>;
  savedAt: string;
};

const DB_NAME = "giera_save_db";
const STORE_NAME = "saves";
const SAVE_KEY = "last_save";

export function formatSaveData(state: SavedGameState): string {
  return JSON.stringify(state);
}

export function parseSaveData(raw: string): SavedGameState | null {
  try {
    const data = JSON.parse(raw) as SavedGameState;
    if (typeof data.seed === "number" && data.inventory) {
      return data;
    }
  } catch {
    // Malformed JSON
  }
  return null;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveGameState(state: SavedGameState): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(state, SAVE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    // Fallback to localStorage
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SAVE_KEY, formatSaveData(state));
    }
  }
}

export async function loadGameState(): Promise<SavedGameState | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(SAVE_KEY);
      req.onsuccess = () => resolve((req.result as SavedGameState) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Fallback to localStorage
    if (typeof localStorage !== "undefined") {
      const item = localStorage.getItem(SAVE_KEY);
      if (item) return parseSaveData(item);
    }
    return null;
  }
}
