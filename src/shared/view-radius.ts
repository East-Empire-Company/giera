export const FULL_VIEW_RADIUS = 20;
export const LOW_POWER_VIEW_RADIUS = 8;

export function pickViewRadius(userAgent: string, deviceMemoryGb: number | undefined): number {
  const console = /\bXbox\b/i.test(userAgent);
  const lowMemory = deviceMemoryGb !== undefined && deviceMemoryGb <= 4;
  return console || lowMemory ? LOW_POWER_VIEW_RADIUS : FULL_VIEW_RADIUS;
}
