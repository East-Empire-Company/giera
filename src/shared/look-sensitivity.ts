export const BASE_LOOK_RADIANS_PER_PIXEL = 0.0032;
const SLOW_BOOST = 1.6;
const SLOW_FALLOFF_PIXELS = 6;

export function lookGain(movementX: number, movementY: number): number {
  const speed = Math.hypot(movementX, movementY);
  return BASE_LOOK_RADIANS_PER_PIXEL * (1 + SLOW_BOOST * Math.exp(-speed / SLOW_FALLOFF_PIXELS));
}
