import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const EVIDENCE = resolve(import.meta.dirname, "../../.ai/evidence/pipeline");
const FPS_MIN = Number(process.env.GIERA_PERF_FPS_MIN ?? 45);
const FPS_FAIL = 30;
const BOOT_BUDGET_MS = 15_000;
const DRAW_CALL_WARN = 8500;
const REMESH_BUDGET_MS = 250;

type PerfSnapshot = {
  soloBuckets: number[];
  splitBuckets: number[];
  maxDrawCalls: number;
  remeshMs: number;
};

test("performance: solo and split fps, draw calls, boot time and remesh stay within budget", async ({ page }) => {
  test.setTimeout(180_000);
  const bootStart = Date.now();
  await page.goto("/?seed=424242&qa=1");
  await page.waitForFunction(() => (window as unknown as { __GIERA__?: { ready: boolean } }).__GIERA__?.ready === true, null, {
    timeout: 30_000,
  });
  const bootMs = Date.now() - bootStart;
  await page.waitForFunction(() => ((window as unknown as { __GIERA__?: { qa?: { frame: number } } }).__GIERA__?.qa?.frame ?? 0) > 60);

  await page.evaluate(() => {
    const g = (window as unknown as { __GIERA__: any }).__GIERA__;
    const perf = { frames: 0, bucketStart: performance.now(), soloBuckets: [] as number[], splitBuckets: [] as number[], maxDrawCalls: 0, remeshMs: 0 };
    (window as unknown as { __PERF__: PerfSnapshot }).__PERF__ = perf;
    const origRemesh = g.world.remeshChunk.bind(g.world);
    g.world.remeshChunk = (...args: unknown[]) => {
      const t0 = performance.now();
      (origRemesh as (...a: unknown[]) => void)(...args);
      perf.remeshMs = performance.now() - t0;
    };
    const poll = setInterval(() => {
      perf.maxDrawCalls = Math.max(perf.maxDrawCalls, g.renderer.info.render.calls);
    }, 200);
    let splitMode = g.splitScreen.isSplitScreen;
    const loop = (): void => {
      const now = performance.now();
      const currentSplitMode = g.splitScreen.isSplitScreen;
      if (currentSplitMode !== splitMode) {
        splitMode = currentSplitMode;
        perf.frames = 0;
        perf.bucketStart = now;
      }
      perf.frames++;
      if (now - perf.bucketStart >= 1000) {
        (splitMode ? perf.splitBuckets : perf.soloBuckets).push(perf.frames);
        perf.frames = 0;
        perf.bucketStart = now;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    (window as unknown as { __PERF_STOP__: () => void }).__PERF_STOP__ = () => clearInterval(poll);
  });

  await page.keyboard.down("KeyW");
  await page.waitForTimeout(2000);
  await page.keyboard.up("KeyW");
  await page.evaluate(() => {
    const g = (window as unknown as { __GIERA__: any }).__GIERA__;
    g.player.rotateCamera(1.4, -0.1);
    g.player.position.set(3, g.player.position.y, 6);
    g.player.yaw = Math.PI / 2;
    g.player.pitch = -0.15;
    g.player.velocity.set(0, 0, 0);
    g.player.syncAvatar();
  });
  const canvas = page.locator("canvas#game");
  await canvas.hover();
  await page.mouse.down();
  await page.waitForTimeout(4000);
  await page.mouse.up();
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  await page.locator(".hud-mode-btn").click();
  await page.waitForFunction(() => window.__GIERA__?.splitScreen.isSplitScreen === true);
  await page.waitForTimeout(5000);

  const perf = await page.evaluate(() => {
    (window as unknown as { __PERF_STOP__: () => void }).__PERF_STOP__();
    return (window as unknown as { __PERF__: PerfSnapshot }).__PERF__;
  });
  expect(perf.soloBuckets).not.toHaveLength(0);
  expect(perf.splitBuckets).not.toHaveLength(0);

  const median = (buckets: number[]): number => {
    const sorted = [...buckets].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  };
  const soloFpsP50 = median(perf.soloBuckets);
  const splitFpsP50 = median(perf.splitBuckets);
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(
    resolve(EVIDENCE, "perf.json"),
    `${JSON.stringify(
      {
        bootMs,
        soloFpsP50,
        soloFpsBuckets: perf.soloBuckets,
        splitFpsP50,
        splitFpsBuckets: perf.splitBuckets,
        maxDrawCalls: perf.maxDrawCalls,
        remeshMs: perf.remeshMs,
        budgets: { fpsMin: FPS_MIN, fpsFail: FPS_FAIL, bootMs: BOOT_BUDGET_MS, drawCalls: DRAW_CALL_WARN },
      },
      null,
      2
    )}\n`
  );

  expect(bootMs, `boot-to-ready ${bootMs}ms exceeds ${BOOT_BUDGET_MS}ms`).toBeLessThan(BOOT_BUDGET_MS);
  expect(perf.remeshMs, `remesh ${perf.remeshMs}ms exceeds ${REMESH_BUDGET_MS}ms`).toBeLessThan(REMESH_BUDGET_MS);
  for (const [mode, fpsP50] of [["solo", soloFpsP50], ["split", splitFpsP50]] as const) {
    if (fpsP50 < FPS_FAIL) {
      expect(fpsP50, `${mode} fps p50 ${fpsP50} below hard floor ${FPS_FAIL}`).toBeGreaterThanOrEqual(FPS_FAIL);
    } else if (fpsP50 < FPS_MIN) {
      console.warn(`perf warning: ${mode} fps p50 ${fpsP50} below advisory budget ${FPS_MIN}`);
    }
  }
  expect(perf.maxDrawCalls, `max draw calls ${perf.maxDrawCalls} means the counter reported a single pass`).toBeGreaterThan(1);
  if (perf.maxDrawCalls >= DRAW_CALL_WARN) {
    console.warn(`perf warning: max draw calls ${perf.maxDrawCalls} above ${DRAW_CALL_WARN}`);
  }
  console.log(
    `perf: boot=${bootMs}ms soloFpsP50=${soloFpsP50} splitFpsP50=${splitFpsP50} drawCalls=${perf.maxDrawCalls} remesh=${perf.remeshMs.toFixed(1)}ms`
  );
});
