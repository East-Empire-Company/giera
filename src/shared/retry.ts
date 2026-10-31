export type RetryOptions = {
  attempts?: number;
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export async function withRetry<T>(task: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const baseMs = options.baseMs ?? 700;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(baseMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
