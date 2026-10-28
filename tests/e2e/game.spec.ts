import { test, expect } from "@playwright/test";

test.describe("Giera Voxel Sandbox MVP E2E", () => {
  test("boot: loads page, canvas WebGL exists, ready state is true", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/?seed=424242");
    await page.waitForFunction(() => (window as unknown as { __GIERA__?: { ready: boolean } }).__GIERA__?.ready === true, null, {
      timeout: 25_000,
    });

    const hasCanvas = await page.evaluate(() => !!document.querySelector("canvas#game"));
    expect(hasCanvas).toBe(true);

    const isReady = await page.evaluate(() => (window as unknown as { __GIERA__?: { ready: boolean } }).__GIERA__?.ready);
    expect(isReady).toBe(true);

    expect(errors).toEqual([]);
  });



  test("craft: toggles inventory modal and crafts recipes", async ({ page }) => {
    await page.goto("/?seed=424242");
    await page.waitForFunction(() => (window as unknown as { __GIERA__?: { ready: boolean } }).__GIERA__?.ready === true);

    // Give wood for crafting
    await page.evaluate(() => {
      const g = (window as unknown as { __GIERA__: { inventory: { addMinedBlock: (k: string, n: number) => void } } }).__GIERA__;
      g.inventory.addMinedBlock("oak_log", 8);
    });

    // Focus canvas and press I to open inventory
    await page.click("canvas#game");
    await page.keyboard.press("KeyI");
    await page.waitForSelector(".hud-inventory-modal.hud-modal-open", { timeout: 10_000 });

    const modalOpen = await page.evaluate(() => document.querySelector(".hud-inventory-modal")?.classList.contains("hud-modal-open"));
    expect(modalOpen).toBe(true);

    const before = await page.evaluate(() => {
      const g = (window as unknown as { __GIERA__: { inventory: { getBlockCount: (k: string) => number } } }).__GIERA__;
      return { planks: g.inventory.getBlockCount("planks"), oak: g.inventory.getBlockCount("oak_log") };
    });
    await page.click('button[data-id="planks"]');
    const after = await page.evaluate(() => {
      const g = (window as unknown as { __GIERA__: { inventory: { getBlockCount: (k: string) => number } } }).__GIERA__;
      return { planks: g.inventory.getBlockCount("planks"), oak: g.inventory.getBlockCount("oak_log") };
    });
    expect(after.planks - before.planks).toBe(4);
    expect(before.oak - after.oak).toBe(4);
  });

  test("split: toggles 2-player split screen mode", async ({ page }) => {
    await page.goto("/?seed=424242");
    await page.waitForFunction(() => (window as unknown as { __GIERA__?: { ready: boolean } }).__GIERA__?.ready === true);

    await page.click(".hud-mode-btn");

    const isSplit = await page.evaluate(() => {
      const g = (window as unknown as { __GIERA__: { splitScreen: { isSplitScreen: boolean } } }).__GIERA__;
      return g.splitScreen.isSplitScreen;
    });
    expect(isSplit).toBe(true);

    const btnText = await page.textContent(".hud-mode-btn");
    expect(btnText).toContain("2 Graczy");
  });
});
