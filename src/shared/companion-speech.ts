import type { BuildTask } from "./lan-protocol";

export type CompanionLineId = "spawn" | "follow" | "scouting" | "found" | "building" | "built" | "stuck" | "stopped";

export const COMPANION_LINES: Record<CompanionLineId, string> = {
  spawn: "Cześć! Jestem tutaj.",
  follow: "Jasne, idę za tobą.",
  scouting: "Poszukam czegoś ciekawego.",
  found: "Znalazłem coś ciekawego!",
  building: "Buduję domek.",
  built: "Domek gotowy!",
  stuck: "Nie mogę tam dojść.",
  stopped: "Dobra, przestaję.",
};

export const COMMAND_PATTERNS: Record<string, BuildTask> = {
  "chodź za mną": "follow",
  szukaj: "scout",
  "zbuduj domek": "build",
  stop: "stop",
};

export function interpretCompanionUtterance(text: string): { task: BuildTask } | null {
  const normalized = text.normalize("NFC").trim().toLocaleLowerCase("pl-PL").replace(/\s+/g, " ");
  const task = COMMAND_PATTERNS[normalized];
  return task ? { task } : null;
}
