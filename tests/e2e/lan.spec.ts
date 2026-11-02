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
    (g.inventory as any).setHotbarSlot(0, 3);
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
  expect(placedId, "client A did not place any block").not.toBe(0);

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
