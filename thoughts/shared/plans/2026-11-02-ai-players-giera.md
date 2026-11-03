# AI Players (Giera) — implementation plan, 2026-11-02

Ordered implementation tasks distilled from the approved speech-and-AI-players plan
(`local://giera-speech-and-ai-players-plan.md`, §4). Every task lands RED → GREEN.

## 1. Profiles and controls

- `src/shared/companion.ts`: `CompanionProfileId = "staszek" | "mina"`; `CompanionProfile = { model; targetHeight: 1.8; voice: "buddy" }`.
- Manifest entries: `assets/models/kaykit/ranger.glb` (staszek), `assets/models/kaykit/mage.glb` (mina), `assets/models/kaykit/anims/Rig_Medium_General.glb` (Idle_A), `assets/models/kaykit/anims/Rig_Medium_MovementBasic.glb` (Walking_A). Source picks already exist in `scripts/fetch-assets.ts`; fix its `--package-only` picks before regenerating.
- `Avatar.load` loads both clips for companion profiles; validate source height and resolved clips before spawn; missing/broken assets → Polish error, no spawn.
- Non-modal HUD panel usable during play: model choice, add/remove, follow, scout, cabin preview/confirm, stop, buddy mute/volume, hold-to-talk. Polish labels, keyboard + pointer. `KeyB` opens from pointer lock and exits pointer lock; held gameplay keys cleared; panel swallows its own input; close returns control without relocking; closes on pause.
- Offline: local player owns one companion. LAN: only room owner adds/removes; any joined player issues tasks and confirms own preview.
- Never spend credits or describe bundled CC0 models as generated.

## 2. Room authority and replication

- First valid hello on a fresh room = owner; seed/name only from that connection. Later `host:true` never reclaims.
- Server-issued companion ID, separate from humans and tycoon slots.
- `CompanionState = { id; profile; x; y; z; yaw; anim: "idle"|"walk"|"jump"|"mine" }`.
- Client→server: `companion_spawn{profile}`, `companion_state{companion}`, `companion_remove{id}`, `companion_command{task, expectedGeneration}`, `companion_stop` (direct, any joined player).
- Server→clients: accepted state/removal, `companion_command{task, by, generation}`, `welcome{ownerId, companion, generation, buildPreview?}`, `owner_changed{ownerId}`.
- Owner-only spawn/state/remove; validate profile, finite pose, animation, bounds, `isValidPlayerMotion`; initial spawn at free supported spot ≤4 blocks from owner pose.
- Commands relay once to the owner controller; only it simulates the buddy.
- Owner disconnect: broadcast removal, cancel task/reservation, preserve edits, transfer ownership to oldest remaining, broadcast `owner_changed`.
- Generation increments on accepted command, Stop, replacement, ownership change; direct Stop ignores generation; stale `expectedGeneration` → notify sender. Microphone/planner bound to observed generation; abort on change; stale build previews rejected.

## 3. World parity

- Keep `RoomState.getBlock` edit-only; add `getWorldBlock(x,y,z)` = edit or `generateBlock(x,y,z,seed)`.
- Preserve seeds, room snapshots, local saves, human edits, untracked warsaw files.
- Room edit hydration: `room_sync_start/begin/page/ack/abort/end` with `syncId`; pages ≤256 `{x,y,z,id}`; next page only after ack; one sync per socket; 10 s progress expiry; client buffers live broadcasts (cap 8192, overflow → abort + retry notice) until `room_sync_end`, then applies in order; disable room editing/companion movement until synced; rebuild affected chunks; preserve explicit air edits.
- Save keys: keep `last_save` offline; `room:<ws-origin>:<normalized-room>` per LAN room; writes confirm via IndexedDB completion or localStorage success; drain prior saves before switching; "Opuść pokój" confirms save, clears marker, reloads offline key/seed; concierge backup/restore scoped to active save key; room voxel state stays server-owned.

## 4. Deterministic movement and exploration

- `src/shared/actor-motion.ts`: `ActorMotionState`, `ActorMoveInput`, `ActorStepResult`, `stepActor(world, state, input, delta)`; mutate supplied state; preserve `sweepAABB`, movement constants, AABB origin and axis order.
- Humans keep landing effects and respawn below Y=-20 in `PlayerController`; buddy stops and reports falls. Buddy updates: accumulated delta ≤0.25 s, sub-steps ≤0.05 s.
- `WorldRenderer.isLoadedCell(x,y,z)` from loaded chunk map.
- Deterministic BFS ≤12 blocks over standable `(x,feetY,z)`: loaded support + clearance, 0.6×1.8 actor box, ≤1-block rise/drop per cardinal step, ≤1024 states. Follow seeks reachable 2–4 block ring, else closest reachable intermediate + replan. Scout targets nearest visible log/coal/iron/gold/stone with fixed tie-breaks, moves, returns, reports only still-observed blocks. Replan on owner move or blocked path; unloaded terrain / no goal / no route → stop with short reason. Never ask the LLM per frame. Waypoint checks include NPC, dummy, tycoon, and player cylinders via existing `blockedByCylinders`/`pushOutOfCylinders`.

## 5. Approved cooperative construction

- Pure `createHousePlan`/`HousePlan` moves to shared code; inventory mutation stays client-side.
- `{t:"build_preview",requestId,expectedGeneration}` → server generates ≤150-cell `"cabin"` from requester's latest accepted pose, room seed, procedural terrain, edits; never trusts submitted block lists. Reply to room; only requester confirms `{t:"build_confirm",planId}`; revalidate cells; broadcast `{t:"build_reserved",planId,blocks}`. Supersede/stop/disconnect cancels.
- Owner controller routes to reachable loaded safe standing cell with every block ≤8 blocks away; else cancels with reason. Place lowest-Y remaining first with coordinate tie-breaks; `{t:"companion_place",id,planId,blockIndex}`; server verifies owner/id, reservation, unplaced index, reach, bounds, air, capacity, no AABB overlap, then broadcasts the normal `block` edit once. No companion inventory.
- Human edit of a remaining reserved cell: accept edit atomically, cancel reservation, broadcast visible stop.
- Client pre-checks `houseSiteOccupied` + live bodies; server rejects within 10 blocks of `tycoonSlotOrigin(0..7)` or 1 block of dummy `(1.5,3)` plus actor bounds. NPC motion stays client-side (not authoritative server-side).

## 6. Typed planning and child speech

- `POST /npc/companion` via `handleNemotronProxyRequest`: ≤4 KiB, selected task + ≤300 transcript chars, existing 10/min peer limit with real socket peer, existing global concurrency bound. Model only chooses a task: ask for exactly `{"task":"follow"|"scout"|"build"|"stop"}`; reject other shapes. Called only on task start/block/utterance interpretation. Speech fallback maps exact normalized `chodź za mną|szukaj|zbuduj domek|stop`; unknown → `Powiedz prościej.`
- `{t:"companion_say",id,line,evidence?}` owner-only; fixed line IDs; discovery evidence = allowlisted block ID + in-bounds coords verified against room voxels; one broadcast echo; offline emits locally; clients map to bubble + `audio.speech.request({kind:"text",speakerId:"buddy"})`. 300–3400 Hz filter on decoded buddy output only. Speech failure never blocks gameplay.
- Push-to-talk: new `MicController` per gesture; silence/max-segment >10 s cap; release ends capture; single final transcript accepted ≤12 s bound to gesture ID; late transcripts discarded on cancel/hide/panel close/pause/owner loss/timeout/newer gesture. Cancellation stops tracks and aborts `/npc/stt` work. Mic ownership serialized across buddy/NPC/concierge before `getUserMedia`; failures visible; ownership released on all exits.
- `/npc/stt` hardening: real socket peer via `server.requestIP`, existing 20/min peer budget, add 60/min global; reject multipart after `10 MiB + 64 KiB` (incl. chunked) before `formData()`.

## 7. Integration proof

- Behavior tests per phase incl. terrain/edit parity, fabricated reservations, simultaneous human edits, ownership transfer, missing clips, late transcripts.
- Two-client Playwright: isolated Bun LAN server, `GIERA_TEST_WS=ws://127.0.0.1:<port>/ws`; both see buddy, one confirmed build, one speech event; owner disconnect removes buddy, edits retained.
- Real-input controls in normal (non-QA) gameplay plus deterministic QA. `bun run test` + `bun run pipeline` with blank provider keys. Xbox microphone support claims require hardware proof.
