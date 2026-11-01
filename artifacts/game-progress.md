# Giera Visual and Mechanics Review

## Intent and constraints

- Review the playable game, visual readability, and mechanics; fix verified defects only.
- Preserve existing user changes and the established kid-friendly voxel art direction.
- Maintain deterministic simulation and real-input gameplay checks.
- Extend Iskra only for explicit child requests; never modify player-built blocks.
- Keep world edits bounded, persisted, LAN-synchronized, and covered by tests.

## Current findings

- Normal launch hid and inerted the full HUD without restoring it after start.
- Visible QA selected an obstructed oak log, assumed 5 recipes, and checked build clearance with swapped coordinates.
- Iskra currently exposes jump, flight, one cabin-style house generator, progression, and backup controls.
- House generation varies size and material, but not architectural archetype.
- WorldRenderer tracks explicit edits privately, so safe excavation needs an explicit edit-presence query.

## Decisions

- Restore HUD interactivity and attach touch controls on normal game start.
- Make visible QA target reachable natural logs, select a real inventory block, use recipe count from source, and stub remote NPC APIs locally.
- Add distinct Iskra construction archetypes and a bounded mine-tunnel action.
- Excavate only untouched natural terrain; skip explicit edits, water, foliage, logs, and bedrock.
- Re-provisioning the hosted ElevenLabs agent is an external change; do not run without explicit point-of-risk approval.

## Completed

- Reproduced normal-mode HUD invisibility with Playwright.
- Restored HUD visibility and touch setup on launch.
- Added a browser regression test for post-launch HUD accessibility.
- Updated visible QA for reachable-log selection, recipe count, build clearance, and offline NPC endpoints.

## Pending

- Confirm visible QA finishes with all checks passing.
- Implement and test Iskra structure variety and bounded mine excavation.
- Verify Iskra client-tool wiring locally; note hosted agent sync status.
- Run unit, typecheck, build, gameplay, visual, and performance checks.
- Capture final active-play evidence and scorecard.
