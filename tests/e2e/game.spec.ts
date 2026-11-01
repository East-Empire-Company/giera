import { test, expect } from "@playwright/test";

test.describe("Giera Voxel Sandbox MVP E2E", () => {
  test("boot: loads page, canvas WebGL exists, ready state is true", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/?seed=424242");
    await page.waitForFunction(() => (window as unknown as { __GIERA__?: { ready: boolean } }).__GIERA__?.ready === true, null, {
      timeout: 25_000,
    });
    await expect(page.locator("#launch-menu")).toBeVisible();
    const splash = await page.locator("#boot-video").evaluate((node) => ({
      muted: (node as HTMLVideoElement).muted,
      source: node.querySelector("source")?.getAttribute("src"),
    }));
    expect(splash.source).toBe("/assets/video/jakub-team-signal-4k60.mp4");

    const hasCanvas = await page.evaluate(() => !!document.querySelector("canvas#game"));
    expect(hasCanvas).toBe(true);

    const isReady = await page.evaluate(() => (window as unknown as { __GIERA__?: { ready: boolean } }).__GIERA__?.ready);
    expect(isReady).toBe(true);

    expect(errors).toEqual([]);
  });

  test("launch scene places the concierge beside the settings panel", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/?seed=424242");
    await page.waitForFunction(() => window.__GIERA__?.ready === true);
    await page.waitForSelector("#concierge-panel:not([hidden])");

    const bounds = await page.evaluate(() => {
      const panel = document.querySelector(".launch-panel")!.getBoundingClientRect();
      const robot = document.querySelector("#concierge-panel")!.getBoundingClientRect();
      const canvas = document.querySelector("#concierge-canvas")!.getBoundingClientRect();
      return { panelRight: panel.right, robotLeft: robot.left, canvasWidth: canvas.width };
    });

    expect(bounds.robotLeft).toBeGreaterThanOrEqual(bounds.panelRight);
    expect(bounds.canvasWidth).toBeGreaterThan(300);
  });
  test("launch: starts background playlist without music controls", async ({ page }) => {
    const musicRequests: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/assets/audio/music/")) musicRequests.push(path);
    });

    await page.goto("/?seed=424242");
    await page.waitForFunction(() => window.__GIERA__?.ready === true);
    await expect(page.locator("#launch-menu")).toBeVisible();
    await expect(page.locator("#launch-music, #pause-music, #launch-music-hint, .hud-music-btn")).toHaveCount(0);

    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => window.__GIERA__?.audio.playingMusic === "sigma_protocol");
    expect(musicRequests).toContain("/assets/audio/music/sigma_protocol.mp3");

    await page.locator("#launch-mode").click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    await page.waitForFunction(() => window.__GIERA__?.splitScreen.isSplitScreen === true);
    await expect(page.locator("#launch-menu")).toBeHidden();
    await expect(page.locator("#hud-root .hud-music-btn")).toHaveCount(0);
    expect(await page.evaluate(() => window.__GIERA__?.audio.playingMusic)).toBe("sigma_protocol");
  });

  test("launch: applies the selected solo profile before gameplay", async ({ page }) => {
    await page.goto("/?seed=424242");
    await page.waitForFunction(() => window.__GIERA__?.ready === true);
    await page.locator("#launch-profile-gniewko").click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();

    await page.waitForFunction(() => window.__GIERA__?.player.profile.name === "Gniewko");
    expect(await page.evaluate(() => window.__GIERA__?.player2?.profile.name)).toBe("Ziemek");
  });

  test("gameplay: HUD becomes visible and interactive after launch", async ({ page }) => {
    await page.goto("/?seed=424242");
    await page.waitForFunction(() => window.__GIERA__?.ready === true);
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();

    await expect(page.locator("#launch-menu")).toBeHidden();
    await expect(page.locator("#hud-root")).toBeVisible();
    await expect(page.locator(".hud-mode-btn")).toBeVisible();
    await expect(page.locator("#hud-root")).not.toHaveAttribute("inert", "");
  });

  test("launch audio category changes music and speech volume separately", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/?seed=424242");
    await page.waitForFunction(() => window.__GIERA__?.ready === true);
    await page.locator("#launch-audio-category summary").click();
    await expect(page.locator("#launch-music-volume")).toBeVisible();
    await expect(page.locator("#launch-speech-volume")).toBeVisible();

    const before = await page.evaluate(() => ({
      music: window.__GIERA__?.audio.musicVolume,
      speech: window.__GIERA__?.audio.speechVolume,
    }));
    await page.locator("#launch-music-volume").focus();
    await page.keyboard.press("ArrowLeft");
    const afterMusic = await page.evaluate(() => ({
      music: window.__GIERA__?.audio.musicVolume,
      speech: window.__GIERA__?.audio.speechVolume,
    }));
    expect(afterMusic.music).toBeLessThan(before.music ?? 1);
    expect(afterMusic.speech).toBe(before.speech);

    await page.locator("#launch-speech-volume").focus();
    await page.keyboard.press("ArrowLeft");
    const after = await page.evaluate(() => ({
      music: window.__GIERA__?.audio.musicVolume,
      speech: window.__GIERA__?.audio.speechVolume,
    }));
    expect(after.music).toBe(afterMusic.music);
    expect(after.speech).toBeLessThan(before.speech ?? 1);
    await expect(page.locator("#pause-speech-volume")).toHaveValue(String(after.speech));
    expect(pageErrors).toEqual([]);
  });

  test("persistence: voxel edits survive a reload", async ({ page }) => {
    await page.goto("/?seed=424242");
    await page.waitForFunction(() => window.__GIERA__?.ready === true);
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    const edit = await page.evaluate(() => {
      const g = window.__GIERA__!;
      const x = 3;
      const z = 5;
      let y = Math.floor(g.player.position.y) + 2;
      while (g.world.getBlock(x, y, z) !== 0) y++;
      g.world.setBlock(x, y, z, 10);
      window.dispatchEvent(new Event("pagehide"));
      return { x, y, z, key: `${x},${y},${z}` };
    });
    await page.waitForFunction(async (key) => {
      const request = indexedDB.open("giera_save_db", 1);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const saved = await new Promise<{ edits?: Record<string, number> } | undefined>((resolve, reject) => {
        const get = db.transaction("saves", "readonly").objectStore("saves").get("last_save");
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      });
      return saved?.edits?.[key] === 10;
    }, edit.key, { timeout: 5_000 });

    await page.reload();
    await page.waitForFunction(() => window.__GIERA__?.ready === true);
    expect(await page.evaluate(({ x, y, z }) => window.__GIERA__!.world.getBlock(x, y, z), edit)).toBe(10);
  });
  test("pause: silences background music until the game resumes", async ({ page }) => {
    await page.goto("/?seed=424242");
    await page.waitForFunction(() => window.__GIERA__?.ready === true);
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    await page.waitForFunction(() => window.__GIERA__?.audio.playingMusic === "sigma_protocol");

    await page.keyboard.press("Escape");
    await expect(page.locator("#pause-menu")).toBeVisible();
    await page.waitForFunction(() => window.__GIERA__?.audio.playingMusic === undefined, null, { timeout: 2_000 });

    await page.getByRole("button", { name: "Wracam do gry" }).click();
    await expect(page.locator("#pause-menu")).toBeHidden();
    await page.waitForFunction(() => window.__GIERA__?.audio.playingMusic === "sigma_protocol");
  });





  test("craft: toggles inventory modal and crafts recipes", async ({ page }) => {
    await page.goto("/?seed=424242");
    await page.waitForFunction(() => (window as unknown as { __GIERA__?: { ready: boolean } }).__GIERA__?.ready === true);
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();

    // Give wood for crafting
    await page.evaluate(() => {
      const g = (window as unknown as { __GIERA__: { inventory: { addMinedBlock: (k: string, n: number) => void } } }).__GIERA__;
      g.inventory.addMinedBlock("oak_log", 8);
    });

    await page.locator(".hud-inventory-btn").click();
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
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();

    await page.click(".hud-mode-btn");

    const isSplit = await page.evaluate(() => {
      const g = (window as unknown as { __GIERA__: { splitScreen: { isSplitScreen: boolean } } }).__GIERA__;
      return g.splitScreen.isSplitScreen;
    });
    expect(isSplit).toBe(true);

    const btnText = await page.textContent(".hud-mode-btn");
    expect(btnText).toContain("2 Graczy");
  });
  test("Xbox WebView host selects direct rendering", async ({ browser }) => {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0",
    });
    try {
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 2 });
        const external = (window as unknown as { external?: { notify?: (message: string) => void } }).external ?? {};
        external.notify = () => {};
        Object.defineProperty(window, "external", { configurable: true, value: external });
      });
      const page = await context.newPage();
      await page.goto("/?seed=424242");
      await page.waitForFunction(() => window.__GIERA__?.ready === true);
      const direct = await page.evaluate(() => (window.__GIERA__?.postfx as unknown as { direct: boolean }).direct);
      expect(direct).toBe(true);
      await page.locator("#launch-start").click();
      await page.waitForFunction(() => (window.__GIERA__?.stats.drawCalls ?? 0) > 0);
      const rendering = await page.evaluate(() => ({
        drawCalls: window.__GIERA__?.stats.drawCalls ?? 0,
        contextLost: window.__GIERA__?.renderer.getContext().isContextLost() ?? true,
      }));
      expect(rendering.drawCalls).toBeGreaterThan(0);
      expect(rendering.contextLost).toBe(false);
    } finally {
      await context.close();
    }
  });

});
