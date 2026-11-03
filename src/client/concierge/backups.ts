import { OFFLINE_SAVE_KEY, getActiveSaveKey } from "../game/save-session";
import { loadGameState, saveGameState, clearGameState, type SavedGameState } from "../persist/db";

export type BackupEntry = { id: string; label: string; createdAt: string; state: SavedGameState };
export type BackupSummary = { id: string; label: string; createdAt: string };

const STORAGE_KEY = "giera_concierge_backups";
const MAX_BACKUPS = 5;

type BackupStorage = Pick<globalThis.Storage, "getItem" | "setItem">;

const defaultStorage = (): BackupStorage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

const isEntry = (value: unknown): value is BackupEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<BackupEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.label === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.state === "object" &&
    entry.state !== null
  );
};

export function readBackups(
  storage: BackupStorage | null = defaultStorage(),
  saveKey: string = getActiveSaveKey(),
): BackupEntry[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(backupStorageKey(saveKey)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

export function backupStorageKey(saveKey: string = getActiveSaveKey()): string {
  return saveKey === OFFLINE_SAVE_KEY ? STORAGE_KEY : `${STORAGE_KEY}:${saveKey}`;
}

function writeBackups(entries: BackupEntry[], storage: BackupStorage | null, saveKey: string): void {
  if (!storage) return;
  try {
    storage.setItem(backupStorageKey(saveKey), JSON.stringify(entries.slice(0, MAX_BACKUPS)));
  } catch {
    // Storage full or blocked: the backup is optional, the game keeps running.
  }
}

export function summarize(entry: BackupEntry): BackupSummary {
  return { id: entry.id, label: entry.label, createdAt: entry.createdAt };
}

export async function createBackup(
  label: string,
  now: Date = new Date(),
  storage: BackupStorage | null = defaultStorage(),
  saveKey: string = getActiveSaveKey(),
): Promise<BackupSummary | null> {
  const state = await loadGameState(saveKey);
  if (!state) return null;
  const createdAt = now.toISOString();
  const entry: BackupEntry = {
    id: `bk-${now.getTime().toString(36)}`,
    label: label.trim().slice(0, 40) || "kopia",
    createdAt,
    state,
  };
  writeBackups([entry, ...readBackups(storage, saveKey)], storage, saveKey);
  return summarize(entry);
}

export async function restoreBackup(
  id: string,
  storage: BackupStorage | null = defaultStorage(),
  saveKey: string = getActiveSaveKey(),
): Promise<boolean> {
  const entry = readBackups(storage, saveKey).find((candidate) => candidate.id === id);
  if (!entry) return false;
  return saveGameState(entry.state, saveKey);
}

export async function clearProgress(saveKey: string = getActiveSaveKey()): Promise<void> {
  await clearGameState(saveKey);
}