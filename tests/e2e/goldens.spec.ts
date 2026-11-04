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
const FREEZE_FRAME = 600;

type Giera = {
  ready: boolean;
  detailedAvatars?: { ready?: boolean };
  audio: { playingMusic?: string };
  postfx: { setBeatPulse: (value: number) => void; noteFrame: (deltaSeconds: number) => void };
  player: {
    position: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
    velocity: { set: (x: number, y: number, z: number) => void };
    yaw: number;
    pitch: number;
    syncAvatar: () => void;
  };
  world: { loadedChunkCount: number; decor: { children: { name?: string }[] } };
  scene: { traverse: (fn: (node: any) => void) => void };
  tycoon: {
    origin: { x: number; y: number; z: number };
    addStars: (amount: number) => void;
    buyExpansion: (index: number) => boolean;
  };
  qa: {
    frame: number;
    paused: boolean;
    pauseAt?: number;
    beatPulses?: number[];
    postfxDeltas?: number[];
  };
};

async function settle(page: Page): Promise<void> {
  await page.goto("/?seed=424242&qa=1");
  await page.waitForFunction(() => (window as unknown as { __GIERA__?: { ready: boolean } }).__GIERA__?.ready === true, null, {
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __GIERA__: Giera }).__GIERA__;
      return (
        g.qa.frame >= 120 &&
        g.world.loadedChunkCount >= 289 &&
        g.detailedAvatars?.ready === true &&
        g.world.decor.children.some((group) => group.name === "ground-decor")
      );
    },
    null,
    { timeout: 60_000 }
  );
}

async function freeze(page: Page, frame = FREEZE_FRAME): Promise<void> {
  const target = await page.evaluate((want) => {
    const g = (window as unknown as { __GIERA__: Giera }).__GIERA__;
    const at = Math.max(want, g.qa.frame + 2);
    g.qa.pauseAt = at;
    return at;
  }, frame);
  await page.waitForFunction(() => (window as unknown as { __GIERA__?: Giera }).__GIERA__?.qa.paused === true, null, {
    timeout: 30_000,
  });
  const frozen = await page.evaluate(() => (window as unknown as { __GIERA__: Giera }).__GIERA__.qa.frame);
  expect(
    frozen,
    `simulation froze at frame ${frozen}, not ${target}: wind, NPC wander and particles are time-driven, so a moving freeze point makes the golden flaky. Raise FREEZE_FRAME above the load cost.`
  ).toBe(target);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function capture(page: Page, name: string): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
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
    const errors = collectErrors(page);
    await settle(page);
    await freeze(page);
    await capture(page, "spawn-view");
    expect(errors).toEqual([]);
  });

  test("split view matches golden", async ({ page }) => {
    const errors = collectErrors(page);
    await settle(page);
    await page.locator(".hud-mode-btn").click();
    await freeze(page);
    await capture(page, "split-view");
    expect(errors).toEqual([]);
  });

  test("tycoon view matches golden", async ({ page }) => {
    const errors = collectErrors(page);
    await settle(page);
    await page.evaluate(() => {
      const g = (window as unknown as { __GIERA__: Giera }).__GIERA__;
      g.tycoon.addStars(120);
      g.tycoon.buyExpansion(0);
      g.tycoon.buyExpansion(1);
    });
    await page.waitForFunction(() => {
      const g = (window as unknown as { __GIERA__: Giera }).__GIERA__;
      const built = new Set<number>();
      g.scene.traverse((node) => {
        const match = /^expansion-module-([01])$/.exec(node.name);
        if (match && node.scale.x === 1) built.add(Number(match[1]));
      });
      return built.size === 2;
    }, null, { timeout: 15_000 });
    const frame = await page.evaluate(() => {
      const g = (window as unknown as { __GIERA__: Giera }).__GIERA__;
      g.player.position.set(g.tycoon.origin.x, g.tycoon.origin.y + 6, g.tycoon.origin.z - 10);
      g.player.velocity.set(0, 0, 0);
      g.player.yaw = Math.PI;
      g.player.pitch = 0.35;
      g.player.syncAvatar();
      return g.qa.frame;
    });
    await freeze(page, frame + 2);
    await capture(page, "tycoon-view");
    expect(errors).toEqual([]);
  });
  test("QA feeds fixed time to adaptive postfx", async ({ page }) => {
    await settle(page);
    await page.evaluate(() => {
      const g = (window as unknown as { __GIERA__: Giera }).__GIERA__;
      const deltas: number[] = [];
      const noteFrame = g.postfx.noteFrame.bind(g.postfx);
      g.qa.postfxDeltas = deltas;
      g.postfx.noteFrame = (deltaSeconds) => {
        deltas.push(deltaSeconds);
        noteFrame(deltaSeconds);
      };
    });
    await page.waitForFunction(
      () => ((window as unknown as { __GIERA__?: Giera }).__GIERA__?.qa.postfxDeltas?.length ?? 0) >= 120,
      null,
      { timeout: 10_000 }
    );
    const deltas = await page.evaluate(() => (window as unknown as { __GIERA__: Giera }).__GIERA__.qa.postfxDeltas ?? []);
    const distinct = [...new Set(deltas)].slice(0, 5);
    expect(deltas.every((delta) => delta === 1 / 60), `postfx timestep values: ${distinct.join(", ")}`).toBe(true);
  });
  test("QA keeps beat-reactive bloom static while music plays", async ({ page }) => {
    await settle(page);
    await page.evaluate(() => {
      const g = (window as unknown as { __GIERA__: Giera }).__GIERA__;
      const pulses: number[] = [];
      const setBeatPulse = g.postfx.setBeatPulse.bind(g.postfx);
      g.qa.beatPulses = pulses;
      g.postfx.setBeatPulse = (value) => {
        pulses.push(value);
        setBeatPulse(value);
      };
    });
    await page.mouse.click(5, 5);
    await page.waitForFunction(
      () => Boolean((window as unknown as { __GIERA__?: Giera }).__GIERA__?.audio.playingMusic),
      null,
      { timeout: 30_000 }
    );
    await freeze(page);
    await page.waitForFunction(
      () => ((window as unknown as { __GIERA__?: Giera }).__GIERA__?.qa.beatPulses?.length ?? 0) >= 60,
      null,
      { timeout: 5_000 }
    );
    const pulses = await page.evaluate(() => (window as unknown as { __GIERA__: Giera }).__GIERA__.qa.beatPulses ?? []);
    expect(Math.max(...pulses)).toBe(0);
  });
});
