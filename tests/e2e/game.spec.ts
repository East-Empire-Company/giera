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

  test("mine-place: adds mined block to inventory and places block", async ({ page }) => {
    await page.goto("/?seed=424242");
    await page.waitForFunction(() => (window as unknown as { __GIERA__?: { ready: boolean } }).__GIERA__?.ready === true);

    const initialCobble = await page.evaluate(() => {
      const g = (window as unknown as { __GIERA__: { inventory: { getBlockCount: (k: string) => number } } }).__GIERA__;
      return g.inventory.getBlockCount("cobblestone");
    });

    // Mine cobblestone programmatically
    await page.evaluate(() => {
      const g = (window as unknown as {
        __GIERA__: {
          world: { setBlock: (x: number, y: number, z: number, id: number) => void; getBlock: (x: number, y: number, z: number) => number };
          inventory: { addMinedBlock: (k: string, n: number) => void };
        };
      }).__GIERA__;
      g.world.setBlock(0, 41, 0, 0); // air
      g.inventory.addMinedBlock("cobblestone", 1);
    });

    const afterCobble = await page.evaluate(() => {
      const g = (window as unknown as { __GIERA__: { inventory: { getBlockCount: (k: string) => number } } }).__GIERA__;
      return g.inventory.getBlockCount("cobblestone");
    });
    expect(afterCobble).toBe(initialCobble + 1);

    // Place planks at (0, 41, 0)
    await page.evaluate(() => {
      const g = (window as unknown as {
        __GIERA__: {
          world: { setBlock: (x: number, y: number, z: number, id: number) => void; getBlock: (x: number, y: number, z: number) => number };
        };
      }).__GIERA__;
      g.world.setBlock(0, 41, 0, 9); // planks
    });

    const blockId = await page.evaluate(() => {
      const g = (window as unknown as {
        __GIERA__: { world: { getBlock: (x: number, y: number, z: number) => number } };
      }).__GIERA__;
      return g.world.getBlock(0, 41, 0);
    });
    expect(blockId).toBe(9);
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

    // Click craft on planks
    await page.click('button[data-id="planks"]');

    const plankCount = await page.evaluate(() => {
      const g = (window as unknown as { __GIERA__: { inventory: { getBlockCount: (k: string) => number } } }).__GIERA__;
      return g.inventory.getBlockCount("planks");
    });
    expect(plankCount).toBeGreaterThanOrEqual(4);
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
