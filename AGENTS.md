# AGENTS.md — Giera

Voxel sandbox browser game for two non-reading kids (Ziemek & Gniewko). Three.js + TS + Vite, Bun tooling, Playwright E2E, k3s homelab deploy.

## Pipeline contract

`bun run pipeline` runs, fail-fast, in order:

| stage | what it gates |
|---|---|
| typecheck | `tsc --noEmit` clean |
| unit | vitest suite |
| content | every referenced asset path exists under `public/` (audio, icons, atlas, manifests) |
| build | `vite build` succeeds |
| e2e-mechanics | gameplay mechanics vs spec constants (movement, mine/place, craft, split, music, tycoon, dummy, NPC, persistence delta) |
| goldens | 3 screenshots pixel-match `tests/goldens/*.png` (threshold 0.10) |
| performance | solo/split FPS p50 / boot / draw calls / remesh budgets (`.ai/evidence/pipeline/perf.json`; host only) |
| network | two browser clients join one LAN room, exchange a block edit, server persists the room |
| quality | zero pageerrors across e2e JSON runs; dead-asset scan (warn only) |

Variants: `bun run pipeline:fast` (skips goldens + performance), `bun run goldens:init` (write baselines), `bun run accept -- --stage <stage> --reason "..."`, `bun run manual`.

Report lands in `.ai/evidence/pipeline/report.md` + `report.json`.

## Determinism rules

- No `Date.now()` / `Math.random()` in simulation code. Use `makeRng(seed)` from `src/shared/rng.ts` and accumulate sim time (`this.pulseTime += delta`).
- `?qa=1` contract: fixed 1/60 timestep, sky pinned to `elapsed = 150` (midday), `window.__GIERA__.qa.events` records audio/gameplay events, `qa.frame` counts frames. Tests wait on `qa.frame`, never on wall clock.
- Goldens freeze the sim before capture: set `qa.pauseAt = frame`, wait for `qa.paused === true`, assert `qa.frame` equals the target. Wind, NPC wander and particles are time-driven, so a moving capture point makes split-screen goldens drift (~0.15 %).
- Seeds: tests use `?seed=424242`. Worldgen is pure seeded hash noise.
- Worldgen has one current algorithm. Existing saves and rooms retain their seed and edits; generated terrain uses the current algorithm.
- Autosaves retain tycoon vault coins, collected stars, and upgrade tier.

## Test philosophy

- Exact spec values live in `tests/spec-constants.ts` (walk speed band, trampoline vy 22, upgrade cost tier×5, music label list). Tests assert those constants, never "it changed".
- Persistence tests assert real deltas (active slot, crafted item), never just "boots".
- Goldens are claims about intended look. A diff means REGRESSION unless a human accepts it.
- Playwright input only (keyboard/mouse/click) — no synthetic `dispatchEvent` for gameplay.

## Failure protocol

1. Red pipeline = fix the GAME first. Never loosen an assertion to get green.
2. Intended behavior change (new feature, accepted visual change) → `bun run accept -- --stage goldens|mechanics --reason "why"`. This refreshes the baseline/spec constants and appends to `.ai/evidence/pipeline/TRIAGE.md`. No reason → refused.
3. Rerun the failed stage, then the full pipeline.

## Evidence paths

- `.ai/evidence/pipeline/` — report.md/json, perf.json, mechanics-results.json, golden-diff/, deploy.json
- `.ai/evidence/qa/` — the original 17-row manual QA matrix evidence
- `.ai/evidence/manual/` — dated manual-checklist runs (`YYYY-MM-DD/`)

## Manual checklist

Hardware-only checks (Xbox pads, real mic STT, touch overlay, Xbox Edge fps) live in `tests/MANUAL-CHECKLIST.md`. Run `bun run manual` to boot the dev server and print the checklist path.

## Visible QA session

`bun run qa:session` opens a real browser window (headed Chromium) and plays through the loop a child would: walk, jump, mine, gather wood, place blocks, craft, cycle music, split screen, talk to an NPC, hit the training dummy, collect tycoon stars, tier up, bounce on the trampoline, open the LAN dialog. It boots its own dev server when 5173 is free, writes screenshots and `visible-session-results.json` to `.ai/evidence/qa/`, and asserts no page errors. Use it when the question is "does it actually feel right", not "does the spec still hold" — the latter is the pipeline's job.

## Render layer

Presentation only — worldgen, physics, mining, crafting, NPC logic, LAN protocol and saves stay voxel-driven.

- Block faces read three atlases built by `bun run assets:atlas` (`scripts/build-atlas.ts`): `atlas.png` (albedo, sRGB), `atlas-normal.png` (NormalGL), `atlas-orm.png` (R=AO, G=roughness). Sources are AmbientCG CC0 1K-JPG maps that `bun run assets:fetch` writes to `public/assets/textures/pbr/<id>/` (git-ignored, re-downloadable); `src/shared/atlas-manifest.json` holds the UV rects.
- Smooth-top terrain uses shared height-gradient normals across chunk borders. Terrain shaders blend grass-top and cliff-side atlas tiles by world normal; oak bark keeps its warm base palette with fine vertical grain in the shared voxel shader.
- Heroes/NPCs are KayKit CC0 GLBs in `public/assets/models/kaykit/` (Rig_Medium clip names live in `ANIM_MAP` in `src/client/entities/avatar.ts`). Decor props are Quaternius CC0 glTF in `public/assets/models/props/`.
- Environment lighting uses a Poly Haven CC0 HDR (`HDRLoader` → `PMREMGenerator` → `scene.environment`). `SkyCycle` coordinates HDR intensity, procedural sky, hemisphere fill, daylight-driven sun, and horizon-matched fog.
- Shadows use the official Three r186 `CSM` addon (`src/client/render/cascaded-shadows.ts`): 2 practical cascades at 1024², range capped at `MAX_SHADOW_DISTANCE` (128) via `shadowDistanceFor`, `PCFShadowMap` (r186 removed `PCFSoftShadowMap`; it warns and falls back; `tests/unit/shadow-map-type.test.ts` guards this). The `SkyCycle` sun is hidden and only supplies direction, colour and intensity. `PostFX` calls `prepareView(camera)` before each composer render so split-screen cascades follow each camera. CSM overwrites the global `lights_fragment_begin` chunk with a pre-r186 copy that lacks `material.dfg`/`multiScatteringCompensation`; `spliceStockPrelude` keeps Three's stock prelude and takes only CSM's directional tail, and `dispose()` restores both global chunks. Re-check this splice on every Three upgrade (it throws if the marker moves).
- Terrain chunk meshes cast shadows only within `MAX_SHADOW_CASTER_RANGE` (80 blocks) of a player (`WorldRenderer.updateShadowCasters`, refreshed on chunk crossing or split toggle, both split players count). Without this, desktop radius 20 drew ~5,400 chunks into every cascade and halved the frame rate. Xbox 60 FPS remains unverified; the pipeline perf stage loads radius 8 under a fixed 1/60 timestep and is NOT representative of desktop radius 20 or of the adaptive ladder.
- Terrain chunk meshes are bucketed by material, not by tile: all opaque tiles share one `giera-atlas-pbr-merged` material that indexes `gieraTileRects[15]` per fragment from a per-vertex `aTileId` attribute (`src/shared/terrain-materials.ts` lists the 7 buckets). Adding a tile means adding its atlas rect to the manifest, not a new material — per-tile materials survive only for the non-opaque buckets and for meshes that look a tile up by id (block preview, drops). Draw calls were 6 548 solo / 10 223 split with per-tile groups; the shadow pass is now ~73 % of the frame.
- Meshes that borrow terrain tile materials (training dummy, item drops) need a white `color` vertex attribute (`ensureWhiteVertexColors`), because the tile materials use `vertexColors: true` and a missing attribute reads as black.
- Post stack: `src/client/render/postfx.ts` = RenderPass → N8AO → one merged grade/SMAA/adaptive Bloom/ACES EffectPass. Split-screen uses two half-width chains and a color-space-correct composite. AO/Bloom disable below 50 FPS and restore above 55; each failed restore doubles the wait (5-second windows, capped at 24) so a marginal machine does not flicker.
- Ground decor uses seeded instanced grass and shared-time sway. Gameplay VFX use a fixed 64-particle pool; gameplay bursts outrank footsteps and pollen. Real log gathering shows the existing icon/count cue.
- Vite serves `public/` case-sensitively — asset filenames must match `asset-manifest.json` exactly.
- Adding assets: place files at the documented path, then `bun scripts/fetch-assets.ts --package-only` regenerates `src/shared/asset-manifest.json` and `public/assets/NOTICES.md`.

## NPC reasoning

- `server/npc-reason.ts` keeps the per-IP limit at 10 requests/minute. When limited or when the LLM fails, it returns a persona-specific pre-generated line with no tool or `walk_to` action.
- `server/nemotron-proxy.ts` retries upstream 429/5xx/network failures with exponential backoff and honors `Retry-After`.
- The client retries transient failures within the existing 12-second response budget, then uses the shared pre-generated lines in `src/shared/npc-fallbacks.ts`.
- Ambient NPC chatter continues during outages, but each NPC doubles its next chatter interval after fallback (20s base, 5min cap). A successful LLM reply resets that NPC's interval. Keep wandering, tools and `walk_to` behavior independent from this backoff.

## Deploy

Target: homelab k3s cluster (node k3s-mikrus-1, namespace `giera`, Forgejo registry, Tailscale funnel).

```
bun run deploy        # build+push image, apply k8s/, rollout, verify public URL
```

Requires: kubectl kubeconfig at `~/cluster-migration/kube/kubeconfig.yaml`, sops age key, docker buildx, TS_APIKEY.

## Xbox / Windows package

`platform/xbox-uwp-giera` is a UWP host that boots the built web app inside WinUI 2.8 `Microsoft.UI.Xaml.Controls.WebView2`. The classic XAML `WebView` is EdgeHTML and cannot run the game (no WebGL2, no ES2022), so never substitute it.

- `bun platform/xbox-uwp-giera/sync-web.ts` builds and copies `dist/` to `Assets/www` (git-ignored), served at `https://giera.local/` via `SetVirtualHostNameToFolderMapping` so root-absolute URLs and the service worker behave as on the web.
- `src/main.ts` `notifyHost()` posts `boot-ready` through `chrome.webview.postMessage`, falling back to `window.external.notify`. The native splash layer fades on that message.
- `build-giera.ps1` needs Visual Studio with the UWP workload plus Windows 10 SDK 19041 (`tools/install-vs-buildtools.cmd` installs Build Tools with both). Without them the build stops at `vswhere`.
- `MainPage` writes `boot-log.txt` to the app's `LocalFolder` (engine, WebGL2, boot-ready, ready/music/audio/fps snapshots); `deploy-xbox.sh log` reads it from a Developer Mode console.
