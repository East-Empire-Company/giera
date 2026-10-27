# Giera Automated Test Audit — 2026-10-27

## Context

Audit of Giera automated tests: 59 unit files / 244 tests, 6 Playwright files, goldens, perf, LAN stage. Coverage 51/47/42/53 (stmts/branches/funcs/lines) vs gates 48/44/41.5/49; server/ is NOT in the coverage include (server actual: 61% stmts; index.ts 0%). Zero vi.mock, no snapshots, no skip/only/todo in unit tests. Over-mocking is mostly fine; fakes are at real boundaries (happy-dom, FakeWebSocket, injected fetchFn/sleepFn). Static review only for e2e; Playwright suites were not run by the audit agents.

## Production issues found

- server/room.ts:63-81 RoomState.setBlock looks up `this.chunks.get("cx,cz")` but chunks are cached under "cx,cy,cz" (getChunkRLE room.ts:88), so a block placed after the chunk is cached is never written into the cached chunk. IMPORTANT FRAMING: this is a REAL BUT LATENT bug. getChunkRLE's only consumer is the WebSocket `need` branch and no client sends `need` today (LanClient.requestChunk is unused; LAN clients generate chunks locally and sync edits via `block` broadcasts). Fix anyway (1 line + decode test) but do not describe it as a live player-visible bug.
- server/index.ts:119-197 WebSocket handler inline in Bun.serve, untested; `block` messages have no validation (any xyz/id/NaN into an unbounded edits map, arbitrary room creation); first input accepted unchecked.
- scripts/pipeline.ts:216 + tests/spec-constants.ts: `accept --stage mechanics` builds regex `(export const KEY = )(.*?)(;)` but the file only exports `SPEC`; every key => "Unknown spec constant"; comma values mis-split. Dead branch.
- scripts/pipeline.ts:194-205: `accept --stage goldens` recaptures with GIERA_GOLDENS_STAGE and copies whatever is on screen over all 3 baselines; no diff shown or required.
- scripts/pipeline.ts:228-231: triage reasons are appended to .ai/evidence/pipeline/TRIAGE.md, which is untracked (.ai/ is git-excluded) so the rationale for accepted baselines is never committed.
- scripts/pipeline-quality.ts:28-34: if no *-results.json exist, "scanned 0" still exits OK.

## Test-quality findings (sev | file:line | problem | fix)

### HIGH

- static-server.test.ts:49-50 `get("/..%2f..%2fetc/passwd")` expects text/html: passes for the wrong reason (path doesn't exist so falls back to index.html anyway; removing the startsWith(root+sep) guard in server/static.ts keeps it green). Fix: real secret file outside dist + sibling dist-evil dir; request /..%2fsecret.txt, /%2e%2e/secret.txt, %00, malformed %E0%A4%A; assert body never contains the secret.
- lan-server.test.ts:26-33,43-47: only checks the edits map and rle.length>0 (meaningless). Fix: decodeRLE and assert the block is present for edit-then-gen and gen-then-edit, negative coords.
- no test for server/index.ts WS handler. Fix: extract handleMessage into a module and test teleport dropped, valid published, malformed JSON, non-string room, block bounds.
- persist-store.test.ts:35-43: only the localStorage fallback runs; happy-dom has no indexedDB so the real IDB path (db.ts:75-111) is never exercised. Fix: fake-indexeddb.
- atlas.test.ts:25-35: tiles never overlap and one pixel is checked, so the transparency test cannot fail.
- lan-protocol.test.ts:34-41: one valid + one grossly invalid x-axis case; changing MAX_PLAYER_SPEED 12->30, dropping y/z from hypot, or <= to < all pass; comment on line 39 is wrong (40 b/s not 20). Fix: exactly 12, just over, y-only/z-only/diagonal, dt<=0, NaN/Infinity.
- npc-bridge.test.ts:5-13: give_block count bounds untested (>16 -> >160 passes); invalid quest step and unknown tool untested.
- tycoon.test.ts:22-32: expected coinsBefore is read from the system under test (passes with a broken dropper); whole file lacks trampoline (cooldown 0.6, radius 1.1, onBounce), denied upgrade, cost scaling.
- player.test.ts: step() untested (speed, jump 9, gravity, wall stop, landing); commit e9140bd grounded-flicker fix (velocity.y=-1 at player.ts:130) has no regression test.
- drops.test.ts:38: toBeLessThanOrEqual magnet test passes without the magnet (drift alone satisfies it). Fix: known velocity, assert x < 11.1, test magnet radius.
- worldgen.test.ts:58-60: determinism only against itself; no pinned values for worldgen v1/v2, so a hash change silently reshapes saved worlds.
- raycast.test.ts: 2 tests; negative directions, y/z axes, origin-in-solid, zero vector, maxDistance edge untested.
- game.spec.ts:39-65: circular mine/place test (sets blocks and inventory itself, asserts the same); game.spec.ts and shots.spec.ts never run in `bun run pipeline`.

### MED

- goldens.spec.ts:15 MAX_DIFF_RATIO 0.001 of 1280x720 ≈ 921 px tolerance; fix ≤0.0002, includeAA false, tight HUD crop. goldens.spec.ts:47,93,110 waitForTimeout before screenshots; wait on qa.frame. goldens depend on ANGLE/Metal at DPR1, no platform guard.
- shots.spec.ts: not a test (only asserts PNG >10kB), 6 waitForTimeout, "03-lan-client-b" is the same single page.
- lan.spec.ts:61 `Math.abs(x-9)<1.5 || Math.abs(z-9)<1.5` should be &&. lan.spec.ts:176-178,164 "server persists room" only checks existsSync; placedId only `.not.toBe(0)`.
- mechanics.spec.ts:344-357 jump asserts only maxVy>5; :595-626 tycoon teleports and uses addStars (real walk-onto-pad untested); :646-697 waitForTimeout(1500) then dig_wood>=10; :307 toBeCloseTo(…,1) slop on exact qa clock; residual waitForTimeout at 301,424,451,467,494,528,737.
- perf.spec.ts:6-8,91-98 fails only if fps p50<30 (45 advisory), draw calls only warn, remeshMs is last call not max, runs vite dev + qa=1.
- playwright.config.ts:9,15 retries 0 with trace on-first-retry => no traces ever.
- player.test.ts:19,22 one-sided pitch bounds; :7-14 and :25-31 names claim head pivot/camera arm but assert neither.
- inventory.test.ts:9 toBeGreaterThan(0); :12-26 negative cycleSlot wrap and out-of-range selectSlot untested; :37-43 survival consume/refuse untested; :57-66 JSON round-trip checks only dirt+activeSlot.
- recipes.test.ts:5 name says all 5 recipes, asserts 3; :39-48 craftRecipe only planks-from-blocks.
- objectives.test.ts:22-33 "cycles through all 6" never cycles; wrong id, all_complete, overshoot untested.
- day-cycle.test.ts:5-8 "starts in daylight" never samples t=0; ramp, sunPosition, negative time untested.
- physics.test.ts missing lower bounds, slide/ceiling untested. chunk.test.ts:18-22 short-data branch (chunk.ts:51) untested.
- world-renderer.test.ts:27-29 only origin setBlock. mesher.test.ts always getBlock:()=>0 so border culling/AO/liquid untested.
- npc.test.ts:24-29 toBeDefined can't fail; :35-43,87-94 pass if the NPC never moves; nearest-NPC selection untested.
- gameplay-vfx.test.ts:45-56,58-67 outward flag/oldest-recycle not proven.
- nemotron-proxy.test.ts: MAX_CONCURRENT_CONVERSATIONS=2 -> 429 and finally-decrement untested; 405, 502 on throw, key forwarding, lower max_tokens untested; depends on GIERA_NPC_MODEL being unset.
- npc-reason.test.ts:24-98 proxyFn always injected, outgoing payload (history slice(-6), 300 cap, npcId whitelist) never inspected; limiter lacks per-IP isolation/window reset.
- npc-tts.test.ts: missing second-IP isolation, window reset, cached bypass, 405, 200-char cap, unknown npcId->mina, bad JSON 400, in-flight de-dup.
- mic.test.ts:11-22 passthrough only; persist.test.ts:26-33 and persist-store.test.ts:69-73 duplicate, 3-field round trip; persist-store.test.ts:56-67 8 invalid payloads in one test, isSavedGameState accepts arrays/missing items, setItem quota throw unhandled.
- split-screen.test.ts:47-76 name "without cross-binding" lies; deadzone/axes/Y-toggle/RT untested. touch.test.ts:23 toBeGreaterThan(0.5) where exact is 1. hud.test.ts:35-38 toContain("A") on innerHTML can't fail; craft click, hotbar select, objective stars, NPC prompt untested. assets.test.ts:31-36 name says rectangles, only id uniqueness. sound.test.ts:15-26 literal tables compared to themselves. npc-voice.test.ts:116-127 asserts only 1 loop source not which track won. audio.test.ts:23-56,66-80 validateAudioManifest has no negative test, tests outside describe. npc-fallbacks.test.ts:26-30 loose length checks, papuga missing.

### LOW

- postfx.test.ts:20-23 name says "resets"; lan-protocol.test.ts:11-32 chunkA raw bytes only length checked; lan-client.test.ts:187-198 reconnect doesn't assert hello re-sent; lan-server.test.ts:5-10 name says empty edits not asserted; npc-brain.test.ts:57-59,84-95; avatar.test.ts:17-20 clip names not checked against GLBs; agents.test.ts giant test; tycoon.test.ts:16 >=1 should be toBe(1); drops.test.ts:9,17,42 unseeded Math.random; rng.test.ts:59-60 tautology; blocks.test.ts; world-seed.test.ts; retry.test.ts default attempts / no-sleep-after-last; dummy.test.ts; npc-collision.test.ts:11; unused imports; MANUAL-CHECKLIST.md:39 says W ≈2.4 b/s but SPEC.walkSpeedBlocksPerSec is 4.3; pipeline.ts:96-124 chromium project (game, shots) never run by the pipeline, all e2e on vite dev so build + server/static.ts never hit end-to-end.

## Real-mode blind spots (all pipeline e2e run with ?qa=1)

- Non-qa chunk streaming and the Xbox/low-memory pickViewRadius path; real audio playback and music unlock-on-gesture (qa replaces audio.play/playMusic with recording wrappers); NPC LLM route, /npc/tts, rate limit, pl-PL fallback, ducking (qa returns fallbackSay and skips audio.speak); NPC think timers and avatar animation (freezePose); boot failure/retry UI; service worker; server static serving (brotli/gzip/etag/immutable) only unit-tested; persistence pagehide is faked with dispatchEvent; gamepad/touch/mic/Xbox UA only manual.

## Coverage

Per directory (stmts/branch): src/main.ts 0/0; client/audio 56.2/57.0; client/effects 96.3/100; client/entities 50.5/36.2; client/game 62.1/53.8; client/input 46.9/66.7; client/net 91.4/76.9; client/persist 52.7/80.6; client/render 37.9/36.2; client/workers 0/0; shared 96.6/92.1. server/ (separate run): index.ts 0/0; nemotron-proxy 77.8/72.5; npc-bridge 60.5/48.8; npc-reason 85.5/61.7; npc-tts 92.4/68.9; room.ts 61.8/23.5; static.ts 91.3/86.7. Per-file gates only protect the pure shared core; no gates on tycoon.ts, objectives.ts, player.ts, worldRenderer, renderer, or any server file. Least-covered important files: src/main.ts, server/index.ts, workers/chunk.worker.ts, character-detail.ts 0.7%, postfx.ts 6.8%, ground-decor.ts 8%, avatar.ts 10.2%, mic.ts 14%, fabric.ts 40.9%, tycoon.ts 42%, worldRenderer.ts 46.1%, renderer.ts 46.4%, touch.ts 46.9%, room.ts 61.8% (branch 23.5%), hud.ts branches 36.5%.

## Good examples worth keeping

- mechanics.spec.ts "place"/"mine"/"movement"/"craft" (real input, real outcomes); npc-tts.test.ts:22-38 and :59-68; nemotron-proxy.test.ts:127-192 (injected sleepFn); lan-client.test.ts:124-223 (FakeWebSocket + fake timers); atlas.test.ts:6-24 invariants; hud.test.ts:92-114 (real happy-dom); scripts/pipeline-content.ts; shared logic 97% covered with 100% per-file gates on core modules.

## Fix status

| ID | Finding | Status | Commit |
|---|---|---|---|
| F1 | room.ts chunk cache key | open | |
| F2 | WS handler extract+validate+test | open | |
| F3 | static-server traversal tests | open | |
| F4 | lan-protocol speed validator tests | open | |
| F5 | npc-bridge bounds tests | open | |
| F6 | tycoon tests | open | |
| F7 | player.step + e9140bd regression | open | |
| F8 | drops magnet + seeded randomness | open | |
| F9 | worldgen pinned values | open | |
| F10 | raycast edge cases | open | |
| F11 | persist IndexedDB + strict isSavedGameState | open | |
| F12 | atlas overlap test | open | |
| F13 | e2e circular/\|\|/persist-parse/shots/jump/waitForTimeout/traces/manual doc | open | |
| F14 | accept flow fixes + tracked triage + quality-empty | open | |
| F15 | goldens/perf thresholds | open | |
| F16 | coverage include server/ + per-file gates | open | |
| F17 | non-qa real-mode smoke stage | open | |
| F18 | lying names + weak assertions sweep | open | |
| F19 | remaining untested branches (MED/LOW list) | open | |
