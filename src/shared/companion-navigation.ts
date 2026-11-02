export type NavigationCell = { x: number; y: number; z: number };
export type PathPlan = { status: "ok" | "no_goal" | "unreachable" | "terrain_unloaded"; cells: NavigationCell[] };
export type ScoutTargetScorer = (candidate: NavigationCell, from: NavigationCell) => number;

export type PlanPathOptions = {
  world: (x: number, y: number, z: number) => number;
  isLoaded: (x: number, y: number, z: number) => boolean;
  blocked: (x: number, y: number, z: number) => boolean;
  from: NavigationCell;
  goal: NavigationCell | null;
  followTarget?: NavigationCell | null;
  maxStates?: number;
};

type SearchNode = { cell: NavigationCell; parent: number; depth: number };

const directions = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
] as const;

function cellKey(cell: NavigationCell): string {
  return `${cell.x},${cell.y},${cell.z}`;
}

function compareCells(left: NavigationCell, right: NavigationCell): number {
  return left.y - right.y || left.x - right.x || left.z - right.z;
}

function pathTo(nodes: SearchNode[], index: number): NavigationCell[] {
  const cells: NavigationCell[] = [];
  while (index >= 0) {
    cells.push(nodes[index].cell);
    index = nodes[index].parent;
  }
  cells.reverse();
  return cells;
}

export function planPath(options: PlanPathOptions): PathPlan {
  const followTarget = options.followTarget ?? null;
  if (options.goal === null && followTarget === null) return { status: "no_goal", cells: [] };

  const start = { x: Math.floor(options.from.x), y: Math.floor(options.from.y), z: Math.floor(options.from.z) };
  const goal = options.goal && { x: Math.floor(options.goal.x), y: Math.floor(options.goal.y), z: Math.floor(options.goal.z) };
  const requestedStateCount = Number.isFinite(options.maxStates) ? Math.floor(options.maxStates!) : 1024;
  const maxStates = Math.min(1024, Math.max(1, requestedStateCount));
  let sawUnloaded = false;

  const canStand = (cell: NavigationCell): boolean => {
    if (
      !options.isLoaded(cell.x, cell.y - 1, cell.z) ||
      !options.isLoaded(cell.x, cell.y, cell.z) ||
      !options.isLoaded(cell.x, cell.y + 1, cell.z)
    ) {
      sawUnloaded = true;
      return false;
    }
    if (options.world(cell.x, cell.y - 1, cell.z) === 0) return false;
    if (options.world(cell.x, cell.y, cell.z) !== 0 || options.world(cell.x, cell.y + 1, cell.z) !== 0) return false;
    return !options.blocked(cell.x, cell.y, cell.z) && !options.blocked(cell.x, cell.y + 1, cell.z);
  };

  if (!canStand(start)) return { status: sawUnloaded ? "terrain_unloaded" : "unreachable", cells: [] };

  const followDistance = (cell: NavigationCell): number => {
    const dx = cell.x + 0.5 - followTarget!.x;
    const dz = cell.z + 0.5 - followTarget!.z;
    return dx * dx + dz * dz;
  };
  const goalDistance = (cell: NavigationCell): number => {
    if (followTarget) return followDistance(cell);
    const dx = cell.x - goal!.x;
    const dy = cell.y - goal!.y;
    const dz = cell.z - goal!.z;
    return dx * dx + dy * dy + dz * dz;
  };
  const isGoal = (cell: NavigationCell): boolean => {
    if (followTarget) {
      const distance = followDistance(cell);
      return distance >= 4 && distance <= 16;
    }
    return cell.x === goal!.x && cell.y === goal!.y && cell.z === goal!.z;
  };

  const nodes: SearchNode[] = [{ cell: start, parent: -1, depth: 0 }];
  const seen = new Set([cellKey(start)]);
  let bestIndex = 0;
  let bestDistance = goalDistance(start);
  if (isGoal(start)) return { status: "ok", cells: [start] };

  let cursor = 0;
  let stateLimitReached = false;
  while (cursor < nodes.length && !stateLimitReached) {
    const parentIndex = cursor;
    const node = nodes[cursor++];
    if (node.depth >= 12) continue;

    for (const direction of directions) {
      for (const feetY of [node.cell.y, node.cell.y + 1, node.cell.y - 1]) {
        const cell = { x: node.cell.x + direction.x, y: feetY, z: node.cell.z + direction.z };
        const key = cellKey(cell);
        if (seen.has(key)) continue;
        if (!canStand(cell)) continue;
        if (nodes.length >= maxStates) {
          stateLimitReached = true;
          break;
        }
        seen.add(key);
        nodes.push({ cell, parent: parentIndex, depth: node.depth + 1 });
        const index = nodes.length - 1;
        const distance = goalDistance(cell);
        if (distance < bestDistance || (distance === bestDistance && compareCells(cell, nodes[bestIndex].cell) < 0)) {
          bestDistance = distance;
          bestIndex = index;
        }
        if (isGoal(cell)) return { status: "ok", cells: pathTo(nodes, index) };
      }
      if (stateLimitReached) break;
    }
  }

  return {
    status: sawUnloaded ? "terrain_unloaded" : "unreachable",
    cells: pathTo(nodes, bestIndex),
  };
}

export function pickScoutTarget(
  candidates: readonly NavigationCell[],
  from: NavigationCell,
  scorer?: ScoutTargetScorer
): NavigationCell | null {
  let selected: NavigationCell | null = null;
  let selectedScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const dx = candidate.x - from.x;
    const dy = candidate.y - from.y;
    const dz = candidate.z - from.z;
    const score = scorer ? scorer(candidate, from) : dx * dx + dy * dy + dz * dz;
    if (selected === null || score < selectedScore || (score === selectedScore && compareCells(candidate, selected) < 0)) {
      selected = candidate;
      selectedScore = score;
    }
  }
  return selected;
}
