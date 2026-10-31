import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=metal", "--disable-background-timer-throttling"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on("console", (m) => console.log(`[console:${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => console.log(`[requestfailed] ${r.url()} :: ${r.failure()?.errorText}`));
page.on("response", (r) => {
  if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.url()}`);
});
page.on("framenavigated", (f) => console.log(`[nav] ${f.url()}`));
page.on("crash", () => console.log("[crash] page crashed"));
page.on("close", () => console.log("[close] page closed"));

await page.goto("http://127.0.0.1:5173/?seed=424242");
await page.waitForFunction(() => window.__GIERA__?.ready === true, null, { timeout: 30000 });
console.log("--- ready ---");
console.log("sw controller:", await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return { hasReg: !!reg, controller: !!navigator.serviceWorker.controller, state: reg?.active?.state };
}));
await page.getByRole("button", { name: "Rozpocznij grę" }).click();
const edit = await page.evaluate(() => {
  const g = window.__GIERA__;
  const x = 3;
  const z = 5;
  let y = Math.floor(g.player.position.y) + 2;
  while (g.world.getBlock(x, y, z) !== 0) y++;
  g.world.setBlock(x, y, z, 10);
  window.dispatchEvent(new Event("pagehide"));
  return { x, y, z, key: `${x},${y},${z}` };
});
console.log("edit:", JSON.stringify(edit));
await page.waitForTimeout(1500);
console.log("--- saved edits:", await page.evaluate(async () => {
  const request = indexedDB.open("giera_save_db", 1);
  const db = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return await new Promise((resolve, reject) => {
    const get = db.transaction("saves", "readonly").objectStore("saves").get("last_save");
    get.onsuccess = () => resolve(get.result?.edits);
    get.onerror = () => reject(get.error);
  });
}));
console.log("--- reloading ---");
try {
  await page.reload({ waitUntil: "domcontentloaded" });
  console.log("reload ok");
} catch (error) {
  console.log("reload failed:", error.message);
}
console.log("--- final url:", page.url());
await browser.close();
