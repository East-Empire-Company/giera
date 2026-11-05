import { BLOCK_ID } from "../../shared/blocks";
import { baseStagePlan, type BaseBlockOp } from "../../shared/tycoon-base-plan";

export type BaseWorld = {
  getBlock(x: number, y: number, z: number): number;
  getGeneratedBlock(x: number, y: number, z: number): number;
  hasEdit(x: number, y: number, z: number): boolean;
  setBlock(x: number, y: number, z: number, id: number): void;
  refreshDecor?(): void;
};

export class TycoonBase {
  private queue: BaseBlockOp[] = [];
  private changedSinceDecorRefresh = false;
  readonly diagnostics: string[] = [];

  constructor(
    private readonly origin: { x: number; y: number; z: number },
    private readonly world: BaseWorld,
  ) {}

  private current(op: BaseBlockOp): number {
    return this.world.getBlock(this.origin.x + op.x, this.origin.y + op.y, this.origin.z + op.z);
  }

  private compatible(op: BaseBlockOp): boolean {
    const x = this.origin.x + op.x;
    const y = this.origin.y + op.y;
    const z = this.origin.z + op.z;
    const current = this.world.getBlock(x, y, z);
    if (current === op.id) return true;
    if (op.kind === "surface") {
      return !this.world.hasEdit(x, y, z) && current === this.world.getGeneratedBlock(x, y, z);
    }
    return current === BLOCK_ID.air;
  }

  preflight(stage: number): boolean {
    return baseStagePlan(stage).every((op) => this.compatible(op));
  }

  start(stage: number): boolean {
    const plan = baseStagePlan(stage);
    if (!plan.every((op) => this.compatible(op))) return false;
    this.queue.push(...plan);
    return true;
  }

  update(_delta: number): void {
    for (let count = 0; count < 4 && this.queue.length; count++) {
      const op = this.queue.shift()!;
      if (!this.compatible(op)) {
        this.diagnostics.push(`Skipped foreign HQ cell ${op.x},${op.y},${op.z}`);
        continue;
      }
      if (this.current(op) !== op.id) {
        this.world.setBlock(this.origin.x + op.x, this.origin.y + op.y, this.origin.z + op.z, op.id);
        this.changedSinceDecorRefresh = true;
      }
    }
    if (this.queue.length === 0) this.refreshDecorAfterChange();
  }

  restore(stages: readonly number[]): void {
    this.queue.length = 0;
    for (const stage of stages) {
      for (const op of baseStagePlan(stage)) {
        if (this.current(op) === op.id) continue;
        if (!this.compatible(op)) {
          this.diagnostics.push(`Preserved foreign HQ cell ${op.x},${op.y},${op.z}`);
          continue;
        }
        this.world.setBlock(this.origin.x + op.x, this.origin.y + op.y, this.origin.z + op.z, op.id);
        this.changedSinceDecorRefresh = true;
      }
    }
    this.refreshDecorAfterChange();
  }

  private refreshDecorAfterChange(): void {
    if (!this.changedSinceDecorRefresh) return;
    this.changedSinceDecorRefresh = false;
    this.world.refreshDecor?.();
  }

  dispose(): void {
    this.queue.length = 0;
    this.changedSinceDecorRefresh = false;
  }
}
