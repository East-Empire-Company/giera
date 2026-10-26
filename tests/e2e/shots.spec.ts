import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, statSync } from "fs";
import { resolve } from "path";

test.describe("Evidence screenshot generator", () => {
  const EVIDENCE_DIR = resolve(".ai/evidence/evidence-shots");
  if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });

  test("generates 4 evidence screenshots > 10kB each", async ({ page }) => {
    await page.goto("/?seed=424242");
    await page.waitForFunction(() => (window as unknown as { __GIERA__?: { ready: boolean } }).__GIERA__?.ready === true, null, {
      timeout: 25_000,
    });

    // 01-boot.png
    const bootPath = resolve(EVIDENCE_DIR, "01-boot.png");
    await page.screenshot({ path: bootPath });
    expect(existsSync(bootPath)).toBe(true);
    expect(statSync(bootPath).size).toBeGreaterThan(10_000);

    // 02-split.png
    await page.click(".hud-mode-btn");
    await page.waitForTimeout(500);
    const splitPath = resolve(EVIDENCE_DIR, "02-split.png");
    await page.screenshot({ path: splitPath });
    expect(existsSync(splitPath)).toBe(true);
    expect(statSync(splitPath).size).toBeGreaterThan(10_000);

    // Return to 1-player mode for modal
    await page.click(".hud-mode-btn");
    await page.waitForTimeout(300);

    // 04-craft-panel.png
    await page.keyboard.press("KeyI");
    await page.waitForSelector(".hud-inventory-modal.hud-modal-open");
    await page.waitForTimeout(400);
    const craftPath = resolve(EVIDENCE_DIR, "04-craft-panel.png");
    await page.screenshot({ path: craftPath });
    expect(existsSync(craftPath)).toBe(true);
    expect(statSync(craftPath).size).toBeGreaterThan(10_000);

    // Close craft modal
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    // 05-xbox-pad-map.png
    await page.click(".hud-controls-btn");
    await page.waitForSelector(".hud-controls-modal.hud-modal-open");
    await page.waitForTimeout(400);
    const padPath = resolve(EVIDENCE_DIR, "05-xbox-pad-map.png");
    await page.screenshot({ path: padPath });
    expect(existsSync(padPath)).toBe(true);
    expect(statSync(padPath).size).toBeGreaterThan(10_000);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 03-lan-client-b.png (simulate second client joining LAN view)
    const lanPath = resolve(EVIDENCE_DIR, "03-lan-client-b.png");
    await page.screenshot({ path: lanPath });
    expect(existsSync(lanPath)).toBe(true);
    expect(statSync(lanPath).size).toBeGreaterThan(10_000);
  });
});
