import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { raycastInteract } from "../../src/shared/raycast";

const LAN_PORT = Number(process.env.GIERA_TEST_LAN_PORT ?? 8791);
const WS_URL = process.env.GIERA_TEST_WS ?? `ws://127.0.0.1:${LAN_PORT}/ws`;
const ROOM = "QATEST";
const SAVE_DIR = process.env.GIERA_TEST_DATA_DIR ?? resolve(import.meta.dirname, "../../server/data-test");
const SAVE_FILE = resolve(SAVE_DIR, `world-${ROOM}.json`);

test.skip(!process.env.GIERA_TEST_WS, "GIERA_TEST_WS not set — run through the pipeline orchestrator (network stage)");

type G = { __GIERA__: any };

async function boot(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}&qa=1`);
  await page.waitForFunction(() => (window as unknown as G).__GIERA__?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => (window as unknown as G).__GIERA__?.qa?.frame > 30, null, { timeout: 20_000 });
}

async function manualJoin(page: Page, room: string): Promise<void> {
  await page.keyboard.press("Escape");
  await page.locator("#pause-lan").click();
  await page.locator("#pause-lan-panel button:has-text('Dołącz')").click();
  await page.fill("#lan-manual-url", WS_URL!);
  await page.fill("#lan-manual-room", room);
  await page.locator("#pause-lan-panel button:has-text('Połącz')").click();
}

test("lan: two clients join one room, exchange a block edit, server persists the room", async ({ browser }) => {
  test.setTimeout(150_000);
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const A = await ctxA.newPage();
  const B = await ctxB.newPage();
  const errorsA: string[] = [];
  const errorsB: string[] = [];
  A.on("pageerror", (e) => errorsA.push(e.message));
  B.on("pageerror", (e) => errorsB.push(e.message));

  const initialSeedA = 111111;
  await boot(A, initialSeedA);
  await manualJoin(A, ROOM);
  await A.waitForFunction(
    (initialSeed) => {
      const game = (window as unknown as G).__GIERA__;
      const status = document.querySelector("#lan-status")?.textContent;
      return game?.ready && (
        game.seed !== initialSeed ||
        (status === "Połączono" && sessionStorage.getItem("giera.pendingLanJoin") === null)
      );
    },
    initialSeedA,
    { timeout: 30_000 },
  );
  const roomSeed = await A.evaluate(() => (window as unknown as G).__GIERA__.seed);
  if (roomSeed === initialSeedA) {
    await A.locator("#pause-resume").click();
  } else {
    await A.locator("#launch-start").click();
  }
  const httpBase = WS_URL!.replace(/^ws:/, "http:").replace(/\/ws$/, "");
  const roomPlayers = () =>
    A.evaluate(async ([base, code]) => {
      const response = await fetch(`${base}/lan/rooms`);
      const server = (await response.json()) as { rooms: { code: string; players: number }[] };
      return server.rooms.find((room) => room.code === code)?.players ?? 0;
    }, [httpBase, ROOM]);
  await expect.poll(roomPlayers, { timeout: 20_000 }).toBe(1);

  const initialSeedB = roomSeed === 424242 ? 424243 : 424242;
  await boot(B, initialSeedB);
  await manualJoin(B, ROOM);
  await B.waitForFunction(
    (seed) => {
      const game = (window as unknown as G).__GIERA__;
      return game?.ready === true && game.seed === seed;
    },
    roomSeed,
    { timeout: 30_000 },
  );
  await B.locator("#launch-start").click();
  const origin = (page: Page) =>
    page.evaluate(() => {
      const g = (window as unknown as G).__GIERA__;
      const remotes = [...g.remoteTycoons.values()].map((t: { origin: { x: number; z: number } }) => ({
        x: t.origin.x,
        z: t.origin.z,
      }));
      return { own: { x: g.tycoon.origin.x, z: g.tycoon.origin.z }, remotes };
    });

  await expect.poll(async () => (await origin(A)).remotes.length, { timeout: 20_000 }).toBe(1);
  await expect.poll(async () => (await origin(B)).remotes.length, { timeout: 20_000 }).toBe(1);

  const a = await origin(A);
  const b = await origin(B);
  expect(a.own).not.toEqual(a.remotes[0]);
  expect(a.remotes[0]).toEqual(b.own);
  expect(b.remotes[0]).toEqual(a.own);

  await A.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    const p = g.player.position;
    p.x = 9;
    p.z = 9;
    for (let y = Math.ceil(p.y) + 2; y > 30; y--) {
      if (g.world.getBlock(9, y, 9) !== 0) {
        p.y = y + 1.01;
        break;
      }
    }
    g.player.velocity.set(0, 0, 0);
    g.player.syncAvatar();
  });
  await B.waitForFunction(
    () => {
      const g = (window as unknown as G).__GIERA__;
      return Math.abs(g.player2.position.x - 9) < 1.5 && Math.abs(g.player2.position.z - 9) < 1.5;
    },
    null,
    { timeout: 20_000 }
  );

  type Ray = {
    origin: { x: number; y: number; z: number };
    dir: { x: number; y: number; z: number };
    blocks: { x: number; y: number; z: number; id: number }[];
    player: { x: number; y: number; z: number };
  };
  const camRay = (): Promise<Ray> =>
    A.evaluate(() => {
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

  let armed = false;
  let armedYaw = 0;
  let placeTarget: { x: number; y: number; z: number } | null = null;
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    await A.evaluate(([y]) => {
      const g = (window as unknown as G).__GIERA__;
      g.player.yaw = y as number;
      g.player.pitch = 0;
      g.player.syncAvatar();
    }, [yaw]);
    await A.waitForTimeout(400);
    for (const dist of [8, 7.5, 8.5, 9, 7]) {
    const fixture = await A.evaluate(([d]) => {
      const g = (window as unknown as G).__GIERA__;
      const cam = g.camera;
      const dir = cam.position.clone();
      cam.getWorldDirection(dir);
      const x = Math.floor(cam.position.x + dir.x * (d as number));
      const y = Math.floor(cam.position.y + dir.y * (d as number));
      const z = Math.floor(cam.position.z + dir.z * (d as number));
      g.world.setBlock(x, y, z, 2);
      return { x, y, z };
    }, [dist]);
    const ray = await camRay();
    const lookup = new Map(ray.blocks.map((b) => [`${b.x},${b.y},${b.z}`, b.id]));
    const head = { x: ray.player.x, y: ray.player.y + 1.55, z: ray.player.z };
    const hit = raycastInteract(ray.origin, ray.dir, 12, (x, y, z) => lookup.get(`${x},${y},${z}`) ?? 0, head);
    const usable = hit !== null && hit.hit.x === fixture.x && hit.hit.y === fixture.y && hit.hit.z === fixture.z;
    const target = hit
      ? { x: hit.hit.x + hit.normal.x, y: hit.hit.y + hit.normal.y, z: hit.hit.z + hit.normal.z }
      : null;
    const overlaps =
      target !== null &&
      target.x + 1 > ray.player.x - 0.3 &&
      target.x < ray.player.x + 0.3 &&
      target.y + 1 > ray.player.y &&
      target.y < ray.player.y + 1.8 &&
      target.z + 1 > ray.player.z - 0.3 &&
      target.z < ray.player.z + 0.3;
    if (usable && target && !overlaps) {
      armedYaw = yaw;
      placeTarget = target;
      armed = true;
      break;
    }
    await A.evaluate(([t]) => {
      (window as unknown as G).__GIERA__.world.setBlock(t.x, t.y, t.z, 0);
    }, [fixture]);
    }
    if (armed) break;
  }
  if (!armed || !placeTarget) throw new Error("could not arm a reachable block for lan placement");

  await A.locator("canvas#game").hover();
  await A.evaluate(([y]) => {
    const g = (window as unknown as G).__GIERA__;
    (g.inventory as any).setHotbarSlot(0, 20);
    (g.inventory as any).selectSlot(0);
    g.player.yaw = y as number;
    g.player.pitch = 0;
    g.player.syncAvatar();
  }, [armedYaw]);
  await A.waitForTimeout(400);
  await A.mouse.down({ button: "right" });
  await A.mouse.up({ button: "right" });
  await A.waitForTimeout(500);
  const placedId = await A.evaluate(
    ([t]) => (window as unknown as G).__GIERA__.world.getBlock(t.x, t.y, t.z),
    [placeTarget]
  );
  expect(placedId, "client A did not place any block").toBe(20);

  const placed = { ...placeTarget, id: placedId };
  await B.waitForFunction(
    ([p]) => {
      const g = (window as unknown as G).__GIERA__;
      return g.world.getBlock(p.x, p.y, p.z) === p.id;
    },
    [placed],
    { timeout: 20_000 }
  );

  const editKey = `${placed.x},${placed.y},${placed.z}`;
  await expect
    .poll(
      () => {
        if (!existsSync(SAVE_FILE)) return undefined;
        const saved = JSON.parse(readFileSync(SAVE_FILE, "utf8")) as { edits?: Record<string, number> };
        return saved.edits?.[editKey];
      },
      { timeout: 40_000, intervals: [500] },
    )
    .toBe(placed.id);

  expect(errorsA).toEqual([]);
  expect(errorsB).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});

test("lan: HQ restoration is shared and duplicate-free, remote dispensers never grant or write", async ({ browser }) => {
  test.setTimeout(240_000);
  const room = "QAHQ";
  const saveFile = resolve(SAVE_DIR, `world-${room}.json`);
  const readSave = (): { savedAt: string; edits: Record<string, number> } | undefined => {
    try {
      if (!existsSync(saveFile)) return undefined;
      return JSON.parse(readFileSync(saveFile, "utf8")) as { savedAt: string; edits: Record<string, number> };
    } catch {
      return undefined;
    }
  };
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const A = await ctxA.newPage();
  const B = await ctxB.newPage();
  const errorsA: string[] = [];
  const errorsB: string[] = [];
  A.on("pageerror", (error) => errorsA.push(error.message));
  B.on("pageerror", (error) => errorsB.push(error.message));

  const initialSeedA = 313131;
  await boot(A, initialSeedA);
  await manualJoin(A, room);
  await A.waitForFunction(
    (initialSeed) => {
      const game = (window as unknown as G).__GIERA__;
      const status = document.querySelector("#lan-status")?.textContent;
      return game?.ready && (
        game.seed !== initialSeed ||
        (status === "Połączono" && sessionStorage.getItem("giera.pendingLanJoin") === null)
      );
    },
    initialSeedA,
    { timeout: 30_000 },
  );
  const roomSeed = await A.evaluate(() => (window as unknown as G).__GIERA__.seed);
  if (roomSeed === initialSeedA) await A.locator("#pause-resume").click();
  else await A.locator("#launch-start").click();

  await boot(B, roomSeed === 424242 ? 424243 : 424242);
  await manualJoin(B, room);
  await B.waitForFunction(
    (seed) => {
      const game = (window as unknown as G).__GIERA__;
      return game?.ready === true && game.seed === seed;
    },
    roomSeed,
    { timeout: 30_000 },
  );
  await B.goto(`/?seed=${roomSeed}&qa=1`);
  await B.waitForFunction(() => {
    const game = (window as unknown as G).__GIERA__;
    return game?.ready === true && Boolean(game.qa);
  }, null, { timeout: 30_000 });
  await expect.poll(() => A.evaluate(() => (window as unknown as G).__GIERA__.remoteTycoons.size), { timeout: 20_000 }).toBe(1);
  await expect.poll(() => B.evaluate(() => (window as unknown as G).__GIERA__.remoteTycoons.size), { timeout: 20_000 }).toBe(1);

  const originA = await A.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    g.tycoon.addStars(g.tycoon.expansionSlots.find((slot: { index: number }) => slot.index === 0).cost);
    const slot = g.tycoon.expansionSlots.find((entry: { index: number }) => entry.index === 0);
    g.player.position.set(g.tycoon.origin.x + slot.x, g.tycoon.origin.y + 1.2, g.tycoon.origin.z + slot.z - 1.4);
    g.player.velocity.set(0, 0, 0);
    g.player.yaw = 0;
    g.player.syncAvatar();
    return { x: g.tycoon.origin.x, y: g.tycoon.origin.y, z: g.tycoon.origin.z };
  });
  await A.keyboard.down("s");
  try {
    await A.waitForFunction(
      () => (window as unknown as G).__GIERA__.tycoon.toJSON().expansions?.includes(0),
      null,
      { timeout: 10_000 },
    );
  } finally {
    await A.keyboard.up("s");
  }

  const foundation = { x: originA.x, y: originA.y, z: originA.z };
  const finalFoundation = { x: originA.x + 5, y: originA.y, z: originA.z + 8 };
  for (const page of [A, B]) {
    await page.waitForFunction(
      ([first, last]) => {
        const world = (window as unknown as G).__GIERA__.world;
        return world.getBlock(first.x, first.y, first.z) === 21 && world.getBlock(last.x, last.y, last.z) === 21;
      },
      [foundation, finalFoundation],
      { timeout: 25_000 },
    );
  }

  const finalEditKey = `${finalFoundation.x},${finalFoundation.y},${finalFoundation.z}`;
  await expect.poll(() => readSave()?.edits[finalEditKey], { timeout: 45_000, intervals: [500] }).toBe(21);
  const beforeReload = readSave();
  expect(beforeReload).toBeDefined();
  const editCountBeforeReload = Object.keys(beforeReload!.edits).length;

  await A.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await A.waitForFunction(async () => {
    const rawSession = sessionStorage.getItem("giera.activeLanRoom");
    if (!rawSession) return false;
    const session = JSON.parse(rawSession) as { url: string; room: string };
    const key = `room:${new URL(session.url).origin}:${session.room.trim().replace(/\s+/g, "").toLowerCase()}`;
    const request = indexedDB.open("giera_save_db", 1);
    const db = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const get = db.transaction("saves", "readonly").objectStore("saves").get(key);
    const saved = await new Promise<{ tycoon?: { expansions?: number[] } } | undefined>((resolveGet, rejectGet) => {
      get.onsuccess = () => resolveGet(get.result as { tycoon?: { expansions?: number[] } } | undefined);
      get.onerror = () => rejectGet(get.error);
    });
    db.close();
    return saved?.tycoon?.expansions?.includes(0) === true;
  }, null, { timeout: 10_000 });

  await A.reload();
  await A.waitForFunction(() => (window as unknown as G).__GIERA__?.ready === true, null, { timeout: 30_000 });
  if (await A.locator("#launch-start").isVisible()) await A.locator("#launch-start").click();
  await expect.poll(
    () => A.evaluate(([seed, first, last]) => {
      const g = (window as unknown as G).__GIERA__;
      if (!g?.ready) return { ready: false };
      return {
        ready: true,
        seed: g.seed,
        expansions: g.tycoon.toJSON().expansions,
        origin: { x: g.tycoon.origin.x, y: g.tycoon.origin.y, z: g.tycoon.origin.z },
        foundation: g.world.getBlock(first.x, first.y, first.z),
        finalFoundation: g.world.getBlock(last.x, last.y, last.z),
        qa: Boolean(g.qa),
        activeRoom: sessionStorage.getItem("giera.activeLanRoom"),
        remoteCount: g.remoteTycoons.size,
        url: location.href,
      };
    }, [roomSeed, foundation, finalFoundation]),
    { timeout: 35_000 },
  ).toMatchObject({ ready: true, seed: roomSeed, expansions: [0], origin: originA, foundation: 21, finalFoundation: 21 });
  const restored = await A.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    return {
      expansions: g.tycoon.toJSON().expansions,
      origin: { x: g.tycoon.origin.x, y: g.tycoon.origin.y, z: g.tycoon.origin.z },
    };
  });
  expect(restored.expansions).toEqual([0]);
  expect(restored.origin).toEqual(originA);
  await expect.poll(() => B.evaluate(() => (window as unknown as G).__GIERA__.remoteTycoons.size), { timeout: 20_000 }).toBe(1);

  await expect.poll(() => readSave()?.savedAt ?? "", { timeout: 45_000, intervals: [500] }).not.toBe(beforeReload!.savedAt);
  const afterReload = readSave();
  expect(afterReload).toBeDefined();
  expect(Object.keys(afterReload!.edits)).toHaveLength(editCountBeforeReload);

  const beforeRemote = await B.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    const remote = [...g.remoteTycoons.values()][0];
    remote.restore({ vaultCoins: 0, collectedStars: 0, dropperTier: 1, expansions: [4] });
    g.player.position.set(remote.origin.x - 5, remote.origin.y + 1.2, remote.origin.z + 7);
    g.player.velocity.set(0, 0, 0);
    g.player.yaw = 0;
    g.player.syncAvatar();
    const inventory = g.inventory.toJSON();
    return {
      frame: g.qa.frame,
      expansions: remote.toJSON().expansions,
      items: inventory.items,
      blocks: inventory.blocks,
      edits: g.world.exportEdits(),
    };
  });
  expect(beforeRemote.expansions).toEqual([4]);
  await B.waitForFunction(
    (frame) => {
      const g = (window as unknown as G).__GIERA__;
      return g.player.onGround && g.qa.frame >= (frame as number) + 120;
    },
    beforeRemote.frame,
    { timeout: 15_000 },
  );
  const afterRemote = await B.evaluate(() => {
    const g = (window as unknown as G).__GIERA__;
    const inventory = g.inventory.toJSON();
    return { items: inventory.items, blocks: inventory.blocks, edits: g.world.exportEdits() };
  });
  expect(afterRemote.items).toEqual(beforeRemote.items);
  expect(afterRemote.blocks).toEqual(beforeRemote.blocks);
  expect(afterRemote.edits).toEqual(beforeRemote.edits);

  await expect.poll(() => readSave()?.savedAt ?? "", { timeout: 45_000, intervals: [500] }).not.toBe(afterReload!.savedAt);
  const afterRemoteSave = readSave();
  expect(afterRemoteSave).toBeDefined();
  expect(Object.keys(afterRemoteSave!.edits)).toHaveLength(editCountBeforeReload);
  expect(afterRemoteSave!.edits).toEqual(afterReload!.edits);
  expect(errorsA).toEqual([]);
  expect(errorsB).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});
