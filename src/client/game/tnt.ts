export const TNT_FUSE_SECONDS = 1.2;
export const TNT_CHAIN_FUSE_SECONDS = 0.25;
export const TNT_SPARK_INTERVAL = 0.22;
export const TNT_RADIUS = 3.2;
export const TNT_KNOCKBACK_RANGE = 7;
export const TNT_KNOCKBACK_STRENGTH = 13;

type TntFuse = { x: number; y: number; z: number; fuse: number; sparkIn: number };

const keyOf = (x: number, y: number, z: number): string => `${x},${y},${z}`;

export class TntFuseQueue {
  private readonly fuses = new Map<string, TntFuse>();

  ignite(x: number, y: number, z: number, fuseSeconds = TNT_FUSE_SECONDS): boolean {
    const key = keyOf(x, y, z);
    if (this.fuses.has(key)) return false;
    this.fuses.set(key, { x, y, z, fuse: fuseSeconds, sparkIn: 0 });
    return true;
  }

  isLit(x: number, y: number, z: number): boolean {
    return this.fuses.has(keyOf(x, y, z));
  }

  get size(): number {
    return this.fuses.size;
  }

  update(
    delta: number,
    onExplode: (x: number, y: number, z: number) => void,
    onSpark: (x: number, y: number, z: number) => void = () => {}
  ): void {
    const expired: TntFuse[] = [];
    for (const fuse of this.fuses.values()) {
      fuse.fuse -= delta;
      fuse.sparkIn -= delta;
      if (fuse.sparkIn <= 0) {
        fuse.sparkIn = TNT_SPARK_INTERVAL;
        onSpark(fuse.x, fuse.y, fuse.z);
      }
      if (fuse.fuse <= 0) expired.push(fuse);
    }
    for (const fuse of expired) {
      this.fuses.delete(keyOf(fuse.x, fuse.y, fuse.z));
      onExplode(fuse.x, fuse.y, fuse.z);
    }
  }
}
