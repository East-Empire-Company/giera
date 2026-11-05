import type { BuildBlock, BuildTask, CompanionState } from "../../shared/lan-protocol";
import { pickScoutTarget, planPath, type NavigationCell, type PathPlan } from "../../shared/companion-navigation";
import { stepActorSubdivided, type ActorMotionState } from "../../shared/actor-motion";
import type { CompanionLineId } from "../../shared/companion-speech";

export type VisibleCompanionBlock = NavigationCell & { id: number };
export type CompanionControllerSend = {
  state: (companion: CompanionState) => void;
  say: (id: string, line: CompanionLineId, evidence?: { block: string; x: number; y: number; z: number }) => void;
  place: (id: string, planId: string, blockIndex: number) => void;
  stop: () => void;
};
export type CompanionControllerOptions = {
  send: CompanionControllerSend;
  world: (x: number, y: number, z: number) => number;
  isLoaded: (x: number, y: number, z: number) => boolean;
  blocked: (x: number, y: number, z: number) => boolean;
  pathBlocked?: (x: number, y: number, z: number) => boolean;
  ownerPosition: () => { x: number, y: number, z: number };
  visibleBlocks: () => readonly VisibleCompanionBlock[];
  selfId: string | null;
  isOwner: boolean;
  isSyncing?: () => boolean;
};
export type CompanionController = {
  applyServerState(message: CompanionState | { companion: CompanionState }): void;
  applyServerRemove(id?: string): void;
  spawnLocal(profile: CompanionState["profile"], position: { x: number; y: number; z: number }, yaw?: number): CompanionState;
  setOwner(isOwner: boolean): void;
  setGeneration(generation: number): void;
  command(task: BuildTask, generation: number): boolean;
  reserveBuild(planId: string, blocks: readonly BuildBlock[], placed?: readonly number[]): boolean;
  blockPlaced(block: BuildBlock): void;
  tick(deltaSeconds: number): CompanionState | null;
  getState(): CompanionState | null;
  getTask(): BuildTask;
  stop(): void;
};

const DIRECTIONS = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }] as const;
const compareCells = (a: NavigationCell, b: NavigationCell): number => a.y - b.y || a.x - b.x || a.z - b.z;
const key2 = (x: number, z: number): string => `${x},${z}`;
const key3 = (x: number, y: number, z: number): string => `${x},${y},${z}`;
const distance2 = (a: { x: number; z: number }, b: { x: number; z: number }): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

export function createCompanionController(options: CompanionControllerOptions): CompanionController {
  let isOwner = options.isOwner;
  let generation = 0;
  let state: CompanionState | null = null;
  let motion: ActorMotionState | null = null;
  let task: BuildTask = "stop";
  let phase: "follow" | "scout" | "return" | "build" | "waiting" = "follow";
  let route: NavigationCell[] = [];
  let routeIndex = 0;
  let routeTimer = 0;
  let sendTimer = 0;
  let plannedOwner = { x: Number.NaN, z: Number.NaN };
  let scoutTarget: VisibleCompanionBlock | null = null;
  let planId: string | null = null;
  let buildBlocks: readonly BuildBlock[] = [];
  let buildOrder: number[] = [];
  const placed = new Set<number>();
  let inFlightIndex: number | null = null;
  let failureReported = false;
  let routeFailures = 0;
  let stallTimer = 0;
  let stallX = 0;
  let stallZ = 0;
  let escapeTimer = 0;
  let escapeYaw = 0;
  let escapeCount = 0;

  const assignState = (next: CompanionState): void => {
    state = next;
    motion = {
      position: { x: next.x, y: next.y, z: next.z },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: next.yaw,
      pitch: 0,
      onGround: true,
      jumpHeight: 0.9,
      flying: false,
    };
    route = [];
    routeIndex = 0;
  };

  const currentCell = (): NavigationCell => ({
    x: Math.floor(motion!.position.x),
    y: Math.floor(motion!.position.y),
    z: Math.floor(motion!.position.z),
  });

  const startCell = (): NavigationCell => {
    const cell = currentCell();
    const standable = (c: NavigationCell): boolean =>
      options.isLoaded(c.x, c.y - 1, c.z) && options.isLoaded(c.x, c.y, c.z) && options.isLoaded(c.x, c.y + 1, c.z) &&
      options.world(c.x, c.y - 1, c.z) !== 0 && options.world(c.x, c.y, c.z) === 0 && options.world(c.x, c.y + 1, c.z) === 0 &&
      !options.blocked(c.x, c.y, c.z) && !options.blocked(c.x, c.y + 1, c.z);
    if (standable(cell)) return cell;
    const neighbors: NavigationCell[] = [
      { x: cell.x + 1, y: cell.y, z: cell.z },
      { x: cell.x - 1, y: cell.y, z: cell.z },
      { x: cell.x, y: cell.y, z: cell.z + 1 },
      { x: cell.x, y: cell.y, z: cell.z - 1 },
      { x: cell.x, y: cell.y + 1, z: cell.z },
      { x: cell.x, y: cell.y - 1, z: cell.z },
    ];
    for (const candidate of neighbors) if (standable(candidate)) return candidate;
    return cell;
  };

  const footprintColumns = (): Set<string> => new Set(buildBlocks.map((block) => key2(block.x, block.z)));

  const pathOptions = (from: NavigationCell, goal: NavigationCell | null, followTarget?: { x: number; y: number; z: number } | null): Parameters<typeof planPath>[0] => {
    const columns = task === "build" ? footprintColumns() : null;
    const startInflated = options.pathBlocked?.(from.x, from.y, from.z) ?? false;
    return {
      world: options.world,
      isLoaded: options.isLoaded,
      from,
      goal,
      followTarget,
      blocked: (x, _y, z) => options.blocked(x, _y, z) || (!startInflated && (options.pathBlocked?.(x, _y, z) ?? false)) || Boolean(columns?.has(key2(x, z))),
    };
  };

  const installRoute = (plan: PathPlan): boolean => {
    if (plan.cells.length < 2 && plan.status !== "ok") return false;
    routeFailures = 0;
    route = plan.cells;
    routeIndex = route.length > 1 ? 1 : route.length;
    routeTimer = 0.25;
    return true;
  };

  const setLine = (line: CompanionLineId, evidence?: { block: string; x: number; y: number; z: number }): void => {
    if (state) options.send.say(state.id, line, evidence);
  };

  const retryRoute = (delay: number): boolean => {
    routeFailures += 1;
    if (routeFailures > 3) return false;
    routeTimer = delay;
    return true;
  };

  const stopForFailure = (reason = "?"): void => {
    if (failureReported) return;
    failureReported = true;
    options.send.stop();
    setLine("stuck");
    task = "stop";
    route = [];
    routeIndex = 0;
    inFlightIndex = null;
    if (state) state.anim = "idle";
  };

  const planFollow = (): boolean => {
    if (!motion) return false;
    const owner = options.ownerPosition();
    plannedOwner = { x: owner.x, z: owner.z };
    const dx = owner.x - motion.position.x;
    const dz = owner.z - motion.position.z;
    const distance = Math.hypot(dx, dz) || 1;
    const adjustedOwner = { x: owner.x + dx / distance * 0.5, y: owner.y, z: owner.z + dz / distance * 0.5 };
    return installRoute(planPath(pathOptions(startCell(), null, adjustedOwner)));
  };

  const observed = (target: VisibleCompanionBlock): boolean =>
    options.world(target.x, target.y, target.z) === target.id &&
    options.visibleBlocks().some((candidate) => candidate.x === target.x && candidate.y === target.y && candidate.z === target.z && candidate.id === target.id);

  const planScout = (): boolean => {
    if (!motion) return false;
    const from = startCell();
    const candidates = options.visibleBlocks().filter((block) =>
      Number.isInteger(block.x) && Number.isInteger(block.y) && Number.isInteger(block.z) &&
      options.world(block.x, block.y, block.z) === block.id
    );
    const targetCell = pickScoutTarget(candidates, from);
    scoutTarget = targetCell ? candidates.find((candidate) => candidate.x === targetCell.x && candidate.y === targetCell.y && candidate.z === targetCell.z) ?? null : null;
    if (!scoutTarget) return false;

    let best: PathPlan | null = null;
    for (const direction of DIRECTIONS) {
      const goal = { x: scoutTarget.x + direction.x, y: scoutTarget.y, z: scoutTarget.z + direction.z };
      const candidate = planPath(pathOptions(from, goal));
      if (candidate.status !== "ok") continue;
      if (!best || candidate.cells.length < best.cells.length || (candidate.cells.length === best.cells.length && compareCells(candidate.cells[candidate.cells.length - 1], best.cells[best.cells.length - 1]) < 0)) best = candidate;
    }
    return best !== null && installRoute(best);
  };

  const planPlacementRoute = (): boolean => {
    if (!motion || buildBlocks.length === 0) return false;
    const nextIndex = buildOrder.find((index) => !placed.has(index));
    if (nextIndex === undefined) {
      setLine("built");
      task = "stop";
      phase = "follow";
      route = [];
      return true;
    }
    const block = buildBlocks[nextIndex]!;
    const columns = footprintColumns();
    const from = startCell();
    const candidates: NavigationCell[] = [];
    for (let x = block.x - 5; x <= block.x + 5; x += 1) {
      for (let z = block.z - 5; z <= block.z + 5; z += 1) {
        if (columns.has(key2(x, z))) continue;
        for (let y = block.y - 8; y <= block.y + 1; y += 1) {
          if (!options.isLoaded(x, y - 1, z) || !options.isLoaded(x, y, z) || !options.isLoaded(x, y + 1, z)) continue;
          if (options.world(x, y - 1, z) === 0 || options.world(x, y, z) !== 0 || options.world(x, y + 1, z) !== 0) continue;
          if (options.blocked(x, y, z) || options.blocked(x, y + 1, z)) continue;
          candidates.push({ x, y, z });
        }
      }
    }
    const blockDist = (cell: NavigationCell): number =>
      Math.hypot(cell.x + 0.5 - (block.x + 0.5), cell.y + 0.5 - (block.y + 0.5), cell.z + 0.5 - (block.z + 0.5));
    if (blockDist(from) <= 7.5) return installRoute({ status: "ok", cells: [from, from] });
    candidates.sort((a, b) => blockDist(a) - blockDist(b) || Math.abs(a.x - from.x) + Math.abs(a.z - from.z) - (Math.abs(b.x - from.x) + Math.abs(b.z - from.z)) || compareCells(a, b));
    for (const candidate of candidates.slice(0, 12)) {
      const planned = planPath(pathOptions(from, candidate));
      if (planned.status === "ok") {
        if (planned.cells.length < 2) return installRoute({ status: "ok", cells: [from, candidate] });
        return installRoute(planned);
      }
      if (planned.status === "unreachable" && planned.cells.length >= 3) return installRoute(planned);
    }
    return false;
  };

  const sendNextPlacement = (): void => {
    if (!state || !planId || inFlightIndex !== null) return;
    const nextIndex = buildOrder.find((index) => !placed.has(index));
    if (nextIndex === undefined) {
      setLine("built");
      task = "stop";
      phase = "follow";
      route = [];
      return;
    }
    inFlightIndex = nextIndex;
    options.send.place(state.id, planId, nextIndex);
  };

  const finishRoute = (): void => {
    route = [];
    routeIndex = 0;
    if (task === "scout" && phase === "scout") {
      if (scoutTarget && observed(scoutTarget)) {
        setLine("found", { block: String(scoutTarget.id), x: scoutTarget.x, y: scoutTarget.y, z: scoutTarget.z });
      }
      phase = "return";
      if (!planFollow() && !retryRoute(0.5)) stopForFailure("scout-return-planFollow");
    } else if (task === "scout" && phase === "return") {
      task = "stop";
    } else if (task === "build" && phase === "build") {
      const nextIndex = buildOrder.find((index) => !placed.has(index));
      const block = nextIndex !== undefined ? buildBlocks[nextIndex] : null;
      const cell = motion ? { x: Math.floor(motion.position.x), y: Math.floor(motion.position.y), z: Math.floor(motion.position.z) } : null;
      const near = Boolean(block && cell && Math.hypot(cell.x + 0.5 - (block.x + 0.5), cell.y + 0.5 - (block.y + 0.5), cell.z + 0.5 - (block.z + 0.5)) <= 7.5);
      if (near) {
        phase = "waiting";
        sendNextPlacement();
      }
    }
  };

  const updateRoute = (): boolean => {
    if (!motion) return false;
    if (task === "follow" || (task === "scout" && phase === "return")) return planFollow();
    if (task === "scout") return planScout();
    if (task === "build") return planPlacementRoute();
    return false;
  };

  const controller: CompanionController = {
    applyServerState(message) {
      const incoming = "companion" in message ? message.companion : message;
      if (isOwner && state && (state.id === incoming.id || state.id === "local-companion")) {
        state.id = incoming.id;
        state.x = incoming.x;
        state.y = incoming.y;
        state.z = incoming.z;
        state.yaw = incoming.yaw;
        state.anim = incoming.anim;
        return;
      }
      assignState({ ...incoming });
    },
    applyServerRemove(id) {
      if (!state || (id && state.id !== id)) return;
      state = null;
      motion = null;
      task = "stop";
      route = [];
      routeIndex = 0;
      scoutTarget = null;
      planId = null;
      buildBlocks = [];
      buildOrder = [];
      placed.clear();
      inFlightIndex = null;
      failureReported = false;
    },
    spawnLocal(profile, position, yaw = 0) {
      const localState: CompanionState = { id: "local-companion", profile, x: position.x, y: position.y, z: position.z, yaw, anim: "idle" };
      assignState(localState);
      return localState;
    },
    setOwner(value) {
      if (isOwner === value) return;
      isOwner = value;
      task = "stop";
      route = [];
      routeIndex = 0;
      inFlightIndex = null;
      failureReported = false;
    },
    setGeneration(value) {
      if (!Number.isSafeInteger(value) || value <= generation) return;
      generation = value;
      task = "stop";
      route = [];
      routeIndex = 0;
      inFlightIndex = null;
      failureReported = false;
    },
    command(nextTask, expectedGeneration) {
      if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < generation) return false;
      generation = expectedGeneration;
      task = nextTask;
      phase = nextTask === "scout" ? "scout" : "follow";
      route = [];
      failureReported = false;
      routeIndex = 0;
      routeTimer = 0;
      inFlightIndex = null;
      if (!isOwner || !state) return true;
      if (nextTask === "follow") setLine("follow");
      else if (nextTask === "scout") setLine("scouting");
      else if (nextTask === "stop") setLine("stopped");
      return true;
    },
    reserveBuild(id, blocks, alreadyPlaced = []) {
      if (!isOwner || !state || blocks.length === 0) return false;
      failureReported = false;
      task = "build";
      phase = "build";
      planId = id;
      buildBlocks = blocks;
      placed.clear();
      for (const index of alreadyPlaced) placed.add(index);
      buildOrder = blocks.map((_, index) => index).sort((a, b) =>
        blocks[a].y - blocks[b].y || blocks[a].x - blocks[b].x || blocks[a].z - blocks[b].z
      );
      inFlightIndex = null;
      route = [];
      routeIndex = 0;
      setLine("building");
      phase = "build";
      route = [];
      routeIndex = 0;
      routeTimer = 0;
      routeFailures = 0;
      return true;
    },
    blockPlaced(block) {
      if (!planId || inFlightIndex === null) return;
      const expected = buildBlocks[inFlightIndex];
      if (expected.x !== block.x || expected.y !== block.y || expected.z !== block.z || expected.id !== block.id) return;
      placed.add(inFlightIndex);
      inFlightIndex = null;
      phase = "build";
      route = [];
      routeIndex = 0;
      routeTimer = 0;
    },
    tick(deltaSeconds) {
      if (!state || !motion || !isOwner || options.isSyncing?.()) return state;
      const delta = Math.max(0, Math.min(deltaSeconds, 0.25));
      if (delta === 0) return state;
      if (motion.position.y < -20) {
        stopForFailure("tick-fell");
        return state;
      }
      if (task !== "stop" && task !== "build" || task === "build" && phase === "build") {
        routeTimer -= delta;
        const owner = options.ownerPosition();
        if (task === "follow" && distance2(owner, plannedOwner) > 1) route = [];
        if (route.length === 0 && routeTimer <= 0) {
          if (!updateRoute()) {
            if (!retryRoute(0.5)) {
              stopForFailure(`tick-updateRoute task=${task} phase=${phase}`);
              return state;
            }
          }
        }
        if (routeIndex < route.length) {
          const waypoint = route[routeIndex];
          if (options.blocked(waypoint.x, waypoint.y, waypoint.z)) {
            route = [];
            routeTimer = 0;
          } else if (escapeTimer > 0) {
            escapeTimer -= delta;
            motion.yaw = escapeYaw;
            stepActorSubdivided((x, y, z) => options.world(x, y, z) !== 0, motion, { forward: 1, right: 0, jump: motion.onGround, sprint: false }, delta);
            state.anim = motion.onGround ? "walk" : "jump";
          } else {
            const targetX = waypoint.x + 0.5;
            const targetZ = waypoint.z + 0.5;
            const dx = targetX - motion.position.x;
            const dz = targetZ - motion.position.z;
            if (dx * dx + dz * dz < 0.09 && Math.abs(waypoint.y - motion.position.y) < 0.6) {
              routeIndex += 1;
              stallTimer = 0;
              if (routeIndex >= route.length) finishRoute();
            } else {
              stallTimer += delta;
              if (stallTimer >= 1.5) {
                if (Math.hypot(motion.position.x - stallX, motion.position.z - stallZ) < 0.6) {
                  escapeTimer = 0.9;
                  escapeYaw = Math.atan2(-(motion.position.x - owner.x), -(motion.position.z - owner.z));
                  escapeCount += 1;
                }
                stallX = motion.position.x;
                stallZ = motion.position.z;
                stallTimer = 0;
              }
              motion.yaw = Math.atan2(-dx, -dz);
              const needJump = motion.onGround && waypoint.y > Math.floor(motion.position.y + 0.1);
              stepActorSubdivided((x, y, z) => options.world(x, y, z) !== 0, motion, { forward: 1, right: 0, jump: needJump, sprint: false }, delta);
              state.anim = motion.onGround ? "walk" : "jump";
            }
          }
        } else if (task === "build" && phase === "waiting") {
          sendNextPlacement();
        } else if (task === "scout" && phase === "return") {
          finishRoute();
        }
      }
      if (task === "build" && phase === "waiting") sendNextPlacement();
      if (motion.position.y < -20) stopForFailure();
      state.x = motion.position.x;
      state.y = motion.position.y;
      state.z = motion.position.z;
      state.yaw = motion.yaw;
      if (state.anim === "walk" && motion.position.y < 0) state.anim = "jump";
      sendTimer += delta;
      if (sendTimer >= 0.1) {
        sendTimer %= 0.1;
        options.send.state(state);
      }
      return state;
    },
    getState() {
      return state;
    },
    getTask() {
      return task;
    },
    stop() {
      options.send.stop();
      task = "stop";
      route = [];
      routeIndex = 0;
      inFlightIndex = null;
      setLine("stopped");
      if (state) state.anim = "idle";
    },
  };
  return controller;
}
