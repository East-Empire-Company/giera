# Test Suite Audit — 2026-10-27

## Summary

**Verdict:** the suite is better than most for a game this size, but several tests give false confidence on the most important code.

- Scale: 59 unit files / 244 tests; 6 Playwright files (game, goldens, lan, mechanics, perf, shots).
- Coverage (vitest v8): 51.3% statements / 47.1% branches / 42.3% functions / 52.7% lines, against gates 48 / 44 / 41.5 / 49.
- `server/` is **not** in the coverage include (measured separately: 61.3 / 53.1; `server/index.ts` 0%).
- Hygiene: no `vi.mock`, no snapshots, no skip/only/todo in unit tests.
- Per-file 100% gates exist only on rng, blocks, chunk-worker-protocol, mesher, etc.

## Scorecard

| Check | Result | Notes |
| --- | --- | --- |
| Statement coverage vs gate | pass | 51.3% vs 48 |
| Branch coverage vs gate | pass | 47.1% vs 44 |
| Function coverage vs gate | pass | 42.3% vs 41.5 |
| Line coverage vs gate | pass | 52.7% vs 49 |
| `server/` in coverage include | fail | measured separately: 61.3 / 53.1; `server/index.ts` 0% (F15) |
| Unit tests free of `vi.mock` / snapshots / skip-only-todo | pass | none found |
| All Playwright specs run in pipeline | fail | `game.spec.ts` and `shots.spec.ts` never run (F13) |
| Playwright retries / traces configured usefully | fail | retries 0 with trace on-first-retry means no traces (F13) |
| Accept-gate stages functional | fail | mechanics constants regex never matches; goldens copied without diff (F14) |

## Findings

### Server correctness — F1–F2

| ID | Target | Finding | Required fix |
| --- | --- | --- | --- |
| F1 | `server/room.ts:63-81` | `RoomState.setBlock` looks up `this.chunks` with key `cx,cz`, but `getChunkRLE` caches under `cx,cy,cz`, so a block edited after a chunk is cached is never patched into the cached chunk. **Currently latent**: the only consumer of `getChunkRLE` is the WS `need` branch and no client sends `need` (`LanClient.requestChunk` is unused; LAN clients generate chunks locally and sync edits via `block` broadcasts). Real bug, 1-line fix, but not a live player-visible defect today. Existing tests (`tests/unit/lan-server.test.ts:26-33,43-47`) only check the edits map and `rle.length>0` — meaningless. Also `lan-server.test.ts:5-10`: name says empty edits but that is not asserted. | `decodeRLE` and assert the block for edit-then-gen and gen-then-edit, including negative coords; assert the empty-edits case. |
| F2 | `server/index.ts:119-197` | WebSocket handler (hello, speed gate/hadInput, block, need, leave) is inline in `Bun.serve` and untested. `block` messages are unvalidated (any xyz/id/NaN into an unbounded edits map; arbitrary room creation). First input accepted unchecked. | Extract a testable handler module, validate inputs, add tests. |

### Vacuous or weak unit tests — F3–F12

| ID | Test file | Problem | Required fix |
| --- | --- | --- | --- |
| F3 | `tests/unit/static-server.test.ts:49-50` | Path-traversal test `/..%2f..%2fetc/passwd` expects text/html and passes for the wrong reason: the resolved path does not exist so it falls back to index.html — deleting the `startsWith(root+sep)` guard in `server/static.ts` keeps it green. Also untested: brotli branch, MIN_COMPRESS threshold, vary header, 404, ETag mismatch, `%00`, malformed encoding, sibling-prefix dir (`dist-evil`). | Add tests that fail when the guard is removed; cover the listed branches. |
| F4 | `tests/unit/lan-protocol.test.ts:34-41` | `isValidPlayerSpeed` has one valid and one grossly invalid x-axis case: mutating MAX_PLAYER_SPEED 12→30, dropping y/z from the hypot, and `<=`→`<` all pass. Comment on line 39 is wrong. Also `chunkA` there is raw bytes, not RLE; decode error branches untested. | Boundary cases on all axes; mutation-hardened assertions; RLE error paths. |
| F5 | `tests/unit/npc-bridge.test.ts:5-13` | `give_block` count bounds (`server/npc-bridge.ts:28`) untested (`>16` → `>160` passes). Invalid quest step, unknown tool, per-NPC permissions untested. | Assert count clamping and rejection paths. |
| F6 | `tests/unit/tycoon.test.ts:22-32` | Expected `coinsBefore` is read from the SUT (circular). Whole file: trampoline (cooldown 0.6, radius 1.1, onBounce), denied upgrade, cost scaling, empty vault, radius edge untested. `:16` `toBeGreaterThanOrEqual(1)` should be `toBe(1)`. | Hard-coded expectations; cover the listed behaviors. |
| F7 | `tests/unit/player.test.ts` | `step()` untested (speed, jump 9, gravity, wall stop, landing). Fix commit e9140bd grounded-flicker (`velocity.y=-1` at `player.ts:130`) has no regression test. Names at `:7-14` and `:25-31` claim head pivot / arm offset but assert neither. `:19,22` one-sided pitch bounds pass if pitch is pinned to 0. | Test `step()` physics; add grounded-flicker regression test; assert what the names claim; two-sided bounds. |
| F8 | `tests/unit/drops.test.ts:38` | Magnet test passes without the magnet (seed 7 drift alone satisfies it). Unseeded `Math.random` at `:9,17,42`. | Control run without the magnet; seed all randomness. |
| F9 | `tests/unit/worldgen.test.ts:58-60` | Determinism only vs itself; no golden values for v1/v2, so a hash change silently reshapes saved worlds. `:26` unused label. Crown test asserts ≥2 shapes, not 3. | Pin golden outputs per version. |
| F10 | `tests/unit/raycast.test.ts` | Only 2 tests. Negative directions, y/z axes, origin-in-solid, zero vector, maxDistance edge untested. | Expand coverage. |
| F11 | `tests/unit/persist-store.test.ts:35-43` | Only the localStorage fallback is exercised; the IndexedDB path (`src/client/persist/db.ts:75-111`) never runs (no fake-indexeddb). `isSavedGameState` does not check items/chunkEdits/creative and accepts arrays. `setItem` quota throw (`db.ts:88`) unhandled/untested. 8 invalid payloads in one test. `persist.test.ts:26-33` and `persist-store.test.ts:69-73` duplicate round-trip checking only 3 fields. | Run the IndexedDB path with fake-indexeddb; split and strengthen schema checks. |
| F12 | `tests/unit/atlas.test.ts:25-35` | Water 128×128 at (0,0) and cobble at x=128 do not overlap; the test checks one pixel; it cannot fail. | Redesign into a real overlap/bounds check. |

### Playwright / e2e — F13

| Location | Issue |
| --- | --- |
| `game.spec.ts:39-65` | Mine/place test is circular (sets blocks/inventory itself, then asserts the same). |
| `game.spec.ts`, `shots.spec.ts` | Never run in the pipeline. |
| `shots.spec.ts` | Not a test: asserts PNG >10 kB, 6 `waitForTimeout`s, "03-lan-client-b" is the same single page. |
| `lan.spec.ts:61` | Uses `\|\|` where `&&` is required. |
| `lan.spec.ts:164,176-178` | "server persists room" only checks `existsSync`; `placedId` only `not.toBe(0)`. |
| `goldens.spec.ts:15` | MAX_DIFF_RATIO 0.001 of 1280×720 ≈ 921 px; `waitForTimeout(250/500)` before screenshots; no platform guard for ANGLE/Metal. |
| `mechanics.spec.ts:344-357` | Jump asserts only `maxVy>5`. |
| `mechanics.spec.ts:595-626` | Tycoon teleports and uses `addStars`. |
| `mechanics.spec.ts:646-697` | `waitForTimeout(1500)` then `dig_wood>=10`. |
| `mechanics.spec.ts:307` | `toBeCloseTo(...,1)` on an exact clock. |
| `mechanics.spec.ts` (general) | ~7 residual `waitForTimeout`. |
| `perf.spec.ts` | Fails only on fps p50<30 (45 advisory); draw calls only warn; remeshMs last call not max; runs vite dev + qa=1. |
| `playwright.config.ts` | Retries 0 with trace on-first-retry means no traces. |
| `tests/MANUAL-CHECKLIST.md:39` | Says W ~2.4 b/s but `SPEC.walkSpeedBlocksPerSec` is 4.3. |
| `game.spec.ts:93` | `plankCount>=4` should be exact. |

### Pipeline & accept gates — F14

| Location | Issue |
| --- | --- |
| `scripts/pipeline.ts:216` + `tests/spec-constants.ts` | `accept --stage mechanics` builds regex `export const KEY =` but the file only exports `SPEC`, so every key is "Unknown spec constant" (dead branch; comma values also mis-split). |
| `scripts/pipeline.ts:194-205` | `accept --stage goldens` copies whatever is on screen over all three baselines with no diff shown or required. |
| Triage records | Triage reason is written to `.ai/evidence/pipeline/TRIAGE.md`, which is gitignored — rationale for accepted baselines is never committed. |
| `scripts/pipeline-quality.ts:28-34` | "scanned 0" still exits OK. |

### Remaining MED/LOW unit issues — F16

| Test file | Issue |
| --- | --- |
| `recipes.test.ts:5` | Name says all 5 recipes, asserts 3; `craftRecipe` mixed sources/routing untested. |
| `objectives.test.ts:22-33` | "cycles through all 6" never cycles; wrong id / all_complete / overshoot untested. |
| `day-cycle.test.ts:5-8` | Never samples t=0; ramp / sunPosition / NaN untested. |
| `physics.test.ts` | Missing lower bounds; slide / ceiling untested. |
| `chunk.test.ts:18-22` | Short-data branch untested. |
| `world-renderer.test.ts` | Only origin setBlock; no try/finally dispose. |
| `mesher.test.ts` | All tests use `getBlock:()=>0`, so border culling untested; AO, glass, unlike-tile no-merge untested. |
| `npc.test.ts:24-29` | `toBeDefined` on parrot; radius/clamp tests also pass if NPC never moves; nearest-NPC selection untested. |
| `gameplay-vfx.test.ts` | Outward flag / oldest-recycle / dispose untested. |
| `inventory.test.ts:9` | `toBeGreaterThan(0)` should be exact; negative cycle wrap, survival consume untested; round-trip only dirt. |
| `rng.test.ts:59-60` | Tautological `>=0`. |
| `blocks.test.ts` | Bare ids. |
| `world-seed` | Missing cases. |
| `retry.test.ts` | Missing default attempts / no sleep after last / `attempts:0`. |
| `dummy.test.ts` | isHit untested. |
| `npc-collision.test.ts:11` | Only upper bound. |
| `mic.test.ts` | Only echoes callback; real onresult/onend/onerror logic untested. |
| `nemotron-proxy.test.ts` | MAX_CONCURRENT_CONVERSATIONS=2 → 429 and finally-decrement untested; 405; 502 on throw; key forwarding; lower/non-numeric max_tokens; env dependence on GIERA_NPC_MODEL. |
| `npc-reason.test.ts` | Always injects proxyFn, so outgoing payload (history slice(-6), 300 cap, npcId whitelist, auth) never inspected; per-IP isolation / window reset untested. |
| `npc-tts.test.ts` | Missing second-IP isolation, window reset, 405, 200-char cap, unknown npcId→mina, bad JSON, in-flight de-dup. |
| `split-screen.test.ts:47-76` | Name "without cross-binding" lies; axes / deadzone / Y→toggleSplit untested. |
| `touch.test.ts:23` | `toBeGreaterThan(0.5)` should be `toBe(1)`. |
| `hud.test.ts:35-38` | `toContain("A")` cannot fail; craft click / hotbar / objective / NPC prompt untested. |
| `assets.test.ts:31-36` | Name says rectangles, checks only ids. |
| `sound.test.ts:15-26` | Literal path tables compared to themselves; no existsSync; unused manager. |
| `npc-voice.test.ts:116-127` | Asserts only 1 loop source, not which track won; magic 0.3 lookup. |
| `audio.test.ts:23-56,66-80` | `validateAudioManifest` has no negative test; tests 67-80 outside describe. |
| `npc-fallbacks.test.ts:26-30` | Unknown NPC only length checks; papuga missing. |
| `postfx.test.ts:20-23` | Name says resets. |
| `lan-client.test.ts:187-198` | Reconnect does not assert hello re-sent. |
| `npc-brain.test.ts` | fallbackSay change detector; 4xx / Retry-After / abort / 160 truncation untested. |
| `avatar.test.ts:17-20` | Only length>0. |
| `agents.test.ts` | Giant prose test; `getElevenLabsSignedUrl` dead. |

## Coverage gaps — F15

- `server/` is not in the vitest coverage include.
- No per-file gates on `tycoon.ts` (42%), `objectives.ts`, `player.ts`, `worldRenderer`, `renderer`, or any server file.

Least-covered files:

| File | Coverage |
| --- | --- |
| `src/main.ts` | 0% |
| `server/index.ts` | 0% |
| `workers/chunk.worker.ts` | 0% |
| `character-detail.ts` | 0.7% |
| `postfx.ts` | 6.8% |
| `ground-decor.ts` | 8% |
| `avatar.ts` | 10% |
| `mic.ts` | 14% |
| `fabric.ts` | 41% |
| `tycoon.ts` | 42% |
| `worldRenderer.ts` | 46% |
| `renderer.ts` | 46% |
| `touch.ts` | 47% |
| `room.ts` | 62% (branches 23.5%) |
| `hud.ts` | branches 36.5% |
| `npc-bridge.ts` | 60.5% |

## Real-mode blind spots — F17

All pipeline e2e runs use `?qa=1`, so the following are never exercised:

- Non-qa chunk streaming and Xbox/low-memory radius (`pickViewRadius`).
- Real audio playback and music unlock-on-gesture.
- NPC LLM route, `/npc/tts`, rate limit, pl-PL fallback, ducking, `walk_to` (qa returns `fallbackSay`).
- NPC think timers and avatar pose (`freezePose`).
- Boot failure / retry UI.
- Service worker.
- Server static serving compression/caching end to end (e2e always uses vite dev).
- Persistence: pagehide faked with `dispatchEvent`, only slot+planks asserted.
- Hardware (gamepad, touch, mic, Xbox UA) — manual only.
- `Promise.withResolvers` removal uncovered.

**Fix:** add a non-qa smoke stage against the built server (`bun server/index.ts`).

## Good examples to keep

- `mechanics.spec.ts` place/mine/movement/craft — real input, outcomes asserted.
- `npc-tts.test.ts` — real temp-dir cache + exact rate-limit count.
- `nemotron-proxy.test.ts` — injected `sleepFn`.
- `lan-client.test.ts` — fake timers + disconnect-during-backoff regression.
- `atlas.test.ts:6-24` — non-overlap/bounds invariants.
- `hud.test.ts:92-114` — real happy-dom.
- `scripts/pipeline-content.ts` — asset existence validation.
- `tests/goldens/README.md` — policy.

## Remediation status

| ID | Finding | Status |
| --- | --- | --- |
| F1 | `room.ts` setBlock chunk-cache key mismatch (`cx,cz` vs `cx,cy,cz`) | done add9eee |
| F2 | Untested, unvalidated inline WS handler in `server/index.ts` | done a05d938 89b397e 31ff64a |
| F3 | static-server traversal test passes for the wrong reason | done c01184a |
| F4 | `isValidPlayerSpeed` tests too weak to catch mutations | done 66dcf23 |
| F5 | npc-bridge `give_block` bounds and permissions untested | done 76991cf |
| F6 | tycoon tests circular; behaviors missing | done this commit |
| F7 | player `step()` / grounded-flicker regression untested; misleading names | done this commit |
| F8 | drops magnet test passes without the magnet; unseeded randomness | done this commit |
| F9 | worldgen lacks golden values for v1/v2 | done this commit |
| F10 | raycast under-tested | done this commit |
| F11 | persist IndexedDB path never run; weak schema checks | open |
| F12 | atlas overlap test cannot fail | open |
| F13 | Playwright specs circular, skipped in pipeline, or flaky by design | open |
| F14 | accept/pipeline gates broken (mechanics regex, goldens copy, gitignored triage, quality OK on 0) | done this commit |
| F15 | `server/` excluded from coverage; no per-file gates on core files | open |
| F16 | Many MED/LOW unit-test weaknesses | open |
| F17 | Real-mode (non-qa) blind spots | open |
