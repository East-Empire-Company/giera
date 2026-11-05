import { test, expect, type Page } from "@playwright/test";
import { SPEC } from "../spec-constants";
import { raycastInteract, type RayHit } from "../../src/shared/raycast";

type Vec3 = { x: number; y: number; z: number; set: (x: number, y: number, z: number) => Vec3; clone: () => Vec3 };
type FlatSpot = { x: number; y: number; z: number };
type CameraRay = {
  origin: FlatSpot;
  dir: FlatSpot;
  blocks: Array<FlatSpot & { id: number }>;
  player: FlatSpot;
};
type TycoonSave = { vaultCoins: number; collectedStars: number; dropperTier: number; expansions?: number[] };
type Giera = {
  ready: boolean;
  camera: { position: Vec3; getWorldDirection: (target: Vec3) => Vec3 };
  player: { position: Vec3; velocity: Vec3; yaw: number; pitch: number; onGround: boolean; syncAvatar: () => void };
  world: { getBlock: (x: number, y: number, z: number) => number; setBlock: (x: number, y: number, z: number, id: number) => void };
  inventory: {
    equippedTool: string | null;
    toJSON: () => { blocks: Record<string, number>; items: Record<string, number>; hotbar: number[] };
    getMiningSpeedMultiplier: (blockId: number) => number;
    getCombatMultiplier: () => number;
  };
  tycoon: {
    origin: { x: number; y: number; z: number };
    expansionSlots: readonly { index: number; x: number; z: number; cost: number }[];
    addStars: (count: number) => void;
    toJSON: () => TycoonSave;
  };
  qa: { frame: number; paused: boolean };
};
type G = { __GIERA__: Giera };

async function boot(page: Page): Promise<void> {
  await page.goto(`/?seed=${SPEC.seed}&qa=1`);
  await page.waitForFunction(() => (window as unknown as G).__GIERA__?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => (window as unknown as G).__GIERA__.qa.frame > 60, null, { timeout: 20_000 });
}

async function standAtLocal(page: Page, x: number, z: number): Promise<void> {
  await page.evaluate(([localX, localZ]) => {
    const g = (window as unknown as G).__GIERA__;
    const at = g.tycoon.origin;
    g.player.position.set(at.x + (localX as number), at.y + 1.2, at.z + (localZ as number));
    g.player.velocity.set(0, 0, 0);
    g.player.yaw = 0;
    g.player.syncAvatar();
  }, [x, z]);
  await page.waitForFunction(() => (window as unknown as G).__GIERA__.player.onGround, null, { timeout: 10_000 });
}

async function buyStage(page: Page, index: number): Promise<void> {
  await page.evaluate((stage) => {
    const g = (window as unknown as G).__GIERA__;
    const slot = g.tycoon.expansionSlots.find((entry) => entry.index === stage);
    if (!slot) throw new Error(`Missing HQ kiosk ${stage}`);
    const at = g.tycoon.origin;
    g.player.position.set(at.x + slot.x, at.y + 1.2, at.z + slot.z - 1.4);
    g.player.velocity.set(0, 0, 0);
    g.player.yaw = 0;
    g.player.syncAvatar();
  }, index);
  await page.keyboard.down("s");
  try {
    await page.waitForFunction(
      (stage) => (window as unknown as G).__GIERA__.tycoon.toJSON().expansions?.includes(stage as number),
      index,
      { timeout: 8_000 },
    );
  } finally {
    await page.keyboard.up("s");
  }
}

async function waitForBlock(page: Page, x: number, y: number, z: number, id: number): Promise<void> {
  await page.waitForFunction(
    ([localX, localY, localZ, expected]) => {
      const g = (window as unknown as G).__GIERA__;
      const at = g.tycoon.origin;
      return g.world.getBlock(at.x + (localX as number), at.y + (localY as number), at.z + (localZ as number)) === expected;
    },
    [x, y, z, id],
    { timeout: 20_000 },
  );
}

async function findFlatSpots(page: Page): Promise<FlatSpot[]> {
  return page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    const surface = (x: number, z: number): number => {
      for (let y = 63; y > 0; y--) if (g.world.getBlock(x, y, z) !== 0) return y;
      return -1;
    };
    const spots: FlatSpot[] = [];
    for (let x = -8; x <= 10 && spots.length < 8; x++) {
      for (let z = -8; z <= 10 && spots.length < 8; z++) {
        const height = surface(x, z);
        if (height < 0) continue;
        let clear = true;
        for (let dx = -6; dx < 5 && clear; dx++) {
          if (surface(x + dx, z) !== height) clear = false;
          for (let y = height + 1; y <= height + 9 && clear; y++) {
            if (g.world.getBlock(x + dx, y, z) !== 0) clear = false;
          }
        }
        if (clear) spots.push({ x: x + 0.5, y: height + 1, z: z + 0.5 });
      }
    }
    if (spots.length === 0) throw new Error("No flat placement site found");
    return spots;
  });
}

async function standAt(page: Page, spot: FlatSpot): Promise<void> {
  await page.evaluate((at) => {
    const g = (window as unknown as G).__GIERA__;
    g.player.position.set(at.x, at.y + 0.2, at.z);
    g.player.velocity.set(0, 0, 0);
    g.player.yaw = -Math.PI / 2;
    g.player.pitch = 0;
    g.player.syncAvatar();
    delete (window as unknown as { __camStill?: unknown }).__camStill;
  }, spot);
  await page.waitForFunction(() => {
    const g = (window as unknown as G).__GIERA__;
    const p = g.camera.position;
    const w = window as unknown as { __camStill?: { x: number; y: number; z: number; frame: number; frames: number } };
    const previous = w.__camStill;
    const same = previous !== undefined && Math.abs(previous.x - p.x) < 1e-4 && Math.abs(previous.y - p.y) < 1e-4 && Math.abs(previous.z - p.z) < 1e-4;
    const frames = same ? previous.frames + Math.max(0, g.qa.frame - previous.frame) : 0;
    w.__camStill = { x: p.x, y: p.y, z: p.z, frame: g.qa.frame, frames };
    return g.player.onGround && frames >= 8;
  }, null, { timeout: 20_000 });
}

async function cameraRay(page: Page): Promise<CameraRay> {
  return page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    const direction = g.camera.position.clone();
    g.camera.getWorldDirection(direction);
    const blocks: CameraRay["blocks"] = [];
    const cx = Math.floor(g.camera.position.x);
    const cy = Math.floor(g.camera.position.y);
    const cz = Math.floor(g.camera.position.z);
    for (let x = cx - 10; x <= cx + 10; x++) {
      for (let y = cy - 10; y <= cy + 10; y++) {
        for (let z = cz - 10; z <= cz + 10; z++) {
          const id = g.world.getBlock(x, y, z);
          if (id !== 0) blocks.push({ x, y, z, id });
        }
      }
    }
    return {
      origin: { ...g.camera.position },
      dir: { ...direction },
      blocks,
      player: { ...g.player.position },
    };
  });
}

function hitFrom(data: CameraRay): RayHit | null {
  const lookup = new Map(data.blocks.map((block) => [`${block.x},${block.y},${block.z}`, block.id]));
  const head = { x: data.player.x, y: data.player.y + 1.55, z: data.player.z };
  return raycastInteract(data.origin, data.dir, 12, (x, y, z) => lookup.get(`${x},${y},${z}`) ?? 0, head);
}

async function armFrontBlock(page: Page, spots: FlatSpot[]): Promise<{ fixture: FlatSpot; placeTarget: FlatSpot }> {
  for (const spot of spots) {
    await standAt(page, spot);
    for (const cameraDistance of [8, 9, 7, 6, 5.5]) {
      const fixture = await page.evaluate((distance) => {
        const g = (window as unknown as G).__GIERA__;
        const direction = g.camera.position.clone();
        g.camera.getWorldDirection(direction);
        const x = Math.floor(g.camera.position.x + direction.x * (distance as number));
        const y = Math.floor(g.camera.position.y + direction.y * (distance as number));
        const z = Math.floor(g.camera.position.z + direction.z * (distance as number));
        g.world.setBlock(x, y, z, 2);
        return { x, y, z };
      }, cameraDistance);
      const data = await cameraRay(page);
      const hit = hitFrom(data);
      const placeTarget = hit ? { x: hit.hit.x + hit.normal.x, y: hit.hit.y + hit.normal.y, z: hit.hit.z + hit.normal.z } : null;
      const usable = hit !== null && hit.hit.x === fixture.x && hit.hit.y === fixture.y && hit.hit.z === fixture.z;
      const overlaps = placeTarget !== null && placeTarget.x + 1 > data.player.x - 0.3 && placeTarget.x < data.player.x + 0.3 &&
        placeTarget.y + 1 > data.player.y && placeTarget.y < data.player.y + 1.8 && placeTarget.z + 1 > data.player.z - 0.3 && placeTarget.z < data.player.z + 0.3;
      if (usable && placeTarget && !overlaps) return { fixture, placeTarget };
      await page.evaluate((at) => (window as unknown as G).__GIERA__.world.setBlock(at.x, at.y, at.z, 0), fixture);
    }
  }
  throw new Error("Could not arm a reachable placement fixture");
}

test("headquarters: real purchases build a solid, persistent two-storey base", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);
  await page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    g.tycoon.addStars(g.tycoon.expansionSlots.slice(0, 3).reduce((sum, slot) => sum + slot.cost, 0));
  });

  await buyStage(page, 0);
  await waitForBlock(page, 0, 0, 0, 21);
  await buyStage(page, 1);
  await waitForBlock(page, -4, 1, 0, 22);
  await buyStage(page, 2);
  await waitForBlock(page, 0, 8, 0, 19);

  const purchased = await page.evaluate(() => (window as unknown as G).__GIERA__.tycoon.toJSON());
  expect(purchased.expansions).toEqual([0, 1, 2]);
  expect(purchased.collectedStars).toBe(0);

  await standAtLocal(page, 0.5, -1.5);
  await page.keyboard.down("s");
  try {
    await page.waitForFunction(() => {
      const g = (window as unknown as G).__GIERA__;
      return g.player.position.z > g.tycoon.origin.z + 1.25;
    }, null, { timeout: 8_000 });
  } finally {
    await page.keyboard.up("s");
  }

  await standAtLocal(page, -4.5, -1.4);
  const wallFrame = await page.evaluate(() => (window as unknown as G).__GIERA__.qa.frame);
  await page.keyboard.down("s");
  try {
    await page.waitForFunction((frame) => (window as unknown as G).__GIERA__.qa.frame >= (frame as number) + 45, wallFrame);
  } finally {
    await page.keyboard.up("s");
  }
  const wallStop = await page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    return { z: g.player.position.z, front: g.tycoon.origin.z };
  });
  expect(wallStop.z).toBeLessThan(wallStop.front);

  const structure = await page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    const at = g.tycoon.origin;
    const block = (x: number, y: number, z: number) => g.world.getBlock(at.x + x, at.y + y, at.z + z);
    return {
      foundation: block(0, 0, 0),
      wall: block(-4, 1, 0),
      doorway: [block(-1, 1, 0), block(0, 1, 0), block(-1, 2, 0), block(0, 2, 0)],
      support: block(-6, 1, 1),
      upperFloor: block(0, 4, 3),
      shaft: block(1, 4, 2),
      roof: block(0, 8, 0),
    };
  });
  expect(structure).toEqual({
    foundation: 21,
    wall: 22,
    doorway: [0, 0, 0, 0],
    support: 22,
    upperFloor: 21,
    shaft: 0,
    roof: 19,
  });

  const savedState = await page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    g.player.position.set(g.tycoon.origin.x + 20, g.tycoon.origin.y + 1.2, g.tycoon.origin.z + 20);
    g.player.velocity.set(0, 0, 0);
    g.qa.paused = true;
    const state = g.tycoon.toJSON();
    window.dispatchEvent(new Event("pagehide"));
    return state;
  });
  await page.waitForFunction(async () => {
    const request = indexedDB.open("giera_save_db", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const get = db.transaction("saves", "readonly").objectStore("saves").get("last_save");
    const saved = await new Promise<{ tycoon?: TycoonSave } | undefined>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result as { tycoon?: TycoonSave } | undefined);
      get.onerror = () => reject(get.error);
    });
    return saved?.tycoon?.expansions?.length === 3;
  }, null, { timeout: 8_000 });

  await page.reload();
  await page.waitForFunction(() => {
    const g = (window as unknown as G).__GIERA__;
    if (!g?.ready) return false;
    g.qa.paused = true;
    const at = g.tycoon.origin;
    return g.world.getBlock(at.x, at.y + 8, at.z) === 19;
  }, null, { timeout: 30_000 });
  const restored = await page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    const at = g.tycoon.origin;
    return {
      state: g.tycoon.toJSON(),
      foundation: g.world.getBlock(at.x, at.y, at.z),
      upperFloor: g.world.getBlock(at.x, at.y + 4, at.z + 3),
      shaft: g.world.getBlock(at.x + 1, at.y + 4, at.z + 2),
    };
  });
  expect(restored.state).toEqual(savedState);
  expect(restored.foundation).toBe(21);
  expect(restored.upperFloor).toBe(21);
  expect(restored.shaft).toBe(0);
  expect(errors).toEqual([]);
});

test("headquarters elevator: keyboard input rides safely up and down", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);
  await page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    g.tycoon.addStars(g.tycoon.expansionSlots.slice(0, 3).reduce((sum, slot) => sum + slot.cost, 0));
  });
  await buyStage(page, 0);
  await buyStage(page, 1);
  await buyStage(page, 2);
  await waitForBlock(page, 0, 8, 0, 19);

  await standAtLocal(page, 0.5, 1.5);
  await page.keyboard.down("d");
  try {
    await page.waitForFunction(() => {
      const g = (window as unknown as G).__GIERA__;
      return g.player.position.y > g.tycoon.origin.y + 1.25 && g.player.position.y < g.tycoon.origin.y + 4.5;
    }, null, { timeout: 6_000 });
  } finally {
    await page.keyboard.up("d");
  }
  const ridingUp = await page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    return { velocity: { ...g.player.velocity }, onGround: g.player.onGround };
  });
  expect(ridingUp.velocity).toEqual({ x: 0, y: 0, z: 0 });
  expect(ridingUp.onGround).toBe(false);

  await page.waitForFunction(() => {
    const g = (window as unknown as G).__GIERA__;
    return Math.abs(g.player.position.y - (g.tycoon.origin.y + 5)) < 0.02 &&
      Math.abs(g.player.position.z - (g.tycoon.origin.z + 3.5)) < 0.02 &&
      g.player.onGround;
  }, null, { timeout: 8_000 });
  const upperArrival = await page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    const at = g.tycoon.origin;
    return {
      x: g.player.position.x,
      y: g.player.position.y,
      z: g.player.position.z,
      floor: g.world.getBlock(at.x + 1, at.y + 4, at.z + 3),
      originX: at.x,
      originY: at.y,
      originZ: at.z,
    };
  });
  expect(upperArrival.x).toBeCloseTo(upperArrival.originX + 1.5, 5);
  expect(upperArrival.y).toBeCloseTo(upperArrival.originY + 5, 5);
  expect(upperArrival.z).toBeCloseTo(upperArrival.originZ + 3.5, 5);
  expect(upperArrival.floor).toBe(21);

  const leaveFrame = await page.evaluate(() => (window as unknown as G).__GIERA__.qa.frame);
  await page.keyboard.down("s");
  try {
    await page.waitForFunction((frame) => (window as unknown as G).__GIERA__.qa.frame >= (frame as number) + 32, leaveFrame);
  } finally {
    await page.keyboard.up("s");
  }
  await page.keyboard.down("w");
  try {
    await page.waitForFunction(() => {
      const g = (window as unknown as G).__GIERA__;
      return g.player.position.y < g.tycoon.origin.y + 4.75;
    }, null, { timeout: 8_000 });
  } finally {
    await page.keyboard.up("w");
  }
  await page.waitForFunction(() => {
    const g = (window as unknown as G).__GIERA__;
    return Math.abs(g.player.position.y - (g.tycoon.origin.y + 1)) < 0.02 &&
      Math.abs(g.player.position.z - (g.tycoon.origin.z + 1.5)) < 0.02 &&
      g.player.onGround;
  }, null, { timeout: 8_000 });

  const groundArrival = await page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    const at = g.tycoon.origin;
    return {
      frame: g.qa.frame,
      x: g.player.position.x,
      y: g.player.position.y,
      z: g.player.position.z,
      floor: g.world.getBlock(at.x + 1, at.y, at.z + 1),
      originX: at.x,
      originY: at.y,
      originZ: at.z,
    };
  });
  expect(groundArrival.x).toBeCloseTo(groundArrival.originX + 1.5, 5);
  expect(groundArrival.y).toBeCloseTo(groundArrival.originY + 1, 5);
  expect(groundArrival.z).toBeCloseTo(groundArrival.originZ + 1.5, 5);
  expect(groundArrival.floor).toBe(21);

  await page.waitForFunction((frame) => (window as unknown as G).__GIERA__.qa.frame >= (frame as number) + 30, groundArrival.frame);
  const settled = await page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    return { y: g.player.position.y, originY: g.tycoon.origin.y };
  });
  expect(settled.y).toBeCloseTo(settled.originY + 1, 5);
  expect(errors).toEqual([]);
});

test("headquarters dispensers: real walk-ons grant blocks once per cooldown and never on reload", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);
  await page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    g.tycoon.addStars(g.tycoon.expansionSlots.slice(0, 5).reduce((sum, slot) => sum + slot.cost, 0));
  });
  for (let stage = 0; stage <= 4; stage++) await buyStage(page, stage);

  const walkOntoDispenser = async (x: number, item: string, expected: number): Promise<void> => {
    await standAtLocal(page, x, 5.5);
    await page.keyboard.down("s");
    try {
      await page.waitForFunction(
        ([key, count]) => ((window as unknown as G).__GIERA__.inventory.toJSON().blocks[key as string] ?? 0) >= (count as number),
        [item, expected],
        { timeout: 8_000 },
      );
    } finally {
      await page.keyboard.up("s");
    }
  };

  await walkOntoDispenser(-5, "hero_floor", 8);
  const firstFrame = await page.evaluate(() => (window as unknown as G).__GIERA__.qa.frame);
  await page.waitForFunction((frame) => (window as unknown as G).__GIERA__.qa.frame >= (frame as number) + 30, firstFrame);
  expect(await page.evaluate(() => (window as unknown as G).__GIERA__.inventory.toJSON().blocks.hero_floor)).toBe(8);
  await page.waitForFunction((frame) => (window as unknown as G).__GIERA__.qa.frame >= (frame as number) + 480, firstFrame);
  await page.waitForFunction(() => (window as unknown as G).__GIERA__.inventory.toJSON().blocks.hero_floor === 16);

  await walkOntoDispenser(-3, "hero_wall", 8);
  await walkOntoDispenser(-1, "hero_glass", 8);
  await walkOntoDispenser(1, "neon_block", 8);
  const beforeReload = await page.evaluate(() => (window as unknown as G).__GIERA__.inventory.toJSON().blocks);
  expect(beforeReload).toMatchObject({ hero_floor: 16, hero_wall: 8, hero_glass: 8, neon_block: 8 });

  await page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    g.player.position.set(g.tycoon.origin.x + 20, g.tycoon.origin.y + 1.2, g.tycoon.origin.z + 20);
    g.player.velocity.set(0, 0, 0);
    window.dispatchEvent(new Event("pagehide"));
  });
  await page.waitForFunction(async () => {
    const request = indexedDB.open("giera_save_db", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const get = db.transaction("saves", "readonly").objectStore("saves").get("last_save");
    const saved = await new Promise<{ inventory?: { blocks?: Record<string, number> } } | undefined>((resolve, reject) => {
      get.onsuccess = () => resolve(get.result as { inventory?: { blocks?: Record<string, number> } } | undefined);
      get.onerror = () => reject(get.error);
    });
    return saved?.inventory?.blocks?.hero_floor === 16 && saved.inventory.blocks.neon_block === 8;
  }, null, { timeout: 8_000 });

  await page.reload();
  await page.waitForFunction(() => (window as unknown as G).__GIERA__?.ready === true, null, { timeout: 30_000 });
  const afterReload = await page.evaluate(() => (window as unknown as G).__GIERA__.inventory.toJSON().blocks);
  expect(afterReload).toMatchObject({ hero_floor: 16, hero_wall: 8, hero_glass: 8, neon_block: 8 });
  expect(errors).toEqual([]);
});

test("headquarters armory: walk-on gear equips through the real UI with exact bonuses", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);
  await page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    g.tycoon.addStars(g.tycoon.expansionSlots.reduce((sum, slot) => sum + slot.cost, 0));
  });
  for (let stage = 0; stage <= 5; stage++) await buyStage(page, stage);

  const routes = [
    { item: "star_pickaxe", startX: -4.5, startZ: 2, key: "a" },
    { item: "star_axe", startX: -4.5, startZ: 4, key: "a" },
    { item: "pulse_sword", startX: -5.7, startZ: 5.5, key: "s" },
  ] as const;
  for (const route of routes) {
    await standAtLocal(page, route.startX, route.startZ);
    await page.keyboard.down(route.key);
    try {
      await page.waitForFunction(
        (key) => ((window as unknown as G).__GIERA__.inventory.toJSON().items[key as string] ?? 0) === 1,
        route.item,
        { timeout: 8_000 },
      ).catch(async (error) => {
        const state = await page.evaluate(() => {
          const g = (window as unknown as G).__GIERA__;
          return { position: { ...g.player.position }, velocity: { ...g.player.velocity }, onGround: g.player.onGround, frame: g.qa.frame, paused: g.qa.paused, origin: { ...g.tycoon.origin }, items: g.inventory.toJSON().items, save: g.tycoon.toJSON() };
        });
        throw new Error(`${route.item} did not grant: ${JSON.stringify(state)}; page errors: ${JSON.stringify(errors)}`, { cause: error });
      });
    } finally {
      await page.keyboard.up(route.key);
    }
  }
  expect(await page.evaluate(() => (window as unknown as G).__GIERA__.inventory.toJSON().items)).toMatchObject({
    star_pickaxe: 1,
    star_axe: 1,
    pulse_sword: 1,
  });

  const equip = async (name: string, item: string): Promise<void> => {
    await page.keyboard.press("KeyI");
    await page.locator(".hud-tab-equipment").click();
    const card = page.locator(".hud-equip-item-card").filter({ hasText: name });
    await expect(card).toHaveCount(1);
    await card.locator(".hud-equip-btn").click();
    await page.waitForFunction((key) => (window as unknown as G).__GIERA__.inventory.equippedTool === key, item);
    await page.keyboard.press("Escape");
  };

  await equip("Gwiezdny Kilof", "star_pickaxe");
  expect(await page.evaluate(() => (window as unknown as G).__GIERA__.inventory.getMiningSpeedMultiplier(2))).toBe(5);
  await equip("Gwiezdny Topór", "star_axe");
  expect(await page.evaluate(() => (window as unknown as G).__GIERA__.inventory.getMiningSpeedMultiplier(7))).toBe(5);
  await equip("Miecz Pulsujący", "pulse_sword");
  expect(await page.evaluate(() => (window as unknown as G).__GIERA__.inventory.getCombatMultiplier())).toBe(4.5);
  expect(errors).toEqual([]);
});

test("headquarters dispenser blocks: each rewarded hotbar block places with real mouse input", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await boot(page);
  await page.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    g.tycoon.addStars(g.tycoon.expansionSlots.slice(0, 5).reduce((sum, slot) => sum + slot.cost, 0));
  });
  for (let stage = 0; stage <= 4; stage++) await buyStage(page, stage);

  for (const [x, item] of [[-5, "hero_floor"], [-3, "hero_wall"], [-1, "hero_glass"], [1, "neon_block"]] as const) {
    await standAtLocal(page, x, 5.5);
    await page.keyboard.down("s");
    try {
      await page.waitForFunction(
        (key) => ((window as unknown as G).__GIERA__.inventory.toJSON().blocks[key as string] ?? 0) === 8,
        item,
        { timeout: 8_000 },
      );
    } finally {
      await page.keyboard.up("s");
    }
  }
  expect(await page.evaluate(() => (window as unknown as G).__GIERA__.inventory.toJSON().hotbar.slice(0, 4))).toEqual([21, 22, 23, 24]);

  const armed = await armFrontBlock(page, await findFlatSpots(page));
  await page.locator("canvas#game").hover();
  for (const [slot, id] of [21, 22, 23, 24].entries()) {
    await page.keyboard.press(`Digit${slot + 1}`);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await page.waitForFunction(
      ([at, expected]) => (window as unknown as G).__GIERA__.world.getBlock(at.x, at.y, at.z) === expected,
      [armed.placeTarget, id] as [FlatSpot, number],
      { timeout: 8_000 },
    );
    await page.evaluate((at) => (window as unknown as G).__GIERA__.world.setBlock(at.x, at.y, at.z, 0), armed.placeTarget);
  }
  expect(errors).toEqual([]);
});
