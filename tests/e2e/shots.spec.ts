import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, statSync } from "fs";
import { resolve } from "path";

type HeadquartersGiera = {
  ready: boolean;
  detailedAvatars: { ready: boolean };
  world: {
    loadedChunkCount: number;
    decor: { children: { name?: string }[] };
    getBlock: (x: number, y: number, z: number) => number;
  };
  player: {
    position: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
    velocity: { set: (x: number, y: number, z: number) => void };
    yaw: number;
    pitch: number;
    onGround: boolean;
    syncAvatar: () => void;
  };
  tycoon: {
    origin: { x: number; y: number; z: number };
    addStars: (amount: number) => void;
    buyExpansion: (index: number) => boolean;
    toJSON: () => { expansions?: number[] };
  };
  qa: { frame: number; paused: boolean; pauseAt?: number };
};

type HeadquartersWindow = { __GIERA__?: HeadquartersGiera };

test.describe("Evidence screenshot generator", () => {
  const EVIDENCE_DIR = resolve(".ai/evidence/evidence-shots");
  if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });

  test("generates 4 evidence screenshots > 10kB each", async ({ page }) => {
    await page.goto("/?seed=424242");
    await page.waitForFunction(() => (window as unknown as { __GIERA__?: { ready: boolean } }).__GIERA__?.ready === true, null, {
      timeout: 25_000,
    });
    await expect(page.locator("#launch-menu")).toBeVisible();
    await expect(page.locator("#boot-status")).toBeHidden();
    await page.waitForFunction(() => {
      let loaded = false;
      window.__GIERA__?.scene.traverse((node) => {
        if (node.name === "tycoon-plot" && node.children.length > 10) loaded = true;
      });
      return loaded;
    }, null, { timeout: 15_000 });
    const launchPath = resolve(EVIDENCE_DIR, "00-launch.png");
    await page.screenshot({ path: launchPath });
    expect(statSync(launchPath).size).toBeGreaterThan(10_000);
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();

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

    const closedPath = resolve(EVIDENCE_DIR, "03-hud-closed.png");
    await page.screenshot({ path: closedPath });
    expect(existsSync(closedPath)).toBe(true);
    expect(statSync(closedPath).size).toBeGreaterThan(10_000);
    expect(await page.locator(".hud-controls-modal.hud-modal-open").count()).toBe(0);
  });

  test("captures the constructed superhero headquarters and its functional rooms", async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto("/?seed=424242&qa=1");
    await page.waitForFunction(() => (window as unknown as HeadquartersWindow).__GIERA__?.ready === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => {
      const g = (window as unknown as HeadquartersWindow).__GIERA__!;
      return g.qa.frame >= 120 && g.world.loadedChunkCount >= 289 && g.detailedAvatars.ready &&
        g.world.decor.children.some((group) => group.name === "ground-decor");
    }, null, { timeout: 60_000 });

    await page.evaluate(() => {
      const g = (window as unknown as HeadquartersWindow).__GIERA__!;
      g.tycoon.addStars(270);
      for (let stage = 0; stage < 6; stage++) g.tycoon.buyExpansion(stage);
    });
    await page.waitForFunction(() => {
      const g = (window as unknown as HeadquartersWindow).__GIERA__!;
      const { x, y, z } = g.tycoon.origin;
      return g.tycoon.toJSON().expansions?.length === 6 && g.world.getBlock(x, y + 8, z) === 19;
    }, null, { timeout: 20_000 });

    const pose = async (local: { x: number; y: number; z: number }, yaw: number, pitch: number): Promise<number> => {
      return page.evaluate(({ at, heading, tilt }) => {
        const g = (window as unknown as HeadquartersWindow).__GIERA__!;
        const origin = g.tycoon.origin;
        g.qa.pauseAt = undefined;
        g.qa.paused = false;
        g.player.position.set(origin.x + at.x, origin.y + at.y, origin.z + at.z);
        g.player.velocity.set(0, 0, 0);
        g.player.yaw = heading;
        g.player.pitch = tilt;
        g.player.syncAvatar();
        return g.qa.frame;
      }, { at: local, heading: yaw, tilt: pitch });
    };

    const snap = async (name: string): Promise<void> => {
      await page.evaluate(() => {
        (window as unknown as HeadquartersWindow).__GIERA__!.qa.paused = true;
      });
      await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      const path = resolve(EVIDENCE_DIR, name);
      await page.screenshot({ path });
      expect(statSync(path).size).toBeGreaterThan(10_000);
    };

    const captureAt = async (
      name: string,
      local: { x: number; y: number; z: number },
      yaw: number,
      pitch: number,
    ): Promise<void> => {
      const frame = await pose(local, yaw, pitch);
      await page.waitForFunction((start) => (window as unknown as HeadquartersWindow).__GIERA__!.qa.frame >= (start as number) + 10, frame);
      await snap(name);
    };

    await captureAt("06-hq-exterior.png", { x: -1, y: 6, z: -12 }, Math.PI, 0.32);
    await captureAt("07-hq-command-room.png", { x: -1, y: 5.05, z: 1 }, Math.PI, 0.05);
    await captureAt("09-hq-block-lab.png", { x: -2, y: 1.05, z: 4.5 }, Math.PI, 0.08);
    await captureAt("10-hq-armory.png", { x: -3.5, y: 1.05, z: 4.5 }, Math.PI / 2, 0.08);

    await pose({ x: 0.5, y: 1.2, z: 1.5 }, 0, 0.08);
    await page.waitForFunction(() => (window as unknown as HeadquartersWindow).__GIERA__!.player.onGround, null, { timeout: 10_000 });
    await snap("08-hq-elevator.png");
    await page.evaluate(() => {
      (window as unknown as HeadquartersWindow).__GIERA__!.qa.paused = false;
    });
    await page.keyboard.down("d");
    try {
      await page.waitForFunction(() => {
        const g = (window as unknown as HeadquartersWindow).__GIERA__!;
        const relativeY = g.player.position.y - g.tycoon.origin.y;
        return relativeY > 2.5 && relativeY < 4.2;
      }, null, { timeout: 8_000 });
    } finally {
      await page.keyboard.up("d");
    }
    expect(errors).toEqual([]);
  });
});
