import { test, expect, type Page } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const GOLDENS_DIR = resolve(import.meta.dirname, "../goldens");
const CAPTURE_DIR = resolve(import.meta.dirname, "../../.ai/evidence/pipeline/golden-captured");
const DIFF_DIR = resolve(import.meta.dirname, "../../.ai/evidence/pipeline/golden-diff");
const INIT = process.env.GIERA_GOLDENS_INIT === "1";
const STAGE = process.env.GIERA_GOLDENS_STAGE === "1";
const STAGE_DIR = resolve(GOLDENS_DIR, ".staging");
const THRESHOLD = 0.1;
const MAX_DIFF_RATIO = 0.001;

type Giera = {
  ready: boolean;
  player: {
    position: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
    velocity: { set: (x: number, y: number, z: number) => void };
    yaw: number;
    pitch: number;
    syncAvatar: () => void;
  };
  world: { loadedChunkCount: number };
  detailedAvatars: { ready: boolean; p1: boolean; p2: boolean };
  qa: { frame: number };
};

async function settle(page: Page): Promise<void> {
  await page.goto("/?seed=424242&qa=1");
  await page.waitForFunction(() => (window as unknown as { __GIERA__?: { ready: boolean } }).__GIERA__?.ready === true, {
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __GIERA__: Giera }).__GIERA__;
      return g.qa.frame >= 120 && g.world.loadedChunkCount >= 289 && g.detailedAvatars.ready === true;
    },
    { timeout: 60_000 }
  );
  const avatars = await page.evaluate(() => (window as unknown as { __GIERA__: Giera }).__GIERA__.detailedAvatars);
  expect(
    avatars.p1 && avatars.p2,
    `detailed hero models failed to load: ${JSON.stringify(avatars)}`
  ).toBe(true);
}

async function capture(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  const shot = await page.screenshot();
  mkdirSync(CAPTURE_DIR, { recursive: true });
  writeFileSync(resolve(CAPTURE_DIR, `${name}.png`), shot);
  if (STAGE) {
    mkdirSync(STAGE_DIR, { recursive: true });
    writeFileSync(resolve(STAGE_DIR, `${name}.png`), shot);
    return;
  }
  if (INIT) {
    mkdirSync(GOLDENS_DIR, { recursive: true });
    writeFileSync(resolve(GOLDENS_DIR, `${name}.png`), shot);
    return;
  }
  const goldenPath = resolve(GOLDENS_DIR, `${name}.png`);
  expect(existsSync(goldenPath), `golden missing: ${goldenPath} (run bun run goldens:init)`).toBe(true);
  mkdirSync(DIFF_DIR, { recursive: true });
  const golden = PNG.sync.read(readFileSync(goldenPath));
  const current = PNG.sync.read(shot);
  const diff = new PNG({ width: current.width, height: current.height });
  const mismatched = pixelmatch(golden.data, current.data, diff.data, current.width, current.height, {
    threshold: THRESHOLD,
  });
  const diffPath = resolve(DIFF_DIR, `${name}-diff.png`);
  writeFileSync(diffPath, PNG.sync.write(diff));
  const ratio = mismatched / (current.width * current.height);
  expect(
    ratio,
    `golden "${name}" diverged: ${(ratio * 100).toFixed(2)}% pixels differ. Diff: ${diffPath}. If the new look is intended, run: bun run accept -- --stage goldens --reason "..."`
  ).toBeLessThanOrEqual(MAX_DIFF_RATIO);
}

test.describe("Giera graphics goldens", () => {
  test("spawn view matches golden", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await settle(page);
    await capture(page, "spawn-view");
    expect(errors).toEqual([]);
  });

  test("split view matches golden", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await settle(page);
    await page.locator(".hud-mode-btn").click();
    await page.waitForTimeout(500);
    await capture(page, "split-view");
    expect(errors).toEqual([]);
  });

  test("tycoon view matches golden", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await settle(page);
    await page.evaluate(() => {
      const g = (window as unknown as { __GIERA__: Giera }).__GIERA__;
      g.player.position.set(-3, g.player.position.y, 7);
      g.player.velocity.set(0, 0, 0);
      g.player.yaw = 0;
      g.player.pitch = -0.12;
      g.player.syncAvatar();
    });
    await page.waitForTimeout(500);
    await capture(page, "tycoon-view");
    expect(errors).toEqual([]);
  });
});
