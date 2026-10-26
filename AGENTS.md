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
| performance | fps p50 / boot / draw calls / remesh budgets (`.ai/evidence/pipeline/perf.json`) |
| network | two browser clients join one LAN room, exchange a block edit, server persists the room |
| quality | zero pageerrors across e2e JSON runs; dead-asset scan (warn only) |

Variants: `bun run pipeline:fast` (skips goldens + performance), `bun run goldens:init` (write baselines), `bun run accept -- --stage <stage> --reason "..."`, `bun run manual`.

Report lands in `.ai/evidence/pipeline/report.md` + `report.json`.

## Determinism rules

- No `Date.now()` / `Math.random()` in simulation code. Use `makeRng(seed)` from `src/shared/rng.ts` and accumulate sim time (`this.pulseTime += delta`).
- `?qa=1` contract: fixed 1/60 timestep, sky pinned to `elapsed = 150` (midday), `window.__GIERA__.qa.events` records audio/gameplay events, `qa.frame` counts frames. Tests wait on `qa.frame`, never on wall clock.
- Seeds: tests use `?seed=424242`. Worldgen is pure seeded hash noise.

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
- Heroes/NPCs are KayKit CC0 GLBs in `public/assets/models/kaykit/` (Rig_Medium clip names live in `ANIM_MAP` in `src/client/entities/avatar.ts`). Decor props are Quaternius CC0 glTF in `public/assets/models/props/`.
- Environment light comes from a Poly Haven CC0 HDR (`HDRLoader` → `PMREMGenerator` → `scene.environment`); `SkyCycle` only modulates `scene.environmentIntensity` by daylight.
- Post stack: `src/client/render/postfx.ts` = RenderPass → GTAO → grade → SMAA → OutputPass. Split-screen renders two half-width composers and composites them.
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
