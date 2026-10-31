export type MicErrorCode = "denied" | "missing" | "busy" | "insecure" | "unsupported" | "unknown";

export const MIC_ERROR_MESSAGES: Record<MicErrorCode, string> = {
  denied: "Brak zgody na mikrofon. Zezwól na mikrofon i spróbuj ponownie.",
  missing: "Nie znaleziono mikrofonu.",
  busy: "Mikrofon jest zajęty przez inną aplikację.",
  insecure: "Mikrofon wymaga bezpiecznego połączenia HTTPS.",
  unsupported: "Ta przeglądarka nie obsługuje nagrywania dźwięku.",
  unknown: "Nie udało się włączyć mikrofonu. Sprawdź uprawnienia.",
};

const ERROR_CODES: Record<string, MicErrorCode> = {
  NotAllowedError: "denied",
  PermissionDeniedError: "denied",
  SecurityError: "insecure",
  NotFoundError: "missing",
  DevicesNotFoundError: "missing",
  OverconstrainedError: "missing",
  ConstraintNotSatisfiedError: "missing",
  NotReadableError: "busy",
  TrackStartError: "busy",
  AbortError: "busy",
};

export function classifyMicError(error: unknown): MicErrorCode {
  if (error && typeof error === "object" && "name" in error) {
    const name = String((error as { name: unknown }).name);
    const code = ERROR_CODES[name];
    if (code) return code;
    if (name === "TypeError") return "unsupported";
  }
  return "unknown";
}

export function micErrorMessage(error: unknown): string {
  return MIC_ERROR_MESSAGES[classifyMicError(error)];
}
