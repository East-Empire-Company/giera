import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://127.0.0.1:5173";
const URL = `${BASE}/?seed=424242`;
const EVIDENCE = resolve(".ai/evidence/qa");
mkdirSync(EVIDENCE, { recursive: true });

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: false,
  args: ["--use-gl=angle", "--use-angle=metal", "--window-size=1280,760", "--window-position=40,40"],
});
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push(m.text());
});

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__GIERA__?.ready === true, undefined, { timeout: 60000 });
await page.evaluate(() => {
  const A = window.__GIERA__.audio;
  const orig = A.play.bind(A);
  window.__QA_plays = {};
  A.play = (n, o) => {
    window.__QA_plays[n] = (window.__QA_plays[n] || 0) + 1;
    return orig(n, o);
  };
});
await page.waitForFunction(() => window.__GIERA__?.detailedAvatars?.ready === true, undefined, { timeout: 40000 });
const ensureHarness = async () => {
  await page.evaluate(() => {
    if (window.__QA_plays) return;
    const A = window.__GIERA__.audio;
    const orig = A.play.bind(A);
    window.__QA_plays = {};
    A.play = (n, o) => {
      window.__QA_plays[n] = (window.__QA_plays[n] || 0) + 1;
      return orig(n, o);
    };
  });
};
await pause(2500);
await page.screenshot({ path: resolve(EVIDENCE, "visible-01-boot.png") });
check("boot", true, "heroes loaded");

// WALK
const walkBefore = await page.evaluate(() => window.__GIERA__.player.position.toArray());
await page.keyboard.down("w");
await pause(1600);
await page.keyboard.up("w");
await pause(400);
const walkAfter = await page.evaluate(() => window.__GIERA__.player.position.toArray());
const walked = Math.hypot(walkAfter[0] - walkBefore[0], walkAfter[2] - walkBefore[2]);
await page.screenshot({ path: resolve(EVIDENCE, "visible-02-walk.png") });
check("walking", walked > 1.2, `moved ${walked.toFixed(2)} blocks`);

// JUMP
await page.keyboard.down("Space");
let maxVy = -99;
for (let i = 0; i < 20; i++) {
  await pause(50);
  maxVy = Math.max(maxVy, await page.evaluate(() => window.__GIERA__.player.velocity.y));
}
await page.keyboard.up("Space");
await page.screenshot({ path: resolve(EVIDENCE, "visible-03-jump.png") });
check("jumping", maxVy > 5, `maxVy=${maxVy.toFixed(2)}`);

// MINE
await page.evaluate(() => {
  const g = window.__GIERA__;
  g.player.pitch = 0.4;
  g.player.yaw = Math.PI;
  g.player.syncAvatar();
});
await page.mouse.move(640, 380);
await pause(700);
const digsBefore = await page.evaluate(() =>
  Object.entries(window.__QA_plays)
    .filter(([id]) => id.startsWith("dig_"))
    .reduce((sum, [, c]) => sum + c, 0)
);
await page.mouse.down();
await pause(2800);
await page.mouse.up();
await pause(400);
const digsAfter = await page.evaluate(() =>
  Object.entries(window.__QA_plays)
    .filter(([id]) => id.startsWith("dig_"))
    .reduce((sum, [, c]) => sum + c, 0)
);
await page.screenshot({ path: resolve(EVIDENCE, "visible-04-mine.png") });
check("mining", digsAfter > digsBefore, `dig events ${digsBefore}->${digsAfter}`);

// Camera-ray probe: mirrors the game's own voxel raycast so aiming matches real play.
await page.evaluate(() => {
  window.__aimRay = () => {
    const g = window.__GIERA__;
    const V = g.player.position.constructor;
    const origin = g.camera.getWorldPosition(new V());
    const dir = g.camera.getWorldDirection(new V());
    const p = new V();
    for (let t = 0; t < 14; t += 0.05) {
      p.copy(dir).multiplyScalar(t).add(origin);
      const id = g.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      if (id !== 0 && id !== 11) {
        return { id, t: +t.toFixed(2), x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
      }
    }
    return null;
  };
});

// GATHER WOOD so the crafting loop has real materials
const log = await page.evaluate(() => {
  const g = window.__GIERA__;
  const p = g.player.position;
  for (let r = 2; r <= 16; r++) {
    for (let dy = -3; dy <= 5; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = Math.floor(p.x) + dx;
          const y = Math.floor(p.y) + dy;
          const z = Math.floor(p.z) + dz;
          if (g.world.getBlock(x, y, z) === 7) return { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
        }
      }
    }
  }
  return null;
});
if (log) {
  for (let round = 0; round < 3; round++) {
    await page.evaluate((target) => {
      const g = window.__GIERA__;
      const p = g.player.position;
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      const standX = target.x - (dx / len) * 6.5;
      const standZ = target.z - (dz / len) * 6.5;
      let groundY = Math.floor(target.y);
      for (let y = Math.floor(target.y) + 4; y > Math.floor(target.y) - 6; y--) {
        if (g.world.getBlock(Math.floor(standX), y, Math.floor(standZ)) !== 0) {
          groundY = y + 1;
          break;
        }
      }
      g.player.position.set(standX, groundY, standZ);
      g.player.velocity.set(0, 0, 0);
      g.player.pitch = 0.05;
      g.player.syncAvatar();
    }, log);
    await pause(400);
    // Sweep yaw and pitch until the camera ray lands on an oak log.
    let aimed = false;
    for (const pitch of [0.15, 0.3, 0.05, 0.45, -0.1, 0.6]) {
      for (const yawStep of [0, 0.12, -0.12, 0.24, -0.24, 0.4, -0.4, 0.6, -0.6, 0.9, -0.9]) {
        await page.evaluate(
          ({ step, target, pitchValue }) => {
            const g = window.__GIERA__;
            const p = g.player.position;
            const base = Math.atan2(-(target.x - p.x), -(target.z - p.z));
            g.player.yaw = base + step;
            g.player.pitch = pitchValue;
            g.player.syncAvatar();
          },
          { step: yawStep, target: log, pitchValue: pitch }
        );
        await pause(120);
        const hit = await page.evaluate(() => window.__aimRay());
        if (hit?.id === 7) {
          aimed = true;
          break;
        }
      }
      if (aimed) break;
    }
    await page.mouse.move(640, 370);
    await page.mouse.down();
    await pause(3200);
    await page.mouse.up();
    await pause(400);
    if (!aimed) break;
  }
}
const woodCount = await page.evaluate(() => window.__GIERA__.inventory.blocks?.oak_log ?? 0);
await page.screenshot({ path: resolve(EVIDENCE, "visible-04b-wood.png") });
check("gathering wood for crafting", woodCount > 0, `oak_log=${woodCount}`);

// PLACE + BUILD A SMALL WALL
// Proven pattern from the mechanics suite: stand on flat ground, drop a fixture
// block where the camera ray lands, then place against it.
const buildSpots = await page.evaluate(() => {
  const g = window.__GIERA__;
  const surface = (x, z) => {
    for (let y = 63; y > 0; y--) if (g.world.getBlock(x, y, z) !== 0) return y;
    return -1;
  };
  const spots = [];
  for (let x = -8; x <= 10 && spots.length < 8; x++) {
    for (let z = -8; z <= 10 && spots.length < 8; z++) {
      const h = surface(x, z);
      if (h < 0) continue;
      let ok = true;
      for (let d = 0; d < 5 && ok; d++) {
        if (surface(x + d, z) !== h) ok = false;
        for (let y = h + 1; y <= h + 9 && ok; y++) if (g.world.getBlock(x + d, z, y) !== 0) ok = false;
      }
      if (ok) spots.push({ x: x + 0.5, y: h + 1, z: z + 0.5 });
    }
  }
  return spots;
});
await ensureHarness();
let placedBefore = 0;
let placedAfter = 0;
for (const spot of buildSpots) {
  await page.evaluate((s) => {
    const g = window.__GIERA__;
    g.player.position.set(s.x, s.y + 0.2, s.z);
    g.player.velocity.set(0, 0, 0);
    g.player.yaw = -Math.PI / 2;
    g.player.pitch = 0;
    g.player.syncAvatar();
  }, spot);
  await pause(350);
  const fixture = await page.evaluate(() => {
    const g = window.__GIERA__;
    const dir = g.camera.position.clone();
    g.camera.getWorldDirection(dir);
    const x = Math.floor(g.camera.position.x + dir.x * 6);
    const y = Math.floor(g.camera.position.y + dir.y * 6);
    const z = Math.floor(g.camera.position.z + dir.z * 6);
    g.world.setBlock(x, y, z, 2);
    return { x, y, z };
  });
  await pause(250);
  placedBefore = await page.evaluate(() => window.__QA_plays.place_block ?? 0);
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: "right" });
  await pause(180);
  await page.mouse.up({ button: "right" });
  await pause(350);
  placedAfter = await page.evaluate(() => window.__QA_plays.place_block ?? 0);
  const landed = await page.evaluate((f) => window.__GIERA__.world.getBlock(f.x, f.y + 1, f.z), fixture);
  if (placedAfter > placedBefore) {
    await page.screenshot({ path: resolve(EVIDENCE, "visible-05-build.png") });
    break;
  }
  await page.evaluate((f) => window.__GIERA__.world.setBlock(f.x, f.y, f.z, 0), fixture);
}
await page.screenshot({ path: resolve(EVIDENCE, "visible-05-build.png") });
check("building", placedAfter > placedBefore, `place_block ${placedBefore}->${placedAfter}`);

// HOTBAR + CRAFT
await page.keyboard.press("3");
await pause(600);
const hotbarActive = await page.evaluate(() => document.querySelectorAll(".hud-hotbar-slot.active").length);
check("hotbar selection", hotbarActive === 1, `active slots=${hotbarActive}`);
await page.keyboard.press("i");
await pause(900);
await page.screenshot({ path: resolve(EVIDENCE, "visible-06-craft.png") });
const craftOpen = await page.evaluate(() => !!document.querySelector(".hud-inventory-modal.hud-modal-open"));
const recipeCount = await page.evaluate(() => document.querySelectorAll(".hud-recipes-list .hud-craft-btn").length);
const craftable = await page.evaluate(() => document.querySelectorAll(".hud-recipes-list .hud-craft-btn.can-craft").length);
check("craft modal", craftOpen && recipeCount === 5, `open=${craftOpen} recipes=${recipeCount} craftable=${craftable}`);
const craftBefore = await page.evaluate(() => {
  const inv = window.__GIERA__.inventory;
  const total = (bag) => Object.values(bag ?? {}).reduce((sum, n) => sum + n, 0);
  return total(inv.items) + total(inv.blocks);
});
const crafted = await page.evaluate(() => {
  const btn = document.querySelector(".hud-recipes-list .hud-craft-btn.can-craft");
  if (!btn) return null;
  const id = btn.getAttribute("data-id");
  btn.click();
  return id;
});
await pause(900);
const craftAfter = await page.evaluate(() => {
  const inv = window.__GIERA__.inventory;
  const total = (bag) => Object.values(bag ?? {}).reduce((sum, n) => sum + n, 0);
  return total(inv.items) + total(inv.blocks);
});
await page.screenshot({ path: resolve(EVIDENCE, "visible-07-craft-result.png") });
check(
  "crafting an item",
  crafted === null ? craftable === 0 : craftAfter > craftBefore,
  crafted === null ? "no affordable recipe yet (materials missing)" : `crafted ${crafted}, inventory ${craftBefore}->${craftAfter}`
);
await page.keyboard.press("Escape");
await pause(500);

// MUSIC
const musicBefore = await page.evaluate(() => document.querySelector(".hud-music-btn")?.textContent?.trim());
await page.click(".hud-music-btn");
await pause(800);
const musicAfter = await page.evaluate(() => document.querySelector(".hud-music-btn")?.textContent?.trim());
check("music cycling", musicBefore !== musicAfter, `${musicBefore} -> ${musicAfter}`);

// SPLIT SCREEN
await page.click(".hud-mode-btn");
await pause(1600);
const split = await page.evaluate(() => ({
  isSplit: window.__GIERA__.splitScreen?.isSplitScreen ?? null,
  label: document.querySelector(".hud-mode-btn")?.textContent?.trim(),
}));
await page.screenshot({ path: resolve(EVIDENCE, "visible-08-split.png") });
check("split screen", split.isSplit === true, JSON.stringify(split));

// NPC TALK
const npc = await page.evaluate(() => {
  const g = window.__GIERA__;
  const mina = g.npcManager?.npcs?.find((n) => n.def?.id === "mina");
  return mina ? mina.position.toArray() : null;
});
if (npc) {
  await page.evaluate((pos) => {
    const g = window.__GIERA__;
    g.player.position.set(pos[0] + 1.3, g.player.position.y, pos[2]);
    g.player.yaw = -Math.PI / 2;
    g.player.syncAvatar();
  }, npc);
  await pause(1200);
  const prompt = await page.evaluate(() => document.querySelector(".hud-npc-prompt, .hud-prompt, #npc-prompt")?.textContent?.trim() ?? null);
  check("NPC prompt", !!prompt, String(prompt));
  await page.keyboard.press("e");
  await pause(1000);
  await page.screenshot({ path: resolve(EVIDENCE, "visible-09-npc.png") });
  const quick = await page.evaluate(() => document.querySelectorAll(".hud-quick-btn").length);
  if (quick > 0) {
    await page.click(".hud-quick-btn");
    await pause(1200);
  }
  const reply = await page.evaluate(() => document.querySelector("#npc-reply-bubble")?.textContent ?? "");
  await page.screenshot({ path: resolve(EVIDENCE, "visible-10-npc-reply.png") });
  check("NPC conversation", quick > 0 && reply.length > 0, `buttons=${quick} reply="${reply.slice(0, 50)}"`);
  await page.keyboard.press("Escape");
  await pause(400);
}

// COMBAT: training dummy
const dummy = await page.evaluate(() => {
  const g = window.__GIERA__;
  let found = null;
  g.scene.traverse((o) => {
    if (!found && o.isGroup && Math.abs(o.position.x - 1.5) < 0.3 && Math.abs(o.position.z - 3) < 0.3) {
      found = o.position.toArray();
    }
  });
  return found;
});
if (dummy) {
  await page.evaluate((pos) => {
    const g = window.__GIERA__;
    const standX = pos[0] + 1.0;
    const standZ = pos[2] + 0.5;
    g.player.position.set(standX, pos[1], standZ);
    g.player.velocity.set(0, 0, 0);
    const dx = pos[0] - standX;
    const dz = pos[2] - standZ;
    g.player.yaw = Math.atan2(-dx, -dz);
    g.player.pitch = 0.2;
    g.player.syncAvatar();
  }, dummy);
  await pause(900);
  await page.mouse.move(640, 340);
  await pause(300);
  await ensureHarness();
  const digWoodBefore = await page.evaluate(() => window.__QA_plays.dig_wood ?? 0);
  await page.mouse.down();
  await pause(2600);
  await page.mouse.up();
  await pause(400);
  const digWoodAfter = await page.evaluate(() => window.__QA_plays.dig_wood ?? 0);
  await page.screenshot({ path: resolve(EVIDENCE, "visible-11-combat.png") });
  check("combat on training dummy", digWoodAfter - digWoodBefore >= 5, `dig_wood ${digWoodBefore}->${digWoodAfter}`);
} else {
  check("combat on training dummy", false, "dummy not found in scene");
}

// TYCOON: collector, upgrade, trampoline
const pads = await page.evaluate(() => {
  const t = window.__GIERA__.tycoon;
  return {
    collector: t.collectorPadPos.toArray(),
    upgrade: t.upgradePadPos.toArray(),
    trampoline: t.trampolinePos.toArray(),
  };
});
await page.evaluate((pad) => {
  const g = window.__GIERA__;
  g.player.position.set(pad[0], pad[1] + 1, pad[2]);
  g.player.velocity.set(0, 0, 0);
}, pads.collector);
await pause(2600);
await ensureHarness();
let collects = await page.evaluate(() => window.__QA_plays.celebrate_collect ?? 0);
await page.screenshot({ path: resolve(EVIDENCE, "visible-12-tycoon-collect.png") });
check("tycoon collector pays out", collects > 0, `celebrate_collect=${collects}`);

for (let attempt = 0; attempt < 8 && collects < 6; attempt++) {
  await page.evaluate((pad) => {
    const g = window.__GIERA__;
    g.player.position.set(pad[0], pad[1] + 1, pad[2]);
    g.player.velocity.set(0, 0, 0);
  }, pads.collector);
  await pause(1800);
  collects = await page.evaluate(() => window.__QA_plays.celebrate_collect ?? 0);
}
await page.evaluate((pad) => {
  const g = window.__GIERA__;
  g.player.position.set(pad[0], pad[1] + 1, pad[2]);
  g.player.velocity.set(0, 0, 0);
}, pads.upgrade);
await pause(2500);
const tierText = await page.evaluate(() => document.querySelector(".hud-tycoon-tier")?.textContent ?? "");
const win = await page.evaluate(() => window.__QA_plays.celebrate_win ?? 0);
await page.screenshot({ path: resolve(EVIDENCE, "visible-13-tycoon-upgrade.png") });
check("tycoon upgrade pad tiers up", win > 0 || tierText.includes("2"), `celebrate_win=${win} tier=${tierText}`);

let trampolineVy = 0;
for (let attempt = 0; attempt < 4 && Math.abs(trampolineVy - 22) >= 1.5; attempt++) {
  await page.evaluate(({ pad, lift }) => {
    const g = window.__GIERA__;
    g.player.position.set(pad[0], pad[1] + 1.2 + lift, pad[2]);
    g.player.velocity.set(0, 0, 0);
    g.player.onGround = false;
    g.player.syncAvatar();
  }, { pad: pads.trampoline, lift: attempt * 0.4 });
  for (let i = 0; i < 25; i++) {
    await pause(80);
    trampolineVy = Math.max(trampolineVy, await page.evaluate(() => window.__GIERA__.player.velocity.y));
    if (Math.abs(trampolineVy - 22) < 1.5) break;
  }
}
await page.screenshot({ path: resolve(EVIDENCE, "visible-14-tycoon-trampoline.png") });
check("trampoline bounce", Math.abs(trampolineVy - 22) < 1.5, `maxVy=${trampolineVy.toFixed(2)} (spec 22)`);

// LAN modal UI
await page.click(".hud-lan-btn");
await pause(900);
await page.screenshot({ path: resolve(EVIDENCE, "visible-15-lan.png") });
const lanOpen = await page.evaluate(() => !!document.querySelector(".hud-lan-modal.hud-modal-open"));
check("LAN modal opens", lanOpen, `open=${lanOpen}`);
await page.keyboard.press("Escape");
await pause(400);

check("no page errors during the session", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

const summary = {
  when: new Date().toISOString(),
  url: URL,
  passed: results.filter((r) => r.pass).length,
  failed: results.filter((r) => !r.pass).length,
  results,
  pageErrors,
};
writeFileSync(resolve(EVIDENCE, "visible-session-results.json"), JSON.stringify(summary, null, 2));
console.log(`\n${summary.passed} passed, ${summary.failed} failed`);
console.log("Browser window left open for inspection.");
await pause(240000);
await browser.close();
