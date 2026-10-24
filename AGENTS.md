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

## Deploy

Target: homelab k3s cluster (node k3s-mikrus-1, namespace `giera`, Forgejo registry, Tailscale funnel).

```
bun run deploy        # build+push image, apply k8s/, rollout, verify public URL
```

Requires: kubectl kubeconfig at `~/cluster-migration/kube/kubeconfig.yaml`, sops age key, docker buildx, TS_APIKEY.
