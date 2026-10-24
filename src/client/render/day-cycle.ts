const DAY_SECONDS = 600;

export type DaylightSample = { daylight: number; sunPosition: { x: number; y: number; z: number } };

export function daylightAt(timeSeconds: number): DaylightSample {
  if (!Number.isFinite(timeSeconds)) throw new RangeError("Day-cycle time must be finite");
  const phase = ((((timeSeconds % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS) / DAY_SECONDS) * Math.PI * 2;
  const sunY = Math.sin(phase);
  const twilight = Math.max(0, Math.min(1, (sunY + 0.15) / 0.3));
  const daylight = twilight * twilight * (3 - 2 * twilight);
  return {
    daylight,
    sunPosition: { x: -Math.sqrt(1 - sunY * sunY), y: sunY, z: 0 },
  };
}
