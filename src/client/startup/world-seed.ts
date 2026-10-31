export function resolveWorldSeed(search: string, randomSeed: number): number {
  const value = new URLSearchParams(search).get("seed");
  if (!value || !/^-?\d+$/.test(value)) return randomSeed;
  const seed = Number(value);
  return Number.isSafeInteger(seed) ? seed : randomSeed;
}
