import { chromium } from "@playwright/test";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=metal", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (err) => errors.push(err.message));
await page.goto("http://localhost:4173/?seed=424242");
await page.waitForFunction(() => window.__GIERA__?.ready === true, null, { timeout: 60000 });
await page.waitForTimeout(2500);

// night: push the day cycle to midnight and read environment intensity
const night = await page.evaluate(async () => {
  const g = window.__GIERA__;
  const before = g.scene.environmentIntensity;
  const day = g.scene.background.getHexString();
  g.scene.environmentIntensity = 0.15;
  g.scene.background.set("#273956");
  g.renderer.render(g.scene, g.camera);
  await new Promise((r) => setTimeout(r, 300));
  return { dayEnv: before, nightEnv: g.scene.environmentIntensity, dayBg: day, nightBg: g.scene.background.getHexString() };
});
console.log("night:", JSON.stringify(night));

// mining: aim at a tree trunk and hold the mouse button
const mining = await page.evaluate(async () => {
  const g = window.__GIERA__;
  const THREE = g.scene.constructor;
  let target = null;
  for (let r = 2; r <= 10 && !target; r += 0.5) {
    for (let a = 0; a < Math.PI * 2 && !target; a += 0.25) {
      const x = Math.floor(g.player.position.x + Math.cos(a) * r);
      const z = Math.floor(g.player.position.z + Math.sin(a) * r);
      for (let y = 40; y < 70; y++) {
        if (g.world.getBlock(x, y, z) === 7) {
          target = { x, y, z };
          break;
        }
      }
    }
  }
  return target;
});
console.log("treeTarget:", JSON.stringify(mining));

if (mining) {
  const dir = await page.evaluate((t) => {
    const g = window.__GIERA__;
    const cam = g.camera;
    const target = { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 };
    const camPos = cam.position;
    const dx = target.x - camPos.x;
    const dy = target.y - camPos.y;
    const dz = target.z - camPos.z;
    const len = Math.hypot(dx, dy, dz);
    const yaw = Math.atan2(-dx / len, -dz / len);
    const pitch = Math.asin(dy / len);
    g.player.yaw = yaw;
    g.player.pitch = pitch;
    g.player.syncAvatar();
    return { yaw, pitch };
  }, mining);
  await page.waitForTimeout(600);
  const canvas = await page.$("#game");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => {
    const g = window.__GIERA__;
    const scene = g.scene;
    let crackVisible = false;
    let dropMeshes = 0;
    let dropMaterial = null;
    scene.traverse((o) => {
      if (o.isMesh && o.material?.map?.image?.src?.includes?.("crackover")) crackVisible = o.visible;
      if (o.isMesh && o.geometry?.type === "BoxGeometry" && o.geometry.parameters?.width === 0.32) {
        dropMeshes++;
        dropMaterial = o.material?.map?.image?.src?.split("/").pop() ?? "none";
      }
    });
    return {
      crackVisible,
      dropMeshes,
      dropMaterial,
      isActing: g.player.isActing,
      invWood: g.inventory.getItemCount("oak_log"),
    };
  });
  console.log("mining:", JSON.stringify(state));
  await page.mouse.up();
}
console.log("pageerrors:", JSON.stringify(errors));
await browser.close();
