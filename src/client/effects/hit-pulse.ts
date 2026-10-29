export type HitPulseScale = { x: number; y: number; z: number };

/** Elastic squash on the struck block's crack overlay: quick stretch, slower recovery, fading in with mining progress. */
export function hitPulseScale(elapsed: number, miningProgress: number): HitPulseScale {
  const pulse = Math.max(0, Math.sin(elapsed * 28)) * Math.min(1, miningProgress);
  return { x: 1.03 + pulse * 0.05, y: 1.03 - pulse * 0.02, z: 1.03 + pulse * 0.05 };
}