import { test, expect, type Page } from "@playwright/test";
import { BLOCK_ID } from "../../src/shared/blocks";

const LAN_PORT = Number(process.env.GIERA_TEST_LAN_PORT ?? 8791);
const WS_URL = process.env.GIERA_TEST_WS ?? `ws://127.0.0.1:${LAN_PORT}/ws`;
const ROOM = "QACOMP";

test.skip(!process.env.GIERA_TEST_WS, "GIERA_TEST_WS not set — run through the pipeline orchestrator or a composed environment");

type G = { __GIERA__: any };

type FrameCounters = {
  companionState: number;
  companionRemove: number;
  companionSay: number;
  buildReserved: number;
  buildPreview: number;
  block: number;
};

function watchFrames(page: Page): FrameCounters & { sent: string[]; errors: string[] } {
  const counters: FrameCounters & { buildPreview: number; sent: string[]; errors: string[] } = { companionState: 0, companionRemove: 0, companionSay: 0, buildReserved: 0, buildPreview: 0, block: 0, sent: [], errors: [] };
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      try {
        const msg = JSON.parse(String(frame.payload)) as { t?: string; message?: string; reason?: string; generation?: number; companion?: { id: string } };
        if (msg.t === "companion_state") counters.companionState += 1;
        if (msg.t === "companion_remove") counters.companionRemove += 1;
        if (msg.t === "companion_say") counters.companionSay += 1;
        if (msg.t === "build_reserved") counters.buildReserved += 1;
        if (msg.t === "build_preview") counters.buildPreview += 1;
        if (msg.t === "build_cancelled") counters.errors.push(`build_cancelled ${msg.reason ?? ""}`);
        if (msg.t === "block") counters.block += 1;
        if (msg.t === "companion_error") counters.errors.push(`${msg.message} (gen ${msg.generation})`);
        if (msg.t === "companion_state") counters.errors.push(`recv-state gen=${msg.generation} id=${msg.companion?.id}`);
      } catch {}
    });
    ws.on("framesent", (frame) => {
      try {
        const msg = JSON.parse(String(frame.payload)) as { t?: string; expectedGeneration?: number; companion?: { id: string } };
        if (msg.t && msg.t !== "input" && msg.t !== "need") {
          counters.sent.push(msg.t);
          if (msg.t === "companion_command") counters.errors.push(`sent-command gen=${msg.expectedGeneration}`);
          if (msg.t === "companion_state") counters.errors.push(`sent-state id=${msg.companion?.id}`);
        }
      } catch {}
    });
  });
  return counters;
}

async function boot(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}&qa=1`);
  await page.waitForFunction(() => (window as unknown as G).__GIERA__?.ready === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => (window as unknown as G).__GIERA__?.qa?.frame > 30, null, { timeout: 20_000 });
}

async function manualJoin(page: Page, host = false, roomCode = ROOM): Promise<void> {
  await page.keyboard.press("Escape");
  await page.locator("#pause-lan").click();
  if (host) {
    await page.locator("#pause-lan-panel button:has-text('Załóż nową grę')").click();
    await page.fill("#lan-host-name", roomCode);
    await page.locator("#pause-lan-panel button:has-text('Utwórz')").click();
    return;
  }
  await page.locator("#pause-lan-panel button:has-text('Dołącz')").click();
  await page.fill("#lan-manual-url", WS_URL);
  await page.fill("#lan-manual-room", roomCode);
  await page.locator("#pause-lan-panel button:has-text('Połącz')").click();
}

test("companion: owner adds buddy, scout reports, confirmed build places blocks, remove on owner close", async ({ browser }) => {
  test.setTimeout(540_000);
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const A = await ctxA.newPage();
  const B = await ctxB.newPage();
  const errorsA: string[] = [];
  const errorsB: string[] = [];
  A.on("pageerror", (e) => errorsA.push(e.message));
  B.on("pageerror", (e) => errorsB.push(e.message));
  const framesA = watchFrames(A);
  const framesB = watchFrames(B);

  const seedA = 701_001;
  await boot(A, seedA);
  await manualJoin(A, true);
  await A.waitForFunction(() => (window as unknown as G).__GIERA__?.ready === true, null, { timeout: 30_000 });
  if (await A.locator("#launch-start").isVisible().catch(() => false)) await A.locator("#launch-start").click();
  await A.waitForFunction(() => (window as unknown as G).__GIERA__?.ready === true, null, { timeout: 30_000 });
  await expect.poll(() => framesA.sent.filter((t) => t === "hello").length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  const roomSeed = await A.evaluate(() => (window as unknown as G).__GIERA__.seed);
  if (roomSeed !== seedA) throw new Error(`unexpected room seed ${roomSeed}`);

  await boot(B, roomSeed === 424242 ? 424_243 : 424_242);
  const roomCode = await A.evaluate(() => {
    try {
      return (JSON.parse(sessionStorage.getItem("giera.activeLanRoom") ?? "{}") as { room?: string }).room ?? "";
    } catch {
      return "";
    }
  });
  await manualJoin(B, false, roomCode);
  await B.waitForFunction(
    (seed) => (window as unknown as G).__GIERA__?.ready === true && (window as unknown as G).__GIERA__.seed === seed,
    roomSeed,
    { timeout: 30_000 },
  );
  if (await B.locator("#launch-start").isVisible().catch(() => false)) await B.locator("#launch-start").click();

  await A.keyboard.press("KeyB");
  await A.waitForFunction(() => (document.querySelector(".companion-panel") as HTMLElement | null)?.hidden === false, null, { timeout: 10_000 });
  await A.locator(".companion-panel select").selectOption("staszek");
  await A.locator(".companion-panel button:has-text('Dodaj')").click();

  await A.waitForFunction(() => true, null, { timeout: 100 }).catch(() => {});
  await expect.poll(() => framesA.companionState, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => framesB.companionState, { timeout: 20_000 }).toBeGreaterThan(0);

  await A.evaluate((stoneId) => {
    const g = (window as unknown as G).__GIERA__;
    const p = g.player.position;
    const x = Math.round(p.x) + 2;
    const z = Math.round(p.z) + 1;
    let y = 126;
    while (y > 1 && g.world.getBlock(x, y, z) === 0) y -= 1;
    g.world.setBlock(x, y + 1, z, stoneId, true);
  }, BLOCK_ID.stone);

  await A.locator(".companion-panel button:has-text('Szukaj')").click();
  await expect.poll(() => framesA.companionSay, { timeout: 45_000 }).toBeGreaterThan(0);
  await expect.poll(() => framesB.companionSay, { timeout: 20_000 }).toBeGreaterThan(0);

  await A.locator(".companion-panel button:has-text('Zbuduj domek')").click();
  await expect
    .poll(() => A.locator(".companion-panel button:has-text('Potwierdź')").isEnabled(), { timeout: 45_000, intervals: [5_000] })
    .toBe(true);
  await A.locator(".companion-panel button:has-text('Potwierdź')").click();
  await expect.poll(() => Math.min(framesA.block, framesB.block), { timeout: 240_000, intervals: [5_000] }).toBeGreaterThanOrEqual(20);

  await ctxA.close();
  await expect.poll(() => framesB.companionRemove, { timeout: 20_000 }).toBeGreaterThan(0);

  expect(errorsA).toEqual([]);
  expect(errorsB).toEqual([]);
});
