import { describe, expect, it } from "vitest";
import { makeRng } from "../../src/shared/rng";

describe("seeded rng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = makeRng(1337);
    const b = makeRng(1337);

    const seqA = Array.from({ length: 64 }, () => a());
    const seqB = Array.from({ length: 64 }, () => b());

    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = Array.from({ length: 32 }, makeRng(1337));
    const b = Array.from({ length: 32 }, makeRng(424242));

    expect(a).not.toEqual(b);
  });

  it("stays within [0, 1)", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 10000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("spreads values across the unit interval", () => {
    const rng = makeRng(99);
    const buckets = [0, 0, 0, 0];
    const samples = 10000;
    for (let i = 0; i < samples; i++) {
      buckets[Math.floor(rng() * 4)]++;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(samples * 0.2);
      expect(count).toBeLessThan(samples * 0.3);
    }
  });

  it("is independent across generator instances", () => {
    const a = makeRng(1);
    const b = makeRng(1);
    a();
    a();

    expect(a()).not.toBe(b());
  });

  it("handles negative and non-integer seeds deterministically", () => {
    const negative = makeRng(-5);
    const fractional = makeRng(3.7);

    expect(negative()).toBe(makeRng(-5)());
    expect(fractional()).toBe(makeRng(3.7)());
    expect(negative()).toBeGreaterThanOrEqual(0);
    expect(fractional()).toBeGreaterThanOrEqual(0);
  });
});
