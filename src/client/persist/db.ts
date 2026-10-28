import type { SerializedInventory } from "../game/inventory";

export type SavedGameState = {
  seed: number;
  worldgenVersion?: number;
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

function isSavedGameState(data: unknown): data is SavedGameState {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  if (!("seed" in data) || !("savedAt" in data) || !("inventory" in data) || !("objectives" in data) || !("edits" in data)) return false;
  const { seed, savedAt, inventory, objectives, edits } = data;
  if (typeof seed !== "number" || typeof savedAt !== "string") return false;
  if (typeof inventory !== "object" || inventory === null || Array.isArray(inventory)) return false;
  if (typeof objectives !== "object" || objectives === null || Array.isArray(objectives)) return false;
  if (typeof edits !== "object" || edits === null || Array.isArray(edits)) return false;
  if (!("hotbar" in inventory) || !("activeSlot" in inventory) || !("blocks" in inventory) || !("items" in inventory)) return false;
  if (!("stepIndex" in objectives)) return false;
  const { hotbar, activeSlot, blocks, items } = inventory;
  return (
    Array.isArray(hotbar) &&
    typeof activeSlot === "number" &&
    typeof blocks === "object" &&
    blocks !== null &&
    !Array.isArray(blocks) &&
    typeof items === "object" &&
    items !== null &&
    !Array.isArray(items) &&
    typeof objectives.stepIndex === "number"
  );
}

export function parseSaveData(raw: string): SavedGameState | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (isSavedGameState(data)) {
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
      req.onsuccess = () => resolve(isSavedGameState(req.result) ? req.result : null);
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
