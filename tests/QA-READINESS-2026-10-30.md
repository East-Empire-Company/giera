# Giera — QA readiness assessment (2026-10-30)

Verdict: **web build is playable and mechanically complete for the 7-year-old path** (17/17 checkpoints). **Xbox path is not shippable yet** — the UWP host exists in-tree but has never produced a package.

## What ran

| item | value |
|---|---|
| harness | `scripts/qa-7yo-path.mjs` (headed Chromium, real keyboard/mouse) |
| run | 2026-10-30T13:48:30Z · `http://127.0.0.1:4173/?seed=424242` |
| viewport | 1920x1080, dpr 1, canvas 1920x993, webgl2 true, shadows true |
| GPU | ANGLE Metal Renderer: Apple M2 Max |
| services | Vite dev server 4173, NPC backend `bun run serve` on 8080 |
| wall time | 208 s |
| result | **17 passed / 0 failed**, 0 page errors, 0 console errors |

Evidence: `.ai/evidence/qa/7yo-path/` (`results.json`, `report.md`, 17 screenshots).

## Checkpoints

| # | checkpoint | result | measured |
|---|---|---|---|
| 1 | launch menu renders | PASS | 8 controls: start, players, LAN, music, close, join, mode, pad |
| 2 | game boots to playable HUD | PASS | WebGL2, shadows on, canvas 1920x993 |
| 3 | split screen enabled | PASS | `isSplit` true, P2 spawned at 4.5/61/5 |
| 4 | player 2 walks | PASS | 7.38 blocks |
| 5 | player 1 walks | PASS | 6.60 blocks |
| 6 | chopping trees yields wood | PASS | oak_log 0→4 in 4 chop rounds |
| 7 | inventory/craft UI | PASS | 5 recipes, 2 craftable |
| 8 | crafting consumes wood | PASS | recipe fired, logs debited |
| 9 | building a house block by block | PASS | 12 blocks placed |
| 10 | tycoon collector pays out | PASS | 6 collects |
| 11 | tycoon upgrades two levels | PASS | Poziom 1 → 5 → 6 |
| 12 | exploring the map | PASS | 24.9 blocks walked |
| 13 | NPC conversation replies | PASS | live LLM reply, 4 quick-reply buttons |
| 14 | combat on training dummy | PASS | dig_wood 4→118 |
| 15 | frame rate | PASS | p50 46 fps |
| 16 | page errors | PASS | none |
| 17 | console errors / failed assets | PASS | none |

## Performance (split screen, full desktop radius)

| metric | value |
|---|---|
| fps p50 / p10 / p90 / min | 46 / 42 / 51 / 37 (403 samples) |
| draw calls p50 | 6 861 |
| triangles p50 | 6 711 860 |

Split-screen at 1920x1080 holds above the 30 fps floor with 0.4x headroom to the 50 fps AO/Bloom disable threshold. Solo play measured higher in earlier runs.

## Visual evidence

- 17 screenshots, all with real scene detail (3.6k–9.9k distinct colours in a 160 px thumbnail); no blank, black or single-colour frames.
- Darkest frames are the intended modal scrims (inventory 07/08, NPC dialog 12b), not broken renders.
- Pipeline goldens (`spawn-view`, `split-view`, `tycoon-view`) pixel-match at threshold 0.10.
- **Limitation:** the vision model was unavailable this session (HTTP 402), so this report makes no aesthetic judgement — only pixel statistics and golden matches. A human eyeball pass over `.ai/evidence/qa/7yo-path/*.png` is still the last gate on "looks right".

## Gaps found

| gap | evidence | impact |
|---|---|---|
| no pause menu | only a QA-only `pauseAt`/`paused` flag exists in `src/main.ts`; nothing in HUD | a child cannot stop the game; settings are reachable only from the launch menu |
| voice input is Chrome-only | `src/client/audio/mic.ts` wraps Web Speech API `SpeechRecognition`, no `getUserMedia` fallback | Xbox WebView and Firefox get no mic path |
| NPC dialog needs the backend | `/npc` proxy → `bun run serve` on 8080; static deploy without it falls back to pre-generated lines | conversation quality degrades silently when the backend is down |
| modal contrast unmeasured | inventory/NPC overlays mean luminance 34–46/255 | not verified against WCAG for a non-reading child |

## Platform matrix

| platform | state |
|---|---|
| desktop browser (web) | **ready** — 17/17, 46 fps split, zero errors |
| Xbox Series X\|S via UWP host | **blocked** — `platform/xbox-uwp-giera/` builds only on a Windows box with VS UWP tooling; the Windows builder VM was unreachable and failed DNS resolution when last probed |

## Recommendation

Ship the web build to the kids. Before calling it "kid-complete", add a pause menu (settings, reset, restore) and a no-mic path that does not depend on Web Speech.