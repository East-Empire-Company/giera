import { describe, expect, it } from "vitest";
import { withRetry } from "../../src/shared/retry";

describe("withRetry", () => {
  it("retries with exponential backoff until the task succeeds", async () => {
    const waits: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("flaky network");
        return "ok";
      },
      { baseMs: 100, sleep: async (ms) => void waits.push(ms) }
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  it("rethrows the last error after exhausting all attempts", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error(`failure ${calls}`);
        },
        { attempts: 3, sleep: async () => {} }
      )
    ).rejects.toThrow("failure 3");
    expect(calls).toBe(3);
  });
});
