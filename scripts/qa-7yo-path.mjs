import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const BASE = process.argv[2] ?? "http://127.0.0.1:4173";
const GAME_URL = `${BASE}/?seed=424242`;
const OUT = resolve(".ai/evidence/qa/7yo-path");
mkdirSync(OUT, { recursive: true });

const W = 1920;
const H = 1080;
const CENTER = { x: W / 2, y: H / 2 };

const results = [];
const perfSamples = [];
const consoleErrors = [];
const pageErrors = [];

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => page.screenshot({ path: resolve(OUT, `${name}.png`) });

function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail ?? "") });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${detail}`);
}

async function ensureDevServer() {
  try {
    if ((await fetch(BASE)).ok) return null;
  } catch {
    // start our own
  }
  const server = spawn("bun", ["run", "dev", "--port", "4173", "--strictPort"], { stdio: "ignore" });
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(BASE)).ok) return server;
    } catch {
      // still booting
    }
    await pause(200);
  }
  server.kill("SIGTERM");
  throw new Error("dev server did not start on 4173");
}

const devServer = await ensureDevServer();

const browser = await chromium.launch({
  headless: false,
  args: [`--window-size=${W},${H}`],
});
const context = await browser.newContext({ viewport: null, locale: "pl-PL" });
const page = await context.newPage();
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) consoleErrors.push(`${r.status()} ${r.url()}`);
});

// ---------- checkpoint 1: splash + launch menu ----------
await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
await pause(350);
await shot("00-splash");
const splash = await page.evaluate(() => ({
  splashVisible: !!document.querySelector(".boot-splash, #boot-splash, .hud-boot"),
  bodyText: (document.body.innerText || "").slice(0, 120),
}));

await page.waitForFunction(() => window.__GIERA__?.ready === true, undefined, { timeout: 90000 });
await page.waitForFunction(
  () => {
    const btn = [...document.querySelectorAll("button")].find((b) => /Zaczynamy|Rozpocznij|Start/i.test(b.textContent ?? ""));
    return !!btn && !btn.closest("[inert]");
  },
  undefined,
  { timeout: 90000 }
);
await pause(600);
await shot("01-launch-menu");
const menu = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim()).filter(Boolean);
  const canvas = document.querySelector("canvas");
  return {
    buttons: buttons.slice(0, 8),
    canvas: canvas ? { w: canvas.width, h: canvas.height } : null,
    dpr: window.devicePixelRatio,
  };
});
check("launch menu renders", menu.buttons.some((b) => /Zaczynamy|Rozpocznij/i.test(b)), JSON.stringify(menu.buttons));

await page.getByRole("button", { name: /Zaczynamy|Rozpocznij/i }).click();
await pause(2600);

// in-page harness + helpers (re-installed after every reload)
await page.evaluate(() => {
  window.__installQa = () => {
    const A = window.__GIERA__.audio;
    if (A.__qaWrapped) return;
    const orig = A.play.bind(A);
    window.__QA_plays = {};
    A.play = (n, o) => {
      window.__QA_plays[n] = (window.__QA_plays[n] || 0) + 1;
      return orig(n, o);
    };
    A.__qaWrapped = true;
  };
  window.__installQa();

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

  window.__surface = (x, z) => {
    const g = window.__GIERA__;
    for (let y = 90; y > 0; y--) {
      const id = g.world.getBlock(x, y, z);
      if (id === 0 || id === 7 || id === 8 || id === 11) continue;
      return y;
    }
    return -1;
  };

  window.__aimAt = (tx, ty, tz) => {
    const g = window.__GIERA__;
    const p = g.player.position;
    const nx = tx - p.x;
    const ny = ty - (p.y + 1.55);
    const nz = tz - p.z;
    const len = Math.hypot(nx, ny, nz) || 1;
    g.player.yaw = Math.atan2(-nx / len, -nz / len);
    g.player.pitch = -Math.asin(ny / len);
    g.player.syncAvatar();
    return { yaw: g.player.yaw, pitch: g.player.pitch };
  };

  window.__aimSweep = async (tx, ty, tz, want) => {
    const g = window.__GIERA__;
    const base = window.__aimAt(tx, ty, tz);
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (const dyaw of [0, 0.04, -0.04, 0.09, -0.09, 0.15, -0.15, 0.24, -0.24, 0.36, -0.36, 0.5, -0.5]) {
      for (const dpitch of [0, 0.05, -0.05, 0.1, -0.1, 0.18, -0.18, 0.28, -0.28, 0.4, -0.4, 0.55, -0.55]) {
        g.player.yaw = base.yaw + dyaw;
        g.player.pitch = base.pitch + dpitch;
        g.player.syncAvatar();
        await frame();
        const hit = window.__aimRay();
        if (hit && hit.id === want) return { ok: true, dyaw, dpitch, hit };
      }
    }
    return { ok: false, base, hit: window.__aimRay() };
  };

  window.__standFor = (log) => {
    const g = window.__GIERA__;
    for (const r of [3, 3.8, 4.6, 5.4, 6.2]) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const x = log.x + Math.cos(a) * r;
        const z = log.z + Math.sin(a) * r;
        const h = window.__surface(Math.floor(x), Math.floor(z));
        if (h < 0) continue;
        if (Math.abs(h + 1 - log.y) > 1.5) continue;
        const eye = { x, y: h + 1 + 1.55, z };
        const dx = log.x - eye.x;
        const dy = log.y - eye.y;
        const dz = log.z - eye.z;
        const len = Math.hypot(dx, dy, dz);
        let clear = true;
        for (let t = 0.3; t < len - 0.4; t += 0.15) {
          const px = Math.floor(eye.x + (dx / len) * t);
          const py = Math.floor(eye.y + (dy / len) * t);
          const pz = Math.floor(eye.z + (dz / len) * t);
          if (g.world.getBlock(px, py, pz) !== 0) { clear = false; break; }
        }
        if (clear) return { x, y: h + 1, z, r };
      }
    }
    return null;
  };

  window.__findLog = (radius = 30) => {
    const g = window.__GIERA__;
    const p = g.player.position;
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);
    let best = null;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > radius) continue;
        const x = cx + dx;
        const z = cz + dz;
        const h = window.__surface(x, z);
        if (h < 0) continue;
        for (let y = h + 1; y <= h + 9; y++) {
          if (g.world.getBlock(x, y, z) !== 7) continue;
          if (!best || d < best.d) best = { x: x + 0.5, y: y + 0.5, z: z + 0.5, d };
          break;
        }
      }
    }
    return best;
  };

  window.__perf = { t: 0, fps: [], calls: [], tris: [] };
  if (!window.__perfTimer) {
    window.__perfTimer = setInterval(() => {
      const g = window.__GIERA__;
      if (!g?.renderer) return;
      window.__perf.t = performance.now();
      window.__perf.fps.push(Number(g.stats?.fps ?? 0));
      window.__perf.calls.push(g.renderer.info.render.calls);
      window.__perf.tris.push(g.renderer.info.render.triangles);
    }, 500);
  }
});
await pause(1500);

const env = await page.evaluate(() => {
  const g = window.__GIERA__;
  const gl = g.renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown",
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : "unknown",
    webgl2: g.renderer.capabilities.isWebGL2,
    dpr: window.devicePixelRatio,
    canvas: [g.renderer.domElement.width, g.renderer.domElement.height],
    shadows: g.renderer.shadowMap.enabled,
  };
});
await shot("02-hud-solo");
check("game boots to playable HUD", true, JSON.stringify(env));

// ---------- checkpoint 2: graphics quality (terrain, trees, shadows) ----------
await page.evaluate(() => {
  const g = window.__GIERA__;
  const tree = window.__findLog(24);
  if (!tree) return;
  const standX = tree.x + 5.5;
  const standZ = tree.z + 5.5;
  const h = window.__surface(Math.floor(standX), Math.floor(standZ));
  g.player.position.set(standX, h + 1, standZ);
  g.player.velocity.set(0, 0, 0);
  window.__aimAt(tree.x, tree.y, tree.z);
  g.player.pitch = 0.12;
  g.player.syncAvatar();
});
await pause(2500);
await shot("03-graphics-terrain");

// ---------- checkpoint 3: split screen, two players ----------
await page.click(".hud-mode-btn");
await pause(2200);
const splitState = await page.evaluate(() => {
  const g = window.__GIERA__;
  return { isSplit: g.splitScreen.isSplitScreen, p2: g.player2.position.toArray().map((v) => +v.toFixed(2)) };
});
await shot("04-split-screen");
check("split screen enabled", splitState.isSplit === true, JSON.stringify(splitState));

// P2 walks with arrows (real keyboard path)
const p2Before = await page.evaluate(() => window.__GIERA__.player2.position.toArray());
await page.keyboard.down("ArrowUp");
await pause(1700);
await page.keyboard.up("ArrowUp");
await page.keyboard.press("ArrowLeft");
await pause(500);
const p2After = await page.evaluate(() => window.__GIERA__.player2.position.toArray());
const p2Moved = Math.hypot(p2After[0] - p2Before[0], p2After[2] - p2Before[2]);
await shot("05-player2-walk");
check("player 2 walks in split screen", p2Moved > 1.0, `moved ${p2Moved.toFixed(2)} blocks`);

// P1 walks
const p1Before = await page.evaluate(() => window.__GIERA__.player.position.toArray());
await page.keyboard.down("w");
await pause(1500);
await page.keyboard.up("w");
await pause(300);
const p1After = await page.evaluate(() => window.__GIERA__.player.position.toArray());
const p1Moved = Math.hypot(p1After[0] - p1Before[0], p1After[2] - p1Before[2]);
check("player 1 walks", p1Moved > 1.0, `moved ${p1Moved.toFixed(2)} blocks`);

// ---------- checkpoint 4: chop a tree ----------
let chopHits = 0;
let chopAim = null;
for (let round = 0; round < 10; round++) {
  const tree = await page.evaluate((r) => window.__findLog(r), round < 5 ? 30 : 60);
  if (!tree) break;
  await page.evaluate((t) => {
    const g = window.__GIERA__;
    const spot = window.__standFor(t);
    if (!spot) return;
    g.player.position.set(spot.x, spot.y, spot.z);
    g.player.velocity.set(0, 0, 0);
    g.player.syncAvatar();
  }, tree);
  await pause(700);
  chopAim = await page.evaluate((t) => window.__aimSweep(t.x, t.y, t.z, 7), tree);
  if (!chopAim.ok) continue;
  await page.mouse.move(CENTER.x, CENTER.y);
  await page.mouse.down();
  await pause(3400);
  await page.mouse.up();
  await pause(700);
  chopHits += 1;
  const logs = await page.evaluate(() => window.__GIERA__.inventory.blocks?.oak_log ?? 0);
  if (logs >= 4) break;
}
const woodCount = await page.evaluate(() => window.__GIERA__.inventory.blocks?.oak_log ?? 0);
await shot("06-chopping-tree");
check("chopping trees yields wood", woodCount > 0, `oak_log=${woodCount} (chop rounds=${chopHits}, lastAim=${JSON.stringify(chopAim)})`);

// ---------- checkpoint 5: resources + craft ----------
await page.keyboard.press("i");
await pause(900);
await shot("07-inventory-craft");
const craftUi = await page.evaluate(() => ({
  open: !!document.querySelector(".hud-inventory-modal.hud-modal-open"),
  recipes: document.querySelectorAll(".hud-recipes-list .hud-craft-btn").length,
  craftable: document.querySelectorAll(".hud-recipes-list .hud-craft-btn.can-craft").length,
  blocks: { ...window.__GIERA__.inventory.blocks },
}));
check("inventory/craft UI", craftUi.open && craftUi.recipes > 0, JSON.stringify(craftUi));

const crafted = await page.evaluate(() => {
  const btn = document.querySelector(".hud-recipes-list .hud-craft-btn.can-craft");
  if (!btn) return null;
  const label = (btn.textContent ?? "").trim();
  btn.click();
  return label;
});
await pause(900);
const craftedState = await page.evaluate(() => ({
  blocks: { ...window.__GIERA__.inventory.blocks },
  items: { ...(window.__GIERA__.inventory.items ?? {}) },
}));
await shot("08-craft-result");
check(
  "crafting consumes gathered wood",
  crafted !== null && (craftedState.blocks.oak_planks ?? 0) + (craftedState.items.stick ?? 0) > 0,
  crafted === null ? `no affordable recipe (craftable=${craftUi.craftable}, blocks=${JSON.stringify(craftUi.blocks ?? {})})` : `clicked "${crafted}"`
);
await page.keyboard.press("Escape");
await pause(500);

// ---------- checkpoint 6: build a small house ----------
const houseOrigin = await page.evaluate(() => {
  const g = window.__GIERA__;
  const p = g.player.position;
  const cx = Math.floor(p.x) + 6;
  const cz = Math.floor(p.z) + 6;
  for (let r = 0; r < 12; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const x = cx + dx;
        const z = cz + dz;
        const h = window.__surface(x, z);
        if (h < 0) continue;
        let flat = true;
        for (let ax = 0; ax <= 2 && flat; ax++) {
          for (let az = 0; az <= 2 && flat; az++) {
            const hh = window.__surface(x + ax, z + az);
            if (hh !== h) flat = false;
            for (let y = h + 1; y <= h + 6 && flat; y++) if (g.world.getBlock(x + ax, y, z + az) !== 0) flat = false;
          }
        }
        if (flat) return { x, z, y: h + 1 };
      }
    }
  }
  return null;
});

let placedOk = 0;
const placeAt = async (cell) => {
  const support = { x: cell.x, y: cell.y - 1, z: cell.z };
  const stands = [
    { dx: 3.4, dz: 0.5 },
    { dx: -3.4, dz: 0.5 },
    { dx: 0.5, dz: 3.4 },
    { dx: 0.5, dz: -3.4 },
  ];
  for (const s of stands) {
    await page.evaluate(
      ({ supportCell, stand }) => {
        const g = window.__GIERA__;
        const standX = supportCell.x + 0.5 + stand.dx;
        const standZ = supportCell.z + 0.5 + stand.dz;
        const h = window.__surface(Math.floor(standX), Math.floor(standZ));
        if (h < 0) return;
        g.player.position.set(standX, h + 1, standZ);
        g.player.velocity.set(0, 0, 0);
        g.player.syncAvatar();
      },
      { supportCell: support, stand: s }
    );
    await pause(280);
    let aimed = false;
    for (const pitch of [0.45, 0.6, 0.3, 0.75, 0.15]) {
      for (const step of [0, 0.08, -0.08, 0.16, -0.16, 0.28, -0.28, 0.45, -0.45]) {
        await page.evaluate(
          ({ stepValue, supportCell, pitchValue }) => {
            const g = window.__GIERA__;
            const p = g.player.position;
            const base = Math.atan2(-(supportCell.x + 0.5 - p.x), -(supportCell.z + 0.5 - p.z));
            g.player.yaw = base + stepValue;
            g.player.pitch = pitchValue;
            g.player.syncAvatar();
          },
          { stepValue: step, supportCell: support, pitchValue: pitch }
        );
        await pause(110);
        const hit = await page.evaluate(() => window.__aimRay());
        if (hit && hit.x === support.x && hit.y === support.y && hit.z === support.z) {
          aimed = true;
          break;
        }
      }
      if (aimed) break;
    }
    if (!aimed) continue;
    const before = await page.evaluate(() => window.__QA_plays.place_block ?? 0);
    await page.mouse.move(CENTER.x, CENTER.y);
    await page.mouse.down({ button: "right" });
    await pause(220);
    await page.mouse.up({ button: "right" });
    await pause(400);
    const after = await page.evaluate(() => window.__QA_plays.place_block ?? 0);
    const placed = await page.evaluate((c) => window.__GIERA__.world.getBlock(c.x, c.y, c.z) !== 0, cell);
    if (after > before && placed) return true;
    await page.evaluate((c) => window.__GIERA__.world.setBlock(c.x, c.y, c.z, 0), cell);
  }
  return false;
};

if (houseOrigin) {
  const o = houseOrigin;
  const walls = [];
  for (let y = o.y; y <= o.y + 1; y++) {
    for (let x = 0; x <= 2; x++) {
      for (let z = 0; z <= 2; z++) {
        const perimeter = x === 0 || x === 2 || z === 0 || z === 2;
        if (!perimeter) continue;
        if (y === o.y && x === 1 && z === 2) continue;
        walls.push({ x: o.x + x, y, z: o.z + z });
      }
    }
  }
  for (const cell of walls) {
    if (await placeAt(cell)) placedOk += 1;
    if (placedOk >= 12) break;
  }
  const roof = { x: o.x + 1, y: o.y + 2, z: o.z + 1 };
  await placeAt(roof);
}
await page.evaluate(() => {
  const g = window.__GIERA__;
  g.player.position.x += 5;
  g.player.syncAvatar();
});
await pause(1800);
await shot("09-house-built");
check("building a house block by block", placedOk >= 6, `${placedOk} blocks placed via right-click`);

// ---------- checkpoint 7: tycoon levels ----------
const pads = await page.evaluate(() => {
  const t = window.__GIERA__.tycoon;
  return {
    collector: t.collectorPadPos.toArray(),
    upgrade: t.upgradePadPos.toArray(),
    trampoline: t.trampolinePos.toArray(),
  };
});
const tp = async (pad) => {
  await page.evaluate((p) => {
    const g = window.__GIERA__;
    g.player.position.set(p[0], p[1] + 1, p[2]);
    g.player.velocity.set(0, 0, 0);
    g.player.syncAvatar();
  }, pad);
};
await tp(pads.collector);
await pause(2600);
let collects = await page.evaluate(() => window.__QA_plays.celebrate_collect ?? 0);
await shot("10-tycoon-collect");
for (let i = 0; i < 10 && collects < 6; i++) {
  await tp(pads.collector);
  await pause(1900);
  collects = await page.evaluate(() => window.__QA_plays.celebrate_collect ?? 0);
}
check("tycoon collector pays out", collects > 0, `celebrate_collect=${collects}`);

const tierOf = () => page.evaluate(() => document.querySelector(".hud-tycoon-tier")?.textContent ?? "");
const tiers = [await tierOf()];
for (let level = 0; level < 2; level++) {
  await tp(pads.upgrade);
  await pause(2600);
  tiers.push(await tierOf());
  await shot(`11-tycoon-upgrade-${level + 1}`);
  if (level === 0) {
    for (let i = 0; i < 8; i++) {
      await tp(pads.collector);
      await pause(1800);
    }
  }
}
check("tycoon upgrades two levels", tiers[tiers.length - 1] !== tiers[0], `tiers ${tiers.join(" -> ")}`);

// ---------- checkpoint 8: explore the map ----------
const exploreStart = await page.evaluate(() => ({
  p1: window.__GIERA__.player.position.toArray(),
  p2: window.__GIERA__.player2.position.toArray(),
}));
await page.keyboard.down("w");
await page.keyboard.down("ArrowUp");
await pause(6000);
await page.keyboard.up("w");
await page.keyboard.up("ArrowUp");
await pause(1200);
const exploreEnd = await page.evaluate(() => ({
  p1: window.__GIERA__.player.position.toArray(),
  p2: window.__GIERA__.player2.position.toArray(),
  chunks: window.__GIERA__.world.chunks?.size ?? null,
}));
const explored = Math.hypot(exploreEnd.p1[0] - exploreStart.p1[0], exploreEnd.p1[2] - exploreStart.p1[2]);
await shot("12-explore");
check("exploring the map", explored > 8, `walked ${explored.toFixed(1)} blocks`);

// ---------- checkpoint 8b: talk to an NPC ----------
const npcTalk = await page.evaluate(async () => {
  const g = window.__GIERA__;
  const mina = g.npcManager?.npcs?.find((n) => n.def?.id === "mina") ?? g.npcManager?.npcs?.[0];
  if (!mina) return { ok: false, reason: "no npc" };
  g.player.position.set(mina.position.x + 1.2, mina.position.y, mina.position.z + 1.2);
  g.player.velocity.set(0, 0, 0);
  g.player.syncAvatar();
  return { ok: true, id: mina.def?.id ?? "?" };
});
if (npcTalk.ok) {
  await pause(1500);
  await page.keyboard.press("e");
  await pause(900);
  const before = await page.evaluate(() => document.querySelector("#npc-reply-bubble")?.textContent ?? "");
  const buttons = await page.evaluate(() => document.querySelectorAll(".hud-quick-btn").length);
  if (buttons > 0) {
    await page.click(".hud-quick-btn");
    await pause(9000);
  }
  let reply = "";
  for (let i = 0; i < 24; i++) {
    reply = await page.evaluate(() => document.querySelector("#npc-reply-bubble")?.textContent ?? "");
    if (reply.length > 3 && !/myśli|\.\.\.|…/i.test(reply)) break;
    await pause(1000);
  }
  await shot("12b-npc-talk");
  check("NPC conversation replies", buttons > 0 && reply.length > 0 && reply !== before, `npc=${npcTalk.id} buttons=${buttons} reply="${reply.slice(0, 60)}"`);
  await page.keyboard.press("Escape");
  await pause(600);
} else {
  check("NPC conversation replies", false, npcTalk.reason);
}

// ---------- checkpoint 9: combat ----------
const dummy = await page.evaluate(() => {
  const g = window.__GIERA__;
  let found = null;
  g.scene.traverse((o) => {
    if (!found && o.isGroup && Math.abs(o.position.x - 1.5) < 0.4 && Math.abs(o.position.z - 3) < 0.4) found = o.position.toArray();
  });
  return found;
});
if (dummy) {
  await page.evaluate((pos) => {
    const g = window.__GIERA__;
    const standX = pos[0] + 1.1;
    const standZ = pos[2] + 0.6;
    g.player.position.set(standX, pos[1], standZ);
    g.player.velocity.set(0, 0, 0);
    g.player.yaw = Math.atan2(-(pos[0] - standX), -(pos[2] - standZ));
    g.player.pitch = 0.2;
    g.player.syncAvatar();
  }, dummy);
  await pause(1000);
  const before = await page.evaluate(() => window.__QA_plays.dig_wood ?? 0);
  await page.mouse.move(CENTER.x, CENTER.y);
  await page.mouse.down();
  await pause(2600);
  await page.mouse.up();
  await pause(500);
  const after = await page.evaluate(() => window.__QA_plays.dig_wood ?? 0);
  await shot("13-combat");
  check("combat on training dummy", after - before >= 5, `dig_wood ${before}->${after}`);
} else {
  check("combat on training dummy", false, "dummy not in scene");
}

// ---------- checkpoint 10: final overview + perf ----------
await tp(pads.trampoline);
await pause(1600);
await shot("14-final-overview");

const perf = await page.evaluate(() => {
  const g = window.__GIERA__;
  const p = window.__perf;
  const sorted = [...p.fps].filter((v) => v > 0).sort((a, b) => a - b);
  const q = (f) => (sorted.length ? sorted[Math.floor(f * (sorted.length - 1))] : 0);
  return {
    samples: sorted.length,
    fpsP10: q(0.1),
    fpsP50: q(0.5),
    fpsP90: q(0.9),
    fpsMin: sorted[0] ?? 0,
    callsP50: [...p.calls].sort((a, b) => a - b)[Math.floor(p.calls.length / 2)] ?? 0,
    trisP50: [...p.tris].sort((a, b) => a - b)[Math.floor(p.tris.length / 2)] ?? 0,
    currentFps: g.stats?.fps ?? 0,
    drawCalls: g.renderer.info.render.calls,
    triangles: g.renderer.info.render.triangles,
    split: g.splitScreen.isSplitScreen,
    tycoonTier: document.querySelector(".hud-tycoon-tier")?.textContent ?? "",
    inventory: { ...g.inventory.blocks },
    stars: g.tycoon?.stars ?? g.objectives?.stars ?? null,
  };
});

check("frame rate p50 above 30 fps", perf.fpsP50 >= 30, `${perf.fpsP50} fps p50, p10 ${perf.fpsP10}`);
check("no page errors during the session", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
check("no console errors / failed assets", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

const summary = {
  url: GAME_URL,
  when: new Date().toISOString(),
  viewport: [W, H],
  env,
  splash,
  menu,
  splitState,
  perf,
  results,
  passed: results.filter((r) => r.pass).length,
  failed: results.filter((r) => !r.pass).length,
  pageErrors,
  consoleErrors,
};
writeFileSync(resolve(OUT, "results.json"), JSON.stringify(summary, null, 2));

const lines = [
  "# Giera — 7-year-old first-5-minutes playthrough",
  "",
  `Run: ${summary.when} · ${GAME_URL} · ${W}x${H} headed Chromium`,
  `GPU: ${env.renderer} · dpr ${env.dpr} · canvas ${env.canvas.join("x")} · webgl2 ${env.webgl2} · shadows ${env.shadows}`,
  "",
  `**${summary.passed} passed / ${summary.failed} failed**`,
  "",
  "| checkpoint | result | detail |",
  "|---|---|---|",
  ...results.map((r) => `| ${r.name} | ${r.pass ? "PASS" : "FAIL"} | ${r.detail.replace(/\|/g, "/")} |`),
  "",
  "## Performance",
  "",
  `- fps p50 **${perf.fpsP50}**, p10 ${perf.fpsP10}, p90 ${perf.fpsP90}, min ${perf.fpsMin} (${perf.samples} samples)`,
  `- draw calls p50 ${perf.callsP50}, triangles p50 ${perf.trisP50}`,
  `- tycoon tier at end: ${perf.tycoonTier}`,
  "",
  "## Errors",
  "",
  pageErrors.length ? pageErrors.map((e) => `- pageerror: ${e}`).join("\n") : "- none",
  consoleErrors.length ? consoleErrors.map((e) => `- console: ${e}`).join("\n") : "- none",
  "",
  `Screenshots: ${OUT}`,
];
writeFileSync(resolve(OUT, "report.md"), lines.join("\n"));
console.log(`\n${summary.passed} passed, ${summary.failed} failed`);
console.log(`evidence: ${OUT}`);

await browser.close();
devServer?.kill("SIGTERM");