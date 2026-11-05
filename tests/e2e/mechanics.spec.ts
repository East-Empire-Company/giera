import { test, expect, type Page } from "@playwright/test";
import { SPEC } from "../spec-constants";
import { raycastInteract, type RayHit } from "../../src/shared/raycast";
import { WARSAW_CITY_DEPTH, WARSAW_CITY_WIDTH, WARSAW_CITY_WORLD_X, WARSAW_CITY_WORLD_Z } from "../../src/shared/warsaw-city-data.generated";

type Vec3 = { x: number; y: number; z: number; clone: () => Vec3; set: (x: number, y: number, z: number) => Vec3 };
type Bounds3 = { min: Vec3; max: Vec3 };
type GeometryAttribute = { count: number; getX: (index: number) => number; getY: (index: number) => number; getZ: (index: number) => number };
type TerrainGeometry = {
  index: GeometryAttribute | null;
  boundingBox: Bounds3 | null;
  getAttribute: (name: string) => GeometryAttribute | undefined;
  computeBoundingBox: () => void;
};
type TerrainMesh = {
  isMesh: true;
  geometry: TerrainGeometry;
  position: Vec3;
  localToWorld: (point: Vec3) => Vec3;
};
type TerrainPoint = { x: number; y: number; z: number };
type TerrainTriangle = {
  a: TerrainPoint;
  b: TerrainPoint;
  c: TerrainPoint;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};
type AvatarGeometry = {
  attributes?: { position?: GeometryAttribute };
  boundingBox: Bounds3 | null;
  computeBoundingBox: () => void;
};
type AvatarNode = {
  geometry?: AvatarGeometry;
  localToWorld: (point: Vec3) => Vec3;
  getVertexPosition?: (index: number, target: Vec3) => Vec3;
  isSkinnedMesh?: boolean;
  position?: Vec3;
  skeleton?: { update: () => void };
  computeBoundingBox?: () => void;
  boundingBox?: Bounds3 | null;
};
type AvatarObject = {
  position: Vec3;
  updateMatrixWorld: (force?: boolean) => void;
  traverse: (fn: (node: AvatarNode) => void) => void;
};
type AvatarVisual = {
  object: AvatarObject;
  currentMotion?: string;
  requestedMotion?: string;
  currentClipName?: string;
  setMotion: (motion: "idle" | "walk") => void;
  update: (deltaSeconds: number) => void;
};

type FlatSpot = { x: number; y: number; z: number };
type GroundingPath = FlatSpot & { dx: number; dz: number; yaw: number; endY: number };
type GroundingResult = {
  startX: number;
  startZ: number;
  dx: number;
  dz: number;
  endX: number;
  endZ: number;
  groundedWalkingFrames: number;
  nearGroundFrames: number;
  minimumRootClearance: number;
  maximumRootClearance: number;
  maximumVisualOffset: number;
  groundOffsetAtMinimum: number;
  missingSurfaceSamples: number;
  framesWithoutSurface: number;
  minimumClearance: number;
};
type RegionBlock = { x: number; y: number; z: number; id: number };
type CameraRay = {
  origin: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
  blocks: RegionBlock[];
  player: { x: number; y: number; z: number };
};
type ArmedTarget = {
  fixture: { x: number; y: number; z: number };
  hit: RayHit;
  placeTarget: { x: number; y: number; z: number };
};

type Giera = {
  ready: boolean;
  scene: { traverse: (fn: (node: any) => void) => void; updateMatrixWorld: (force?: boolean) => void };
  stats: { chunkCount: number };
  player: {
    characterProfile: "ziemek" | "gniewko";
    position: Vec3;
    velocity: Vec3;
    yaw: number;
    pitch: number;
    onGround: boolean;
    isActing: boolean;
    syncAvatar: () => void;
    avatar?: AvatarVisual;
  };
  player2: {
    characterProfile: "ziemek" | "gniewko";
    position: Vec3;
    velocity: Vec3;
    yaw: number;
    onGround: boolean;
    syncAvatar: () => void;
    avatar?: AvatarVisual;
  };
  camera: {
    position: { x: number; y: number; z: number; clone: () => { x: number; y: number; z: number } };
    getWorldDirection: (target: { x: number; y: number; z: number }) => void;
  };
  world: {
    getBlock: (x: number, y: number, z: number) => number;
    setBlock: (x: number, y: number, z: number, id: number) => void;
  };
  inventory: {
    activeSlot: number;
    toJSON: () => { activeSlot: number; blocks: Record<string, number>; items: Record<string, number> };
    addMinedBlock: (key: string, count?: number) => void;
    setHotbarSlot: (index: number, blockId: number) => void;
  };
  npcManager: {
    npcs: {
      def: { id: string };
      position: { x: number; y: number; z: number };
      name: string;
      avatar?: AvatarVisual;
    }[];
  };
  splitScreen: { isSplitScreen: boolean };
  tycoon: {
    collectedStars: number;
    dropperTier: number;
    vaultCoins: number;
    origin: { x: number; y: number; z: number };
    addStars: (n: number) => void;
    collectorPadPos: { x: number; z: number };
    upgradePadPos: { x: number; z: number };
    trampolinePos: { x: number; z: number };
    expansionSlots: readonly { index: number; x: number; z: number; cost: number }[];
    buyExpansion: (index: number) => boolean;
    getCollisionBodies: () => readonly { x: number; y: number; z: number; radius: number; height: number }[];
    toJSON: () => { vaultCoins: number; collectedStars: number; dropperTier: number; expansions?: number[] };
  };
  qa: { simTime: number; frame: number; paused: boolean; events: { ev: string; id?: string; t: number }[] };
};

type G = { __GIERA__: Giera };

const STONE_ID = 2;
const COBBLESTONE_ID = 3;
const INTERACT_REACH = 12;

async function boot(page: Page): Promise<void> {
  await page.goto(`/?seed=${SPEC.seed}&qa=1`);
  await page.waitForFunction(() => (window as unknown as G).__GIERA__?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => {
    const g = (window as unknown as G).__GIERA__;
    return (g?.qa?.frame ?? 0) > 60;
  }, null, { timeout: 20_000 });
}

type InventorySnapshot = {
  activeSlot: number;
  hotbar: number[];
  blocks: Record<string, number>;
  items: Record<string, number>;
};

async function invOf(page: Page): Promise<InventorySnapshot> {
  return page.evaluate(() => (window as unknown as G).__GIERA__.inventory.toJSON()) as Promise<InventorySnapshot>;
}

async function addBlocks(page: Page, key: string, count: number): Promise<void> {
  await page.evaluate(
    ([key, count]) => {
      (window as unknown as G).__GIERA__.inventory.addMinedBlock(key, count);
    },
    [key, count] as [string, number]
  );
}

async function waitOnGround(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as G).__GIERA__?.player?.onGround === true);
}

async function findFlatSpots(page: Page): Promise<FlatSpot[]> {
  return page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    const surface = (x: number, z: number): number => {
      for (let y = 63; y > 0; y--) {
        if (g.world.getBlock(x, y, z) !== 0) return y;
      }
      return -1;
    };
    const spots: { x: number; y: number; z: number }[] = [];
    for (let x = -8; x <= 10 && spots.length < 12; x++) {
      for (let z = -8; z <= 10 && spots.length < 12; z++) {
        const h = surface(x, z);
        if (h < 0) continue;
        let ok = true;
        for (let d = 0; d < 5 && ok; d++) {
          if (surface(x + d, z) !== h) ok = false;
          for (let y = h + 1; y <= h + 9 && ok; y++) {
            if (g.world.getBlock(x + d, z, y) !== 0) ok = false;
          }
        }
        for (let d = -6; d < 0 && ok; d++) {
          for (const dz of [0, 1]) {
            for (let y = h + 1; y <= h + 9 && ok; y++) {
              if (g.world.getBlock(x + d, z + dz, y) !== 0) ok = false;
            }
          }
        }
        if (ok) spots.push({ x: x + 0.5, y: h + 1, z: z + 0.5 });
      }
    }
    if (spots.length === 0) throw new Error("no flat spot found");
    return spots;
  });
}
async function findUnevenWalkPaths(page: Page): Promise<GroundingPath[]> {
  const cityBounds = {
    worldX: WARSAW_CITY_WORLD_X,
    worldZ: WARSAW_CITY_WORLD_Z,
    width: WARSAW_CITY_WIDTH,
    depth: WARSAW_CITY_DEPTH,
  };
  return page.evaluate((city) => {
    const g = (window as unknown as G).__GIERA__;
    const isCityCell = (x: number, z: number): boolean =>
      x >= city.worldX && x < city.worldX + city.width &&
      z >= city.worldZ && z < city.worldZ + city.depth;
    const terrainHeights = new Map<string, number>();
    const surface = (x: number, z: number): number => {
      const key = `${x}:${z}`;
      const cached = terrainHeights.get(key);
      if (cached !== undefined) return cached;
      let height = -1;
      for (let y = 63; y > 0; y--) {
        if (g.world.getBlock(x, y, z) !== 0) {
          height = y;
          break;
        }
      }
      terrainHeights.set(key, height);
      return height;
    };
    const directions = [
      { dx: 1, dz: 0, yaw: -Math.PI / 2 },
      { dx: -1, dz: 0, yaw: Math.PI / 2 },
      { dx: 0, dz: 1, yaw: Math.PI },
      { dx: 0, dz: -1, yaw: 0 },
    ];
    const paths: GroundingPath[] = [];
    for (let x = -40; x <= 40; x++) {
      for (let z = -40; z <= 40; z++) {
        for (const direction of directions) {
          let crossesCity = false;
          for (let step = 0; step <= 4; step++) {
            if (isCityCell(x + direction.dx * step, z + direction.dz * step)) {
              crossesCity = true;
              break;
            }
          }
          if (crossesCity) continue;
          const heights = [0, 1, 2, 3, 4].map((step) =>
            surface(x + direction.dx * step, z + direction.dz * step)
          );
          if (heights.some((height) => height < 0) || heights[0]! <= heights[4]!) continue;
          if (heights.slice(1).some((height, index) => height > heights[index]! || heights[index]! - height > 1)) continue;
          let clear = true;
          for (let step = 0; step < 5 && clear; step++) {
            const cellX = x + direction.dx * step;
            const cellZ = z + direction.dz * step;
            for (const side of [0, 1]) {
              const openX = cellX + (direction.dx === 0 ? side : 0);
              const openZ = cellZ + (direction.dz === 0 ? side : 0);
              for (let y = heights[step]! + 1; y <= heights[step]! + 9; y++) {
                if (g.world.getBlock(openX, y, openZ) !== 0) clear = false;
              }
            }
          }
          if (clear) {
            paths.push({
              x: x + 0.5,
              y: heights[0]! + 1,
              z: z + 0.5,
              dx: direction.dx,
              dz: direction.dz,
              yaw: direction.yaw,
              endY: heights[4]! + 1,
            });
          }
        }
      }
    }
    if (paths.length < 2) throw new Error("no separated downhill paths found");
    return paths;
  }, cityBounds);
}


async function standAt(page: Page, spot: FlatSpot, yaw: number, pitch: number): Promise<void> {
  await page.evaluate(
    ([spot, yaw, pitch]) => {
      const g = (window as unknown as G).__GIERA__;
      g.player.position.set(spot.x, spot.y + 0.2, spot.z);
      g.player.velocity.set(0, 0, 0);
      g.player.yaw = yaw;
      g.player.pitch = pitch;
      g.player.syncAvatar();
    },
    [spot, yaw, pitch] as [FlatSpot, number, number]
  );
  await page.evaluate(() => {
    delete (window as unknown as { __camStill?: unknown }).__camStill;
  });
  await page.waitForFunction(() => {
    const g = (window as unknown as G).__GIERA__;
    const p = g.camera.position;
    const w = window as unknown as { __camStill?: { x: number; y: number; z: number; frame: number; frames: number } };
    const prev = w.__camStill;
    const same =
      prev !== undefined &&
      Math.abs(prev.x - p.x) < 1e-4 &&
      Math.abs(prev.y - p.y) < 1e-4 &&
      Math.abs(prev.z - p.z) < 1e-4;
    const frames = same ? prev.frames + Math.max(0, g.qa.frame - prev.frame) : 0;
    w.__camStill = { x: p.x, y: p.y, z: p.z, frame: g.qa.frame, frames };
    return g.player.onGround && frames >= 8;
  }, null, { timeout: 20_000 });
}

async function cameraRay(page: Page): Promise<CameraRay> {
  return page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    const cam = g.camera;
    const dir = cam.position.clone();
    cam.getWorldDirection(dir);
    const blocks: { x: number; y: number; z: number; id: number }[] = [];
    const cx = Math.floor(cam.position.x);
    const cy = Math.floor(cam.position.y);
    const cz = Math.floor(cam.position.z);
    for (let x = cx - 10; x <= cx + 10; x++)
      for (let y = cy - 10; y <= cy + 10; y++)
        for (let z = cz - 10; z <= cz + 10; z++) {
          const id = g.world.getBlock(x, y, z);
          if (id !== 0) blocks.push({ x, y, z, id });
        }
    return {
      origin: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      dir: { x: dir.x, y: dir.y, z: dir.z },
      blocks,
      player: { x: g.player.position.x, y: g.player.position.y, z: g.player.position.z },
    };
  });
}

function hitFrom(data: CameraRay): RayHit | null {
  const lookup = new Map(data.blocks.map((b) => [`${b.x},${b.y},${b.z}`, b.id]));
  const head = { x: data.player.x, y: data.player.y + 1.55, z: data.player.z };
  return raycastInteract(data.origin, data.dir, INTERACT_REACH, (x, y, z) => lookup.get(`${x},${y},${z}`) ?? 0, head);
}

function overlapsPlayer(player: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }): boolean {
  return (
    target.x + 1 > player.x - 0.3 &&
    target.x < player.x + 0.3 &&
    target.y + 1 > player.y &&
    target.y < player.y + 1.8 &&
    target.z + 1 > player.z - 0.3 &&
    target.z < player.z + 0.3
  );
}

async function armFrontBlock(page: Page, spots: FlatSpot[]): Promise<ArmedTarget> {
  for (const spot of spots) {
    await standAt(page, spot, -Math.PI / 2, 0);
    await waitOnGround(page);
    for (const camDist of [8, 9, 7, 6, 5.5]) {
      const fixture = await page.evaluate(([camDist]) => {
        const g = (window as unknown as G).__GIERA__;
        const cam = g.camera;
        const dir = cam.position.clone();
        cam.getWorldDirection(dir);
        const x = Math.floor(cam.position.x + dir.x * camDist);
        const y = Math.floor(cam.position.y + dir.y * camDist);
        const z = Math.floor(cam.position.z + dir.z * camDist);
        g.world.setBlock(x, y, z, 2);
        return { x, y, z };
      }, [camDist]);
      const data = await cameraRay(page);
      const hit = hitFrom(data);
      const placeTarget = hit
        ? { x: hit.hit.x + hit.normal.x, y: hit.hit.y + hit.normal.y, z: hit.hit.z + hit.normal.z }
        : null;
      const usable = hit !== null && hit.hit.x === fixture.x && hit.hit.y === fixture.y && hit.hit.z === fixture.z;
      if (!usable || !placeTarget || overlapsPlayer(data.player, placeTarget)) {
        await page.evaluate(([t]) => {
          (window as unknown as G).__GIERA__.world.setBlock(t.x, t.y, t.z, 0);
        }, [fixture]);
        continue;
      }
      return { fixture, hit, placeTarget };
    }
  }
  throw new Error("could not arm a reachable block");
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.describe("Giera mechanics (qa deterministic)", () => {
  test("heroes render rigged GLB character models with skinned meshes", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await boot(page);
    await page.waitForFunction(() => {
      const g = (window as unknown as { __GIERA__: any }).__GIERA__;
      const skinned = (avatar: any) => {
        let found = false;
        avatar?.object?.traverse((child: any) => {
          if (child.isSkinnedMesh === true) found = true;
        });
        return found;
      };
      return skinned(g.player.avatar) && skinned(g.player2.avatar);
    }, null, { timeout: 30_000 });
    const visuals = await page.evaluate(() => {
      const g = (window as unknown as { __GIERA__: any }).__GIERA__;
      const skinnedInfo = (avatar: any) => {
        let count = 0;
        let hasGeometry = false;
        let hasMaterial = false;
        avatar.object.traverse((node: any) => {
          if (node.isSkinnedMesh) {
            count++;
            if (node.geometry?.attributes?.position) hasGeometry = true;
            if (node.material) hasMaterial = true;
          }
        });
        return { count, hasGeometry, hasMaterial };
      };
      return {
        p1: skinnedInfo(g.player.avatar),
        p2: skinnedInfo(g.player2.avatar),
      };
    });
    expect(visuals.p1.count).toBeGreaterThan(0);
    expect(visuals.p1.hasGeometry).toBe(true);
    expect(visuals.p1.hasMaterial).toBe(true);
    expect(visuals.p2.count).toBeGreaterThan(0);
    expect(visuals.p2.hasGeometry).toBe(true);
    expect(visuals.p2.hasMaterial).toBe(true);
    expect(errors).toEqual([]);
  });
  test("hero GLBs match their target heights and align their feet", async ({ page }) => {
    test.setTimeout(60_000);
    await boot(page);
    await page.waitForFunction(() => {
      const g = (window as unknown as G).__GIERA__;
      return !!g.player.avatar && !!g.player2.avatar;
    }, null, { timeout: 30_000 });
    const bounds = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      const measure = (avatar: AvatarVisual) => {
        const root = avatar.object;
        root.updateMatrixWorld(true);
        let minY = Infinity;
        let maxY = -Infinity;
        root.traverse((node) => {
          const geometry = node.geometry;
          if (!geometry?.attributes?.position) return;
          if (!geometry.boundingBox) geometry.computeBoundingBox();
          const box = geometry.boundingBox;
          if (!box) return;
          for (const x of [box.min.x, box.max.x]) {
            for (const y of [box.min.y, box.max.y]) {
              for (const z of [box.min.z, box.max.z]) {
                const point = node.localToWorld(box.min.clone().set(x, y, z));
                minY = Math.min(minY, point.y);
                maxY = Math.max(maxY, point.y);
              }
            }
          }
        });
        return { height: maxY - minY, feetOffset: minY - root.position.y };
      };
      const p1 = g.player.avatar;
      const p2 = g.player2.avatar;
      if (!p1 || !p2) throw new Error("hero avatars did not load");
      return {
        p1: { profile: g.player.characterProfile, bounds: measure(p1) },
        p2: { profile: g.player2.characterProfile, bounds: measure(p2) },
      };
    });
    const targetHeights = { ziemek: 1.2, gniewko: 1.2 };
    expect(bounds.p1.bounds.height).toBeCloseTo(targetHeights[bounds.p1.profile], 2);
    expect(bounds.p2.bounds.height).toBeCloseTo(targetHeights[bounds.p2.profile], 2);
    for (const avatar of [bounds.p1.bounds, bounds.p2.bounds]) {
      expect(Math.abs(avatar.feetOffset)).toBeLessThan(0.1);
    }
  });
  test("grounded walking heroes stay above rendered terrain on a seeded run", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`/?qa=1&qaLivePlayerPose=1&seed=${SPEC.seed}`);
    await page.waitForFunction(() => {
      const g = (window as unknown as G).__GIERA__;
      return g?.ready && g.stats.chunkCount > 0 && g.player.avatar && g.player2.avatar;
    }, null, { timeout: 30_000 });
    await page.waitForFunction(() => ((window as unknown as G).__GIERA__?.qa?.frame ?? 0) > 60, null, { timeout: 20_000 });
    await page.locator(".hud-mode-btn").click();
    await expect(page.locator(".hud-mode-btn")).toHaveText(SPEC.splitLabelTwoPlayers);
    const paths = await findUnevenWalkPaths(page);
    let firstPath: GroundingPath | undefined;
    let secondPath: GroundingPath | undefined;
    let pairDistance = Number.POSITIVE_INFINITY;
    for (const first of paths) {
      for (const second of paths) {
        const distance = Math.hypot(first.x - second.x, first.z - second.z);
        if (distance > 5 && distance < pairDistance) {
          firstPath = first;
          secondPath = second;
          pairDistance = distance;
        }
      }
    }
    if (!firstPath || !secondPath) throw new Error("no separated downhill paths found");
    expect(firstPath.endY).toBeLessThan(firstPath.y);
    expect(secondPath.endY).toBeLessThan(secondPath.y);
    await page.evaluate(([first, second]) => {
      const g = (window as unknown as G).__GIERA__;
      const place = (
        player: { position: Vec3; velocity: Vec3; yaw: number; onGround: boolean; syncAvatar: () => void },
        spot: GroundingPath
      ): void => {
        player.position.set(spot.x, spot.y + 0.2, spot.z);
        player.velocity.set(0, 0, 0);
        player.yaw = spot.yaw;
        player.onGround = false;
        player.syncAvatar();
      };
      place(g.player, first);
      place(g.player2, second);
    }, [firstPath, secondPath] as [GroundingPath, GroundingPath]);
    await page.waitForFunction(() => {
      const g = (window as unknown as G).__GIERA__;
      return g.player.onGround && g.player2.onGround;
    }, null, { timeout: 10_000 });
    const clearancesPromise = page.evaluate(([firstPath, secondPath]) => new Promise<GroundingResult[]>((resolve) => {
      const paths = [firstPath, secondPath];
      const g = (window as unknown as G).__GIERA__;
      const players = [g.player, g.player2];
      const startX = players.map((player) => player.position.x);
      const startZ = players.map((player) => player.position.z);
      const minX = Math.min(...paths.map((path) => Math.min(path.x, path.x + path.dx * 4))) - 2;
      const maxX = Math.max(...paths.map((path) => Math.max(path.x, path.x + path.dx * 4))) + 2;
      const minZ = Math.min(...paths.map((path) => Math.min(path.z, path.z + path.dz * 4))) - 2;
      const maxZ = Math.max(...paths.map((path) => Math.max(path.z, path.z + path.dz * 4))) + 2;
      const terrainMeshes: TerrainMesh[] = [];
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((node: unknown) => {
        if (!node || typeof node !== "object") return;
        const candidate = node as Partial<TerrainMesh>;
        if (candidate.isMesh === true && candidate.geometry?.index && candidate.geometry.getAttribute("aTileId") &&
            candidate.position && candidate.localToWorld) terrainMeshes.push(candidate as TerrainMesh);
      });
      const triangles: TerrainTriangle[] = [];
      for (const node of terrainMeshes) {
        const geometry = node.geometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        if (!box || node.position.x + box.max.x < minX || node.position.x + box.min.x > maxX ||
            node.position.z + box.max.z < minZ || node.position.z + box.min.z > maxZ) continue;
        const positions = geometry.getAttribute("position");
        const normals = geometry.getAttribute("normal");
        const indices = geometry.index;
        if (!positions || !normals || !indices) continue;
        for (let i = 0; i < indices.count; i += 3) {
          const ia = indices.getX(i);
          const ib = indices.getX(i + 1);
          const ic = indices.getX(i + 2);
          if ((normals.getY(ia) + normals.getY(ib) + normals.getY(ic)) / 3 < 0.6) continue;
          const a = node.localToWorld(node.position.clone().set(positions.getX(ia), positions.getY(ia), positions.getZ(ia)));
          const b = node.localToWorld(node.position.clone().set(positions.getX(ib), positions.getY(ib), positions.getZ(ib)));
          const c = node.localToWorld(node.position.clone().set(positions.getX(ic), positions.getY(ic), positions.getZ(ic)));
          const triangleMinX = Math.min(a.x, b.x, c.x);
          const triangleMaxX = Math.max(a.x, b.x, c.x);
          const triangleMinZ = Math.min(a.z, b.z, c.z);
          const triangleMaxZ = Math.max(a.z, b.z, c.z);
          if (triangleMaxX < minX || triangleMinX > maxX || triangleMaxZ < minZ || triangleMinZ > maxZ) continue;
          triangles.push({
            a: { x: a.x, y: a.y, z: a.z },
            b: { x: b.x, y: b.y, z: b.z },
            c: { x: c.x, y: c.y, z: c.z },
            minX: triangleMinX,
            maxX: triangleMaxX,
            minZ: triangleMinZ,
            maxZ: triangleMaxZ,
          });
        }
      }
      const trianglesByCell = new Map<string, TerrainTriangle[]>();
      for (const triangle of triangles) {
        for (let cellX = Math.floor(triangle.minX); cellX <= Math.floor(triangle.maxX); cellX++) {
          for (let cellZ = Math.floor(triangle.minZ); cellZ <= Math.floor(triangle.maxZ); cellZ++) {
            const key = `${cellX}:${cellZ}`;
            const bucket = trianglesByCell.get(key);
            if (bucket) bucket.push(triangle);
            else trianglesByCell.set(key, [triangle]);
          }
        }
      }
      const surfaceAt = (x: number, z: number, reference: number): number => {
        let nearest = Number.NaN;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const triangle of trianglesByCell.get(`${Math.floor(x)}:${Math.floor(z)}`) ?? []) {
          const { a, b, c } = triangle;
          const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
          if (Math.abs(denominator) < 1e-10) continue;
          const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
          const wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator;
          const wc = 1 - wa - wb;
          if (wa < -1e-5 || wb < -1e-5 || wc < -1e-5) continue;
          const height = wa * a.y + wb * b.y + wc * c.y;
          const distance = Math.abs(height - reference);
          if (distance < nearestDistance) {
            nearest = height;
            nearestDistance = distance;
          }
        }
        return nearest;
      };
      const results = players.map((player, i) => ({
        profile: player.characterProfile,
        clip: player.avatar!.currentClipName,
        startX: startX[i]!,
        startZ: startZ[i]!,
        dx: paths[i]!.dx,
        dz: paths[i]!.dz,
        minimumRootClearance: Number.POSITIVE_INFINITY,
        maximumRootClearance: Number.NEGATIVE_INFINITY,
        maximumVisualOffset: Number.NEGATIVE_INFINITY,
        groundOffsetAtMinimum: Number.NaN,
        minimumClearance: Number.POSITIVE_INFINITY,
        minimumPoint: { x: 0, y: Number.POSITIVE_INFINITY, z: 0, groundY: Number.NaN },
        missingSurfaceSamples: 0,
        framesWithoutSurface: 0,
        groundedWalkingFrames: 0,
        nearGroundFrames: 0,
      }));
      let frames = 0;
      let lastFrame = g.qa.frame;
      const sample = (): void => {
        if (g.qa.frame > lastFrame) {
          lastFrame = g.qa.frame;
          frames++;
          for (let i = 0; i < players.length; i++) {
            const player = players[i];
            const avatar = player.avatar!;
            avatar.object.updateMatrixWorld(true);
            const rootY = avatar.object.position.y;
            if (player.onGround && avatar.currentMotion === "walk") {
              results[i]!.groundedWalkingFrames++;
              const userData = (avatar.object as unknown as {
                userData?: { groundOffset?: number; locomotionLift?: number };
              }).userData;
              const visualOffset = Number(userData?.groundOffset) + Number(userData?.locomotionLift);
              if (Number.isFinite(visualOffset)) {
                results[i]!.maximumVisualOffset = Math.max(results[i]!.maximumVisualOffset, visualOffset);
              }
              let frameSurfaceSamples = 0;
              let frameMinimumClearance = Number.POSITIVE_INFINITY;
              const rootGround = surfaceAt(player.position.x, player.position.z, player.position.y);
              if (Number.isFinite(rootGround)) {
                const rootClearance = rootY - rootGround;
                results[i]!.minimumRootClearance = Math.min(results[i]!.minimumRootClearance, rootClearance);
                results[i]!.maximumRootClearance = Math.max(results[i]!.maximumRootClearance, rootClearance);
              } else {
                results[i]!.missingSurfaceSamples++;
              }
              avatar.object.traverse((node) => {
                if (!node.isSkinnedMesh || !node.skeleton || !node.geometry?.attributes?.position ||
                    !node.position || !node.getVertexPosition) return;
                node.skeleton.update();
                const positions = node.geometry.attributes.position;
                const target = node.position.clone();
                for (let vertex = 0; vertex < positions.count; vertex++) {
                  const point = node.localToWorld(node.getVertexPosition(vertex, target));
                  if (point.y >= rootY + 0.3) continue;
                  const groundY = surfaceAt(point.x, point.z, point.y);
                  if (!Number.isFinite(groundY)) {
                    results[i]!.missingSurfaceSamples++;
                    continue;
                  }
                  frameSurfaceSamples++;
                  const clearance = point.y - groundY;
                  frameMinimumClearance = Math.min(frameMinimumClearance, clearance);
                  if (clearance < results[i]!.minimumClearance) {
                    results[i]!.minimumClearance = clearance;
                    results[i]!.minimumPoint = { x: point.x, y: point.y, z: point.z, groundY };
                    results[i]!.groundOffsetAtMinimum = visualOffset;
                  }
                }
              });
              if (frameSurfaceSamples > 0 && frameMinimumClearance <= 0.25) {
                results[i]!.nearGroundFrames++;
              }
              if (frameSurfaceSamples === 0) results[i]!.framesWithoutSurface++;
            }
          }
        }
        if (frames < 60) requestAnimationFrame(sample);
        else resolve(results.map((result, i) => ({
          ...result,
          endX: players[i]!.position.x,
          endZ: players[i]!.position.z,
        })));
      };
      requestAnimationFrame(sample);
    }), [firstPath, secondPath] as [GroundingPath, GroundingPath]);
    await page.keyboard.down("KeyW");
    await page.keyboard.down("ArrowUp");
    const clearances = await clearancesPromise;
    await page.keyboard.up("KeyW");
    await page.keyboard.up("ArrowUp");
    for (const avatar of clearances) {
      const progress = (avatar.endX - avatar.startX) * avatar.dx + (avatar.endZ - avatar.startZ) * avatar.dz;
      expect.soft(progress, JSON.stringify(avatar)).toBeGreaterThan(1.2);
      expect.soft(avatar.groundedWalkingFrames, JSON.stringify(avatar)).toBeGreaterThanOrEqual(30);
      expect.soft(avatar.minimumRootClearance, JSON.stringify(avatar)).toBeGreaterThanOrEqual(-0.005);
      expect.soft(avatar.maximumRootClearance, JSON.stringify(avatar)).toBeLessThanOrEqual(0.9);
      expect.soft(avatar.maximumVisualOffset, JSON.stringify(avatar)).toBeLessThanOrEqual(0.5);
      expect.soft(avatar.nearGroundFrames, JSON.stringify(avatar)).toBeGreaterThanOrEqual(5);
      expect.soft(avatar.missingSurfaceSamples, JSON.stringify(avatar)).toBe(0);
      expect.soft(avatar.framesWithoutSurface, JSON.stringify(avatar)).toBe(0);
      expect.soft(Number.isFinite(avatar.groundOffsetAtMinimum), JSON.stringify(avatar)).toBe(true);
      expect.soft(avatar.minimumClearance, JSON.stringify(avatar)).toBeGreaterThanOrEqual(-0.005);
    }
  });

  test("NPC GLBs align their feet and use safe idle clips", async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await page.evaluate(() => {
      (window as unknown as G).__GIERA__.qa.paused = true;
    });
    await page.waitForFunction(() => {
      const g = (window as unknown as G).__GIERA__;
      return g.npcManager.npcs.every((npc) => npc.avatar?.currentClipName);
    }, null, { timeout: 30_000 });
    const npcs = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      return g.npcManager.npcs.map((npc) => {
        const avatar = npc.avatar;
        if (!avatar?.currentClipName) throw new Error(`NPC avatar missing: ${npc.def.id}`);
        const root = avatar.object;
        root.updateMatrixWorld(true);
        let minY = Infinity;
        let maxY = -Infinity;
        root.traverse((node) => {
          const geometry = node.geometry;
          if (!geometry?.attributes?.position) return;
          if (!geometry.boundingBox) geometry.computeBoundingBox();
          const box = geometry.boundingBox;
          if (!box) return;
          for (const x of [box.min.x, box.max.x]) {
            for (const y of [box.min.y, box.max.y]) {
              for (const z of [box.min.z, box.max.z]) {
                const point = node.localToWorld(box.min.clone().set(x, y, z));
                minY = Math.min(minY, point.y);
                maxY = Math.max(maxY, point.y);
              }
            }
          }
        });
        const clips = [avatar.currentClipName];
        for (let i = 0; i < 8; i++) {
          avatar.setMotion("walk");
          avatar.setMotion("idle");
          clips.push(avatar.currentClipName ?? "");
        }
        return {
          id: npc.def.id,
          height: maxY - minY,
          feetOffset: minY - root.position.y,
          clips,
        };
      });
    });
    const expectedHeights: Record<string, number> = { tata: 1.8, mama: 1.6, ciocia: 1.6 };
    const safeClips: Record<string, string[]> = {
      tata: ["fidget_shift_weight", "walk_relaxed"],
      mama: ["dance_salsa", "walk_relaxed"],
      ciocia: ["dance_loop_quaternius", "walk_relaxed"],
    };
    for (const npc of npcs) {
      expect(npc.height).toBeCloseTo(expectedHeights[npc.id], 2);
      expect(Math.abs(npc.feetOffset)).toBeLessThan(0.1);
      expect(npc.clips.every((clip) => safeClips[npc.id].includes(clip.toLowerCase()))).toBe(true);
      expect(new Set(npc.clips).size).toBeGreaterThan(1);
    }
  });
  test("boot: qa fixed-delta loop advances sim and frame counters", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await boot(page);
    const qa1 = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      return { frame: g.qa.frame, simTime: g.qa.simTime };
    });
    await page.waitForTimeout(500);
    const qa2 = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      return { frame: g.qa.frame, simTime: g.qa.simTime };
    });
    expect(qa2.frame).toBeGreaterThan(qa1.frame);
    expect(qa2.simTime).toBeCloseTo(qa1.simTime + (qa2.frame - qa1.frame) * SPEC.qaFixedDelta, 1);
    expect(errors).toEqual([]);
  });

  test("movement: 46 sim frames of walking on flat ground covers spec distance band", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await boot(page);
    const spots = await findFlatSpots(page);
    await standAt(page, spots[0], -Math.PI / 2, 0);
    await waitOnGround(page);
    const before = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      return { x: g.player.position.x, z: g.player.position.z, frame: g.qa.frame };
    });
    await page.keyboard.down("KeyW");
    await page.waitForFunction(
      ([start, frames]) => (window as unknown as G).__GIERA__.qa.frame >= (start as number) + (frames as number),
      [before.frame, SPEC.walkFrames]
    );
    const speed = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      return Math.hypot(g.player.velocity.x, g.player.velocity.z);
    });
    await page.keyboard.up("KeyW");
    const after = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      return { x: g.player.position.x, z: g.player.position.z };
    });
    const dist = Math.hypot(after.x - before.x, after.z - before.z);
    expect(dist).toBeGreaterThanOrEqual(SPEC.walkDistanceBand[0]);
    expect(dist).toBeLessThanOrEqual(SPEC.walkDistanceBand[1]);
    expect(speed).toBeGreaterThan(SPEC.walkSpeedBlocksPerSec - 0.3);
    expect(speed).toBeLessThan(SPEC.walkSpeedBlocksPerSec + 0.3);
    expect(errors).toEqual([]);
  });

  test("jump: upward velocity exceeds spec minimum", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await boot(page);
    await waitOnGround(page);
    let maxVy = 0;
    await page.keyboard.down("Space");
    for (let i = 0; i < 8; i++) {
      maxVy = Math.max(maxVy, await page.evaluate(() => (window as unknown as G).__GIERA__.player.velocity.y));
      if (maxVy > SPEC.jumpVyMin) break;
      await page.waitForTimeout(50);
    }
    await page.keyboard.up("Space");
    expect(maxVy).toBeGreaterThan(SPEC.jumpVyMin);
    const jumpEvents = await page.evaluate(() =>
      (window as unknown as G).__GIERA__.qa.events.filter((e) => e.id === "jump").length
    );
    expect(jumpEvents).toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test("mine: aimed voxel removed, inventory gains the block, dig sound event fires", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await boot(page);
    const spots = await findFlatSpots(page);
    const armed = await armFrontBlock(page, spots);
    const invBefore = await invOf(page);
    const canvas = page.locator("canvas#game");
    await canvas.hover();
    await page.mouse.down();
    await page.waitForFunction(
      ([t]) => {
        const g = (window as unknown as G).__GIERA__;
        return g.world.getBlock(t.x, t.y, t.z) === 0;
      },
      [armed.fixture],
      { timeout: 30_000 }
    );
    const miningState = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      let dropWithAtlas = 0;
      let dropTotal = 0;
      g.scene.traverse((node: any) => {
        if (node.isMesh && node.geometry?.type === "BoxGeometry" && node.geometry.parameters?.width === 0.32) {
          dropTotal++;
          const src = node.material?.map?.image?.src ?? "";
          if (src.includes("atlas.webp")) dropWithAtlas++;
        }
      });
      return { isActing: g.player.isActing, motion: g.player.avatar?.requestedMotion ?? null, dropTotal, dropWithAtlas };
    });
    await page.mouse.up();
    const invAfter = await invOf(page);
    expect(invAfter.blocks.stone).toBe((invBefore.blocks.stone ?? 0) + 1);
    expect(miningState.isActing).toBe(true);
    expect(miningState.motion).toBe("mine");
    expect(miningState.dropTotal).toBeGreaterThan(0);
    expect(miningState.dropWithAtlas).toBe(miningState.dropTotal);
    const events = await page.evaluate(() => (window as unknown as G).__GIERA__.qa.events);
    expect(events.some((e) => e.id === "dig_stone")).toBe(true);
    expect(errors).toEqual([]);
  });

  test("place: block lands at hit+normal voxel, anti-bury guard rejects feet placement", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await boot(page);
    await page.evaluate(([cId]) => {
      const inv = (window as unknown as G).__GIERA__.inventory;
      inv.setHotbarSlot(0, cId);
    }, [COBBLESTONE_ID]);
    const spots = await findFlatSpots(page);
    const canvas = page.locator("canvas#game");
    let armed: ArmedTarget | null = null;
    const touched: { x: number; y: number; z: number }[] = [];
    for (let attempt = 0; attempt < 4 && !armed; attempt++) {
      const candidate = await armFrontBlock(page, spots);
      touched.push(candidate.fixture, candidate.placeTarget);
      await canvas.click({ button: "right" });
      const placedId = await page.evaluate(
        ([t]) => (window as unknown as G).__GIERA__.world.getBlock(t.x, t.y, t.z),
        [candidate.placeTarget]
      );
      if (placedId === COBBLESTONE_ID) armed = candidate;
    }
    expect(armed, "right-click must land a block at the armed hit+normal voxel").not.toBeNull();
    const landed = armed!;
    const placedId = await page.evaluate(
      ([t]) => (window as unknown as G).__GIERA__.world.getBlock(t.x, t.y, t.z),
      [landed.placeTarget]
    );
    expect(placedId).toBe(COBBLESTONE_ID);
    const stillStone = await page.evaluate(
      ([t]) => (window as unknown as G).__GIERA__.world.getBlock(t.x, t.y, t.z),
      [landed.fixture]
    );
    expect(stillStone).toBe(STONE_ID);

    await page.evaluate(
      ([touched, center, cobble]) => {
        const g = (window as unknown as G).__GIERA__;
        for (const t of touched) g.world.setBlock(t.x, t.y, t.z, 0);
        for (let x = center.x - 16; x <= center.x + 16; x++)
          for (let y = Math.max(1, center.y - 16); y <= center.y + 16; y++)
            for (let z = center.z - 16; z <= center.z + 16; z++)
              if (g.world.getBlock(x, y, z) === cobble) g.world.setBlock(x, y, z, 0);
      },
      [touched, landed.fixture, COBBLESTONE_ID] as [
        { x: number; y: number; z: number }[],
        { x: number; y: number; z: number },
        number
      ]
    );
    await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      g.player.yaw = -Math.PI / 2;
      g.player.pitch = 1.45;
      g.player.velocity.set(0, 0, 0);
      g.player.syncAvatar();
    });
    await page.waitForTimeout(300);
    let feetTarget: { x: number; y: number; z: number } | null = null;
    const attempts: unknown[] = [];
    outer: for (const spot of spots) {
      for (const offsetZ of [0.3, 0.45, 0.2]) {
        await page.evaluate(
          ([spot, offsetZ]) => {
            const g = (window as unknown as G).__GIERA__;
            g.player.position.set(spot.x, spot.y + 0.2, Math.floor(spot.z) + offsetZ);
            g.player.velocity.set(0, 0, 0);
            g.player.yaw = -Math.PI / 2;
            g.player.pitch = 1.45;
            g.player.syncAvatar();
          },
          [spot, offsetZ] as [FlatSpot, number]
        );
        await page.waitForTimeout(150);
        const data = await cameraRay(page);
        const hit = hitFrom(data);
        const target = hit
          ? { x: hit.hit.x + hit.normal.x, y: hit.hit.y + hit.normal.y, z: hit.hit.z + hit.normal.z }
          : null;
        attempts.push({ offsetZ, origin: data.origin, hit, target, player: data.player });
        if (!hit || !target) continue;
        if (!overlapsPlayer(data.player, target)) continue;
        feetTarget = target;
        break outer;
      }
    }
    expect(
      feetTarget,
      `anti-bury fixture must target the player's own body: ${JSON.stringify(attempts.slice(-3))}`
    ).not.toBeNull();
    const feetVoxel = feetTarget!;
    const beforeId = await page.evaluate(
      ([t]) => (window as unknown as G).__GIERA__.world.getBlock(t.x, t.y, t.z),
      [feetVoxel]
    );
    const placeEventsBefore = await page.evaluate(
      () => (window as unknown as G).__GIERA__.qa.events.filter((e) => e.id === "place_block").length
    );
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await page.waitForTimeout(300);
    const afterId = await page.evaluate(
      ([t]) => (window as unknown as G).__GIERA__.world.getBlock(t.x, t.y, t.z),
      [feetVoxel]
    );
    expect(afterId).toBe(beforeId);
    const placeEventsAfter = await page.evaluate(
      () => (window as unknown as G).__GIERA__.qa.events.filter((e) => e.id === "place_block").length
    );
    expect(placeEventsAfter).toBe(placeEventsBefore);
    expect(errors).toEqual([]);
  });

  test("hotbar: Digit3 activates slot 2", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await boot(page);
    await page.keyboard.press("Digit3");
    await expect(page.locator(".hud-hotbar-slot").nth(2)).toHaveClass(/active/);
    const slot = await page.evaluate(() => (window as unknown as G).__GIERA__.inventory.activeSlot);
    expect(slot).toBe(2);
    expect(errors).toEqual([]);
  });

  test("craft: modal opens, ten recipes, stick craft consumes inputs and yields output, Esc closes", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await boot(page);
    await addBlocks(page, "oak_log", 8);
    await page.keyboard.press("KeyI");
    await expect(page.locator(".hud-inventory-modal")).toHaveClass(/hud-modal-open/);
    const recipeButtons = page.locator(".hud-recipe-row .hud-craft-btn");
    await expect(recipeButtons).toHaveCount(10);
    await page.locator('.hud-craft-btn[data-id="stick"]').click();
    await page.waitForTimeout(200);
    const inv = await invOf(page);
    expect(inv.blocks.oak_log).toBe(5);
    expect(inv.items.stick).toBe(4);
    const events = await page.evaluate(() => (window as unknown as G).__GIERA__.qa.events);
    expect(events.some((e) => e.id === "craft_ok")).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator(".hud-inventory-modal")).not.toHaveClass(/hud-modal-open/);
    expect(errors).toEqual([]);
  });

  test("split: mode button enables split screen with exact label", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await boot(page);
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const frameBeforeSplit = await page.evaluate(() => (window as unknown as G).__GIERA__.qa.frame);
    await page.locator(".hud-mode-btn").click();
    await expect(page.locator(".hud-mode-btn")).toHaveText(SPEC.splitLabelTwoPlayers);
    const isSplit = await page.evaluate(() => (window as unknown as G).__GIERA__.splitScreen.isSplitScreen);
    expect(isSplit).toBe(true);
    await page.waitForFunction((frame) => (window as unknown as G).__GIERA__.qa.frame > frame + 1, frameBeforeSplit);
    expect(errors).toEqual([]);
  });


  test("tycoon: collector pays out, upgrade pad tiers up at spec cost, trampoline launches at spec velocity", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await boot(page);
    const cost = SPEC.upgradeCostPerTier;
    await page.waitForFunction(() => {
      let authored = false;
      let halo = false;
      (window as unknown as G).__GIERA__.scene.traverse((node) => {
        if (node.name === "factory-authored-art") authored = true;
        if (node.name === "tycoon-star-halo") halo = true;
      });
      return authored && halo;
    });

    await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      const pad = g.tycoon.collectorPadPos;
      g.player.position.set(pad.x, g.player.position.y, pad.z);
      g.player.velocity.set(0, 0, 0);
      g.player.syncAvatar();
    });
    await page.waitForFunction(() => {
      const g = (window as unknown as G).__GIERA__;
      return g.tycoon.collectedStars >= 1;
    }, { timeout: 10_000 });
    let events = await page.evaluate(() => (window as unknown as G).__GIERA__.qa.events);
    expect(events.some((e) => e.id === "celebrate_collect")).toBe(true);
    await expect
      .poll(
        async () => Number(await page.locator(".hud-tycoon-chip .hud-tycoon-stars").textContent()),
        { timeout: 5_000 }
      )
      .toBeGreaterThanOrEqual(1);

    const starsBeforeUpgrade = await page.evaluate(() => (window as unknown as G).__GIERA__.tycoon.collectedStars);
    await page.evaluate(([cost]) => {
      const g = (window as unknown as G).__GIERA__;
      g.tycoon.addStars((cost as number) * 2);
      const pad = g.tycoon.upgradePadPos;
      g.player.position.set(pad.x, g.player.position.y, pad.z);
      g.player.velocity.set(0, 0, 0);
      g.player.syncAvatar();
    }, [cost]);
    await page.waitForFunction(
      () => {
        const g = (window as unknown as G).__GIERA__;
        return g.tycoon.dropperTier === 2;
      },
      { timeout: 5_000 }
    );
    const tycoonState = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      return { stars: g.tycoon.collectedStars, tier: g.tycoon.dropperTier };
    });
    expect(tycoonState.stars).toBe(starsBeforeUpgrade + cost);
    expect(tycoonState.tier).toBe(2);
    await expect(page.locator(".hud-tycoon-chip .hud-tycoon-tier")).toHaveText("Poziom 2");
    events = await page.evaluate(() => (window as unknown as G).__GIERA__.qa.events);
    expect(events.some((e) => e.id === "celebrate_win")).toBe(true);

    await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      const pad = g.tycoon.trampolinePos;
      g.player.position.set(pad.x, g.player.position.y, pad.z);
      g.player.velocity.set(0, 0, 0);
      g.player.syncAvatar();
    });
    const maxVy = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const g = (window as unknown as G).__GIERA__;
          let max = 0;
          const start = performance.now();
          const tick = () => {
            max = Math.max(max, g.player.velocity.y);
            if (performance.now() - start < 600) requestAnimationFrame(tick);
            else resolve(max);
          };
          requestAnimationFrame(tick);
        })
    );
    expect(maxVy).toBeGreaterThanOrEqual(SPEC.trampolineVy - SPEC.trampolineVyTolerance);
    expect(maxVy).toBeLessThanOrEqual(SPEC.trampolineVy);
    expect(errors).toEqual([]);
  });

  test("tycoon: a walked-on expansion charges once and restores its HQ foundation without rewards", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await boot(page);
    const approach = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      const slot = g.tycoon.expansionSlots[0];
      g.tycoon.addStars(slot.cost);
      g.player.position.set(g.tycoon.origin.x + slot.x, g.tycoon.origin.y + 1.2, g.tycoon.origin.z + slot.z - 1.4);
      g.player.velocity.set(0, 0, 0);
      g.player.yaw = 0;
      g.player.syncAvatar();
      return { frame: g.qa.frame };
    });
    await page.keyboard.down("s");
    await page.waitForFunction(() => (window as unknown as G).__GIERA__.tycoon.toJSON().expansions?.includes(0), null, { timeout: 5_000 });
    await page.keyboard.up("s");
    await page.waitForFunction((frame) => (window as unknown as G).__GIERA__.qa.frame >= frame + 45, approach.frame);

    const purchased = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      let kiosks = 0;
      let kioskVisible = true;
      g.scene.traverse((node) => {
        if (node.name === "hq-kiosk-0") {
          kiosks++;
          kioskVisible = node.visible;
        }
      });
      const events = g.qa.events.filter((event) => event.id === "celebrate_win").length;
      const at = g.tycoon.origin;
      const floor = g.world.getBlock(at.x, at.y, at.z);
      g.player.position.set(at.x + 20, g.player.position.y, at.z + 20);
      g.qa.paused = true;
      return { state: g.tycoon.toJSON(), kiosks, kioskVisible, floor, events };
    });
    expect(purchased.state.collectedStars).toBe(0);
    expect(purchased.state.expansions).toEqual([0]);
    expect(purchased.kiosks).toBe(1);
    expect(purchased.kioskVisible).toBe(false);
    expect(purchased.floor).toBe(21);
    expect(purchased.events).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.waitForFunction(async () => {
      const request = indexedDB.open("giera_save_db", 1);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const get = db.transaction("saves", "readonly").objectStore("saves").get("last_save");
      const saved = await new Promise<any>((resolve, reject) => {
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      });
      return saved?.tycoon?.expansions?.includes(0) === true;
    }, null, { timeout: 5_000 });
    await page.reload();
    await page.waitForFunction(() => {
      const g = (window as unknown as G).__GIERA__;
      if (!g?.ready) return false;
      g.qa.paused = true;
      return g.world.getBlock(g.tycoon.origin.x, g.tycoon.origin.y, g.tycoon.origin.z) === 21;
    }, null, { timeout: 30_000 });
    const restored = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      return {
        state: g.tycoon.toJSON(),
        rewards: g.qa.events.filter((event) => event.id === "celebrate_win" || event.id === "celebrate_collect").length,
      };
    });
    expect(restored.state).toEqual(purchased.state);
    expect(restored.rewards).toBe(0);
    expect(errors).toEqual([]);
  });

  test("collision: first player cannot overlap an NPC", async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    const before = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      const npc = g.npcManager.npcs[0].position;
      return { x: g.player.position.x, z: g.player.position.z, npcX: npc.x, npcZ: npc.z, frame: g.qa.frame };
    });

    await page.keyboard.down("a");
    await page.keyboard.down("s");
    const minimumDistance = await page.evaluate(({ frame }) => new Promise<number>((resolve) => {
      const g = (window as unknown as G).__GIERA__;
      const npc = g.npcManager.npcs[0].position;
      let minimum = Infinity;
      const sample = (): void => {
        minimum = Math.min(minimum, Math.hypot(g.player.position.x - npc.x, g.player.position.z - npc.z));
        if (g.qa.frame < frame + 45) requestAnimationFrame(sample);
        else resolve(minimum);
      };
      sample();
    }), { frame: before.frame });
    await page.keyboard.up("a");
    await page.keyboard.up("s");

    const beforeDistance = Math.hypot(before.x - before.npcX, before.z - before.npcZ);
    expect(minimumDistance).toBeGreaterThanOrEqual(0.65);
    expect(minimumDistance).toBeLessThan(beforeDistance - 0.2);
    expect(errors).toEqual([]);
  });

  test("collision: second player cannot overlap an NPC", async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await page.locator(".hud-mode-btn").click();
    await page.waitForFunction(() => (window as unknown as G).__GIERA__.splitScreen.isSplitScreen);
    const before = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      const npc = g.npcManager.npcs[0].position;
      return { x: g.player2.position.x, z: g.player2.position.z, npcX: npc.x, npcZ: npc.z, frame: g.qa.frame };
    });

    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("ArrowDown");
    const minimumDistance = await page.evaluate(({ frame }) => new Promise<number>((resolve) => {
      const g = (window as unknown as G).__GIERA__;
      const npc = g.npcManager.npcs[0].position;
      let minimum = Infinity;
      const sample = (): void => {
        minimum = Math.min(minimum, Math.hypot(g.player2.position.x - npc.x, g.player2.position.z - npc.z));
        if (g.qa.frame < frame + 30) requestAnimationFrame(sample);
        else resolve(minimum);
      };
      sample();
    }), { frame: before.frame });
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("ArrowDown");

    const beforeDistance = Math.hypot(before.x - before.npcX, before.z - before.npcZ);
    expect(minimumDistance).toBeGreaterThanOrEqual(0.65);
    expect(minimumDistance).toBeLessThan(beforeDistance - 0.2);
    expect(errors).toEqual([]);
  });

  test("collision: player cannot walk through the tycoon machine", async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await page.waitForFunction(() => {
      const g = (window as unknown as G).__GIERA__;
      let loaded = false;
      g.scene.traverse((node) => {
        if (node.name === "tycoon-plot" && node.children.length > 10) loaded = true;
      });
      return loaded;
    }, null, { timeout: 15_000 });

    const start = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      return {
        x: g.player.position.x,
        z: g.player.position.z,
        frame: g.qa.frame,
        targetX: g.tycoon.origin.x - 3.2,
        targetZ: g.tycoon.origin.z - 4.6,
      };
    });

    await page.keyboard.down("a");
    await page.waitForFunction((frame) => (window as unknown as G).__GIERA__.qa.frame >= frame + 82, start.frame);
    await page.keyboard.up("a");
    const approach = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      return { x: g.player.position.x, frame: g.qa.frame };
    });
    expect(approach.x).toBeGreaterThan(start.targetX - 0.5);
    expect(approach.x).toBeLessThan(start.targetX + 0.5);

    await page.keyboard.down("w");
    await page.waitForFunction((frame) => (window as unknown as G).__GIERA__.qa.frame >= frame + 45, approach.frame);
    await page.keyboard.up("w");
    const after = await page.evaluate(() => (window as unknown as G).__GIERA__.player.position.z);

    expect(after).toBeLessThan(start.targetZ - 0.2);
    expect(errors).toEqual([]);
  });

  test("collision: a constructed HQ wall is solid but its kiosk and label are not", async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page);
    await page.waitForFunction(() => {
      const g = (window as unknown as G).__GIERA__;
      let loaded = false;
      g.scene.traverse((node) => {
        if (node.name === "tycoon-plot" && node.children.length > 10) loaded = true;
      });
      return loaded;
    }, null, { timeout: 15_000 });
    const initialBodies = await page.evaluate(() => (window as unknown as G).__GIERA__.tycoon.getCollisionBodies().length);
    const bought = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      const slot = g.tycoon.expansionSlots.find((entry) => entry.index === 2)!;
      g.tycoon.addStars(slot.cost);
      return g.tycoon.buyExpansion(2);
    });
    expect(bought).toBe(true);
    await page.waitForFunction(() => {
      const g = (window as unknown as G).__GIERA__;
      const at = g.tycoon.origin;
      return g.world.getBlock(at.x + 2, at.y + 5, at.z) !== 0 &&
        g.world.getBlock(at.x, at.y + 8, at.z) === 19;
    }, null, { timeout: 15_000 });
    const setup = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      const at = g.tycoon.origin;
      g.player.position.set(at.x + 2, at.y + 5.05, at.z + 2.5);
      g.player.velocity.set(0, 0, 0);
      g.player.yaw = 0;
      g.player.syncAvatar();
      return {
        bodyCount: g.tycoon.getCollisionBodies().length,
        frame: g.qa.frame,
        startZ: g.player.position.z,
        wallZ: at.z,
      };
    });
    expect(setup.bodyCount).toBe(initialBodies);
    await page.waitForFunction(() => (window as unknown as G).__GIERA__.player.onGround, null, { timeout: 5_000 });

    await page.keyboard.down("w");
    await page.waitForFunction((frame) => (window as unknown as G).__GIERA__.qa.frame >= frame + 60, setup.frame);
    await page.keyboard.up("w");
    const after = await page.evaluate(() => (window as unknown as G).__GIERA__.player.position.z);
    expect(after).toBeGreaterThanOrEqual(setup.wallZ + 1.25);
    expect(after).toBeLessThan(setup.startZ);
    expect(errors).toEqual([]);
  });

  test("dummy: holding mine near training dummy fires repeated dig_wood events", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await boot(page);
    const spot = await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      const dummy = { x: 1.5, z: 3 };
      const ground = (x: number, z: number): number => {
        for (let y = 63; y > 0; y--) {
          const id = g.world.getBlock(x, y, z);
          if (id !== 0 && id !== 8) return y;
        }
        return -1;
      };
      for (let dx = -2; dx <= 3; dx++) {
        for (let dz = -2; dz <= 3; dz++) {
          const x = Math.floor(dummy.x) + dx;
          const z = Math.floor(dummy.z) + dz;
          const h = ground(x, z);
          if (h < 0) continue;
          let blocked = false;
          for (let y = h + 1; y <= h + 2 && !blocked; y++) {
            if (g.world.getBlock(x, y, z) !== 0) blocked = true;
          }
          if (blocked) continue;
          if (Math.hypot(x + 0.5 - dummy.x, z + 0.5 - dummy.z) > 3.0) continue;
          return { x: x + 0.5, y: h + 1, z: z + 0.5 };
        }
      }
      throw new Error("no clear ground near dummy");
    });
    await page.evaluate(([spot]) => {
      const g = (window as unknown as G).__GIERA__;
      const dummy = { x: 1.5, z: 3 };
      const dx = dummy.x - spot.x;
      const dz = dummy.z - spot.z;
      g.player.position.set(spot.x, spot.y + 0.2, spot.z);
      g.player.velocity.set(0, 0, 0);
      g.player.yaw = Math.atan2(-dx, -dz);
      g.player.pitch = -0.1;
      g.player.syncAvatar();
    }, [spot]);
    await page.waitForTimeout(400);
    const canvas = page.locator("canvas#game");
    await canvas.hover();
    await page.mouse.down();
    await page.waitForTimeout(1500);
    await page.mouse.up();
    const digWood = await page.evaluate(
      () => (window as unknown as G).__GIERA__.qa.events.filter((e) => e.id === "dig_wood").length
    );
    expect(digWood).toBeGreaterThanOrEqual(10);
    expect(errors).toEqual([]);
  });

  test("npc: proximity prompt, dialog opens with KeyE, quick prompts echo into reply bubble", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await boot(page);
    await page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      const tata = g.npcManager.npcs.find((n) => n.name === "Tata")!;
      g.player.position.set(tata.position.x, tata.position.y + 0.5, tata.position.z + 0.8);
      g.player.velocity.set(0, 0, 0);
      g.player.syncAvatar();
    });
    const prompt = page.locator(".hud-npc-prompt");
    await expect(prompt).toBeVisible();
    expect((await prompt.textContent())?.startsWith(SPEC.npcPromptPrefix)).toBe(true);
    await page.keyboard.press("KeyE");
    await expect(page.locator(".hud-npc-card")).toBeVisible();
    const quickBtns = page.locator(".hud-quick-btn");
    await expect(quickBtns).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      const text = (await quickBtns.nth(i).textContent()) ?? "";
      await quickBtns.nth(i).click();
      await expect(page.locator("#npc-reply-bubble")).toContainText(text, { timeout: 5_000 });
    }
    await page.keyboard.press("Escape");
    await expect(page.locator(".hud-npc-card")).not.toBeVisible();
    expect(errors).toEqual([]);
  });
  test("npc: releases pointer lock so conversation controls can be clicked", async ({ page }) => {
    test.setTimeout(60_000);
    await boot(page);
    await page.evaluate(() => {
      const game = window.__GIERA__;
      if (!game) throw new Error("Giera did not boot");
      const tata = game.npcManager.npcs.find((n) => n.def.name === "Tata");
      if (!tata) throw new Error("Tata is unavailable");
      game.player.position.set(tata.position.x, tata.position.y + 0.5, tata.position.z + 0.8);
      game.player.velocity.set(0, 0, 0);
      game.player.syncAvatar();
    });

    await page.evaluate(() => {
      const canvas = document.querySelector("#game");
      let locked: Element | null = canvas;
      Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => locked });
      document.exitPointerLock = () => { locked = null; };
    });
    await page.keyboard.press("KeyE");
    await expect(page.locator(".hud-npc-card")).toBeVisible();
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
    await page.locator(".hud-quick-btn").first().click();
    await expect(page.locator("#npc-reply-bubble")).not.toHaveText("Mina myśli...", { timeout: 5_000 });
  });
  test("npc: starts microphone from KeyE and stops when the dialog closes", async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: async () => destination.stream },
      });
    });
    await boot(page);
    await page.evaluate(() => {
      const game = window.__GIERA__;
      if (!game) throw new Error("Giera did not boot");
      const tata = game.npcManager.npcs.find((n) => n.def.name === "Tata");
      if (!tata) throw new Error("Tata is unavailable");
      game.player.position.set(tata.position.x, tata.position.y + 0.5, tata.position.z + 0.8);
      game.player.velocity.set(0, 0, 0);
      game.player.syncAvatar();
    });

    await page.keyboard.press("KeyE");
    await expect(page.locator(".hud-npc-card")).toBeVisible();
    await expect(page.locator("#npc-mic-status")).toHaveText(/Słucham/);
    expect(await page.evaluate(() => window.__GIERA__?.mic.isRecording)).toBe(true);

    await page.locator(".hud-npc-card .hud-modal-close").click();
    await expect(page.locator(".hud-npc-card")).not.toBeVisible();
    expect(await page.evaluate(() => window.__GIERA__?.mic.isRecording)).toBe(false);
  });


  test("persistence: active slot and crafted item survive reload as real deltas", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    await boot(page);
    await page.keyboard.press("Digit5");
    await addBlocks(page, "oak_log", 4);
    await page.keyboard.press("KeyI");
    await page.locator('.hud-craft-btn[data-id="planks"]').click();
    await page.waitForTimeout(200);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.reload();
    await page.waitForFunction(() => (window as unknown as G).__GIERA__?.ready === true, null, { timeout: 30_000 });
    const inv = await invOf(page);
    expect(inv.activeSlot).toBe(4);
    expect(inv.blocks.planks).toBe(4);
    expect(errors).toEqual([]);
  });

  test("tnt: crafts via UI, places and ignites with real input, crater persists after reload", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await boot(page);
    await addBlocks(page, "planks", 4);
    await addBlocks(page, "coal_ore", 1);
    await page.keyboard.press("KeyI");
    await expect(page.locator(".hud-inventory-modal")).toHaveClass(/hud-modal-open/);
    await page.locator('.hud-craft-btn[data-id="tnt"]').click();
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    await expect(page.locator(".hud-inventory-modal")).not.toHaveClass(/hud-modal-open/);
    const inv = await invOf(page);
    expect(inv.blocks.tnt).toBe(3);
    const tntSlot = inv.hotbar.indexOf(20);
    expect(tntSlot).toBeGreaterThanOrEqual(0);
    await page.keyboard.press(`Digit${tntSlot + 1}`);

    const spots = await findFlatSpots(page);
    const armed = await armFrontBlock(page, spots);
    const tntAt = armed.placeTarget;
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await page.waitForFunction(
      ([t]) => (window as unknown as G).__GIERA__.world.getBlock(t.x, t.y, t.z) === 20,
      [tntAt],
      { timeout: 10_000 }
    );
    const invAfterPlace = await invOf(page);
    expect(invAfterPlace.blocks.tnt).toBe(3);

    const igniteFrame = await page.evaluate(() => (window as unknown as G).__GIERA__.qa.frame);
    await page.mouse.down({ button: "left" });
    await page.waitForFunction((f) => (window as unknown as G).__GIERA__.qa.frame >= f + 10, igniteFrame);
    await page.mouse.up({ button: "left" });
    await page.waitForFunction(
      ([t]) => (window as unknown as G).__GIERA__.world.getBlock(t.x, t.y, t.z) === 0,
      [tntAt],
      { timeout: 20_000 }
    );
    const crater = await page.evaluate(
      ([t, fixture]) => {
        const g = (window as unknown as G).__GIERA__;
        let removed = 0;
        const center = { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 };
        for (let x = t.x - 4; x <= t.x + 4; x++)
          for (let y = t.y - 4; y <= t.y + 4; y++)
            for (let z = t.z - 4; z <= t.z + 4; z++) {
              if (Math.hypot(x + 0.5 - center.x, y + 0.5 - center.y, z + 0.5 - center.z) > 3.2) continue;
              if (g.world.getBlock(x, y, z) === 0) removed++;
            }
        return { removed, fixtureId: g.world.getBlock(fixture.x, fixture.y, fixture.z) };
      },
      [tntAt, armed.fixture]
    );
    expect(crater.removed).toBeGreaterThan(1);
    expect(crater.fixtureId).toBe(0);

    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.reload();
    await page.waitForFunction(() => (window as unknown as G).__GIERA__?.ready === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => ((window as unknown as G).__GIERA__?.qa?.frame ?? 0) > 60, null, { timeout: 20_000 });
    const afterReload = await page.evaluate(
      ([t, fixture]) => ({
        tnt: (window as unknown as G).__GIERA__.world.getBlock(t.x, t.y, t.z),
        fixture: (window as unknown as G).__GIERA__.world.getBlock(fixture.x, fixture.y, fixture.z),
      }),
      [tntAt, armed.fixture]
    );
    expect(afterReload.tnt).toBe(0);
    expect(afterReload.fixture).toBe(0);
    expect(errors).toEqual([]);
  });
});
