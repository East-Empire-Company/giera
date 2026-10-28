import { test, expect, type Page } from "@playwright/test";
import { SPEC } from "../spec-constants";
import { raycastInteract, type RayHit } from "../../src/shared/raycast";

type Vec3 = { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };

type FlatSpot = { x: number; y: number; z: number };
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
  scene: { traverse: (fn: (node: any) => void) => void };
  player: {
    position: Vec3;
    velocity: Vec3;
    yaw: number;
    pitch: number;
    onGround: boolean;
    isActing: boolean;
    syncAvatar: () => void;
    avatar?: { currentMotion?: string; requestedMotion?: string };
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
  };
  npcManager: { npcs: { position: { x: number; y: number; z: number }; name: string }[] };
  splitScreen: { isSplitScreen: boolean };
  tycoon: {
    collectedStars: number;
    dropperTier: number;
    vaultCoins: number;
    addStars: (n: number) => void;
    collectorPadPos: { x: number; z: number };
    upgradePadPos: { x: number; z: number };
    trampolinePos: { x: number; z: number };
  };
  qa: { simTime: number; frame: number; events: { ev: string; id?: string; t: number }[] };
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
  blocks: Record<string, number>;
  items: Record<string, number>;
};

async function invOf(page: Page): Promise<InventorySnapshot> {
  return page.evaluate(() => (window as unknown as G).__GIERA__.inventory.toJSON());
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
  test("heroes render rigged KayKit models tinted with concept clothing colors", async ({ page }) => {
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
      const partColors = (avatar: any, pattern: RegExp) => {
        const colors: number[][] = [];
        avatar.object.traverse((node: any) => {
          if (node.isSkinnedMesh && pattern.test(node.name)) {
            colors.push([
              node.material.color.r,
              node.material.color.g,
              node.material.color.b,
            ]);
          }
        });
        return colors;
      };
      return {
        p1Body: partColors(g.player.avatar, /Body/i),
        p1Legs: partColors(g.player.avatar, /Leg/i),
        p2Body: partColors(g.player2.avatar, /Body/i),
        p2Legs: partColors(g.player2.avatar, /Leg/i),
      };
    });
    expect(visuals.p1Body.length).toBeGreaterThan(0);
    expect(visuals.p1Legs.length).toBeGreaterThan(0);
    expect(visuals.p2Body.length).toBeGreaterThan(0);
    expect(visuals.p2Legs.length).toBeGreaterThan(0);
    for (const [r, g, b] of visuals.p1Body) {
      expect(g).toBeGreaterThan(r + 0.15);
      expect(b).toBeGreaterThan(r);
    }
    for (const [r, g, b] of visuals.p1Legs) {
      expect(Math.max(r, g, b)).toBeLessThan(0.4);
    }
    for (const [r, g, b] of visuals.p2Body) {
      expect(Math.min(r, g, b)).toBeGreaterThan(0.85);
    }
    for (const [r, , b] of visuals.p2Legs) {
      expect(b).toBeGreaterThan(r);
    }
    expect(errors).toEqual([]);
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
          if (src.includes("atlas.png")) dropWithAtlas++;
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

  test("craft: modal opens, five recipes, stick craft consumes inputs and yields output, Esc closes", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await boot(page);
    await addBlocks(page, "oak_log", 8);
    await page.keyboard.press("KeyI");
    await expect(page.locator(".hud-inventory-modal")).toHaveClass(/hud-modal-open/);
    const recipeButtons = page.locator(".hud-recipe-row .hud-craft-btn");
    await expect(recipeButtons).toHaveCount(5);
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
    await page.locator(".hud-mode-btn").click();
    await expect(page.locator(".hud-mode-btn")).toHaveText(SPEC.splitLabelTwoPlayers);
    const isSplit = await page.evaluate(() => (window as unknown as G).__GIERA__.splitScreen.isSplitScreen);
    expect(isSplit).toBe(true);
    expect(errors).toEqual([]);
  });

  test("music: five clicks cycle exact label list and emit playMusic events", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await boot(page);
    const musicBtn = page.locator(".hud-music-btn");
    const labels: string[] = [];
    for (let i = 0; i < 5; i++) {
      await musicBtn.click();
      labels.push((await musicBtn.textContent())?.replace("🎵 ", "") ?? "");
    }
    expect(labels).toEqual([...SPEC.musicLabels.slice(1), SPEC.musicLabels[0]]);
    const musicEvents = await page.evaluate(() =>
      (window as unknown as G).__GIERA__.qa.events.filter((e) => e.ev === "playMusic").map((e) => e.id)
    );
    expect(musicEvents).toEqual(SPEC.musicIdsAfterFirstClick);
    expect(errors).toEqual([]);
  });

  test("tycoon: collector pays out, upgrade pad tiers up at spec cost, trampoline launches at spec velocity", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await boot(page);
    const cost = SPEC.upgradeCostPerTier;

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
      const mina = g.npcManager.npcs.find((n) => n.name === "Mina")!;
      g.player.position.set(mina.position.x, mina.position.y + 0.5, mina.position.z + 0.8);
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
});
