# Giera superhero headquarters tycoon design

Date: 2026-11-05
Status: Hybrid direction selected from the owner's requirements; written specification awaiting owner review

## 1. Purpose

Replace the tycoon's six circular prop unlocks with a useful, visibly constructed superhero headquarters for Ziemek and Gniewko. Every purchase must add architecture or a working feature. The result should feel like a colorful Gen Alpha hero base rather than an industrial accessory set.

The headquarters must be non-destructive: construction does not clear trees, excavate terrain, remove player creations, or overwrite another tycoon. Floors and walls use the existing voxel world so their rendered and physical surfaces agree.

This specification covers the headquarters. Terrain, foliage, and existing collision defects are a separate follow-up workstream with their own reproduction evidence and regression tests; the headquarters must not conceal those defects.

## 2. Preserved contracts

Unless a test exposes a wiring defect, preserve:

- Star production, collection, and upgrade intervals.
- Upgrade cost `dropperTier * 5`.
- Expansion slot indices `0` through `5`, costs `20/30/40/50/60/70`, local X/Z positions, and walk-on purchase triggers.
- Shared local/split-player tycoon progression.
- Serialized `vaultCoins`, `collectedStars`, `dropperTier`, and `expansions` compatibility.
- Existing saves that contain some or all expansion indices.
- Factory product path, six-product pool, production timing, and trampoline velocity `22`.
- Existing QA and audio event IDs; additive headquarters events receive new IDs.
- Direct implementation in the normal code path without a runtime feature flag.

The visual purpose of expansion indices changes from factory props to headquarters stages. Existing owned indices restore their corresponding headquarters stages without charging again or replaying one-time purchase feedback.

## 3. Player experience

The existing purchase positions become compact rectangular construction kiosks and holographic footprints, not circles. Each kiosk shows an icon, star cost, and a ghost of the stage outcome before entry. The trigger position and radius do not move.

A purchase constructs its stage in a short deterministic sequence. A fresh purchase animates; a restored save appears complete without construction effects. Players can enter the finished building, walk on its floors, use the elevator, collect dispenser rewards, and use the rewarded blocks and gear elsewhere.

The base uses an original hero-headquarters theme: deep navy metal, warm white ceramic, cyan glass, lime and magenta accents, chunky stars, lightning shapes, gaming setups, trophy displays, and a rooftop antenna. It does not depend on copyrighted superhero characters or logos.

## 4. Six construction stages

| Index | Cost | Stage | Construction and function |
| --- | ---: | --- | --- |
| 0 | 20 | Foundation | Same-height hero floor, entrance pad, supports, perimeter lights, and construction beacon |
| 1 | 30 | HQ shell | Ground-floor walls, cyan windows, two-block entrance, roof trim, and hero emblem |
| 2 | 40 | Upper level | Second floor, upper walls, roof, railings, and working two-level elevator |
| 3 | 50 | Command room | Hero consoles, animated screens, gaming corner, lounge, trophy wall, neon signs, and interior lights |
| 4 | 60 | Block lab | Four functioning dispensers for unique placeable headquarters blocks |
| 5 | 70 | Gadget lab | Three functioning gear dispensers, armory displays, rooftop antenna, and completion effects |

Stages retain independent slot ownership. A later stage does not silently charge for or grant an earlier stage. Stage-specific content appears only when that index is owned; architecture needed to support it remains structurally safe if earlier stages are absent.

## 5. Site and floor plan

The headquarters outer footprint is local X `-7..5`, Z `0..8`. The factory remains at negative local Z and is not moved. The complete reserved site, including the factory and pads, is local X `-7..5`, Z `-8..8`.

Every tycoon slot needs the same level-site guarantee, not only slot zero. Add a pure world-generation site mask that flattens each slot's complete reserved site at that slot origin's existing target height (`60` for slot zero, the existing slot-pad height for other slots). At the existing 14-block spacing, one site's maximum local X `5` and the next site's minimum local X `7` leave a two-block gap. A cell inside a site's reserved core belongs to that site and overrides older overlapping symmetric-pad transition weights; transitions continue outside the core. Do not expand tree-clearing radii: the existing 12-block remote-site clearance already covers the footprint plus crown radius, and slot zero's larger clearance already covers its site. This is deterministic site preparation, not a general terrain rewrite, and existing seeds and edits remain compatible.

The entrance is two blocks wide at local X `-1..0`, Z `0`, facing the existing collector. Ground-floor wall height is three blocks. The upper walking surface is four blocks above the ground walking surface. Stage 2 includes its own support columns so the upper level is supported even when earlier stages are absent. Reserve clear routes to the entrance, every unowned purchase kiosk, both elevator call pads, and every dispenser.

The elevator occupies one shaft cell at local X `1`, Z `2`, between existing purchase kiosks. Its ground call/entry cell is X `1`, Z `1`; its upper call/entry cell is X `1`, Z `3`. The upper floor alone leaves the shaft cell open. Arrival positions are on solid floor outside the shaft.

Purchase kiosks and interaction labels are non-colliding. Doorways, floor openings, railings, and walls come from the same block plan used by physics. Large furniture either has matching voxel support cells or stays against walls outside walk routes; no whole-prop bounding cylinder is added for the headquarters.

## 6. Non-destructive block construction

### 6.1 Pure block plans

Add a shared, pure headquarters plan module. For each stage it returns ordered block operations in local coordinates, the expected block ID, and whether the operation is:

- `air`: place only in an empty cell.
- `surface`: replace only the plot's original natural surface block at the same Y, without changing walking height.
- `verify`: accept an already matching headquarters block without rewriting it.

Foundation surface operations may change grass/dirt/sand into the hero floor at the identical elevation. They may not dig, add a step, or replace an edited/player block. All other structural operations use empty cells or matching existing base cells.

The plan reserves the entrance, shaft, kiosk volumes, and interaction routes. It never addresses cells outside the owning plot's reserved headquarters footprint.

### 6.2 Preflight and purchase transaction

Before currency is deducted, a world adapter preflights every operation for that stage:

- `air` requires air or the expected headquarters block.
- `surface` requires the generated natural surface block or the expected headquarters block.
- `verify` requires air or the expected headquarters block during a new purchase; restoration accepts only the expected block or air.

A foreign or unexpected cell cancels the new purchase before deduction and leaves the kiosk available with an obstructed icon. No partial purchase is committed.

Fresh construction applies operations in deterministic plan order using accumulated simulation delta and a fixed per-frame operation budget. Collision follows each real voxel write. Restoration verifies/applies the complete plan immediately, without particles, audio, currency changes, or delayed collision.

### 6.3 Persistence and LAN

Offline headquarters blocks are ordinary world edits and persist with existing world edits. Expansion ownership remains in the existing tycoon save.

For LAN play, only the owning local tycoon submits its headquarters block edits through the existing block-edit path. Remote tycoons render ownership and decorative art but never write headquarters blocks or grant inventory rewards. Joining clients receive the structure through normal room persistence/synchronization.

Restoration is idempotent. Matching blocks are accepted; missing compatible blocks are restored; foreign blocks are never overwritten. A legacy conflict leaves the foreign cell intact and records a diagnostic rather than destroying it or charging currency.

Headquarters construction does not use companion build reservations and does not consume companion tasks.

## 7. Headquarters rendering

### 7.1 Voxel architecture and unique blocks

Add solid block definitions and original pixel textures for:

- `hero_floor`: dark blue metal flooring with a restrained star/energy pattern.
- `hero_wall`: warm white/light ceramic wall panels with navy edging.
- `hero_glass`: cyan hero glazing; transparent and solid like existing glass.
- `neon_block`: bright cyan/lime energy block for player building.

Architecture may also use existing roof and trim blocks. New tiles join the existing atlas and material buckets; adding them must not create per-block material groups or bypass atlas manifest/content checks. Neon voxel textures do not require a new terrain shader. Actual emissive illumination is limited to lightweight decorative mesh accents.

The block lab dispenses all four new block types. They behave as ordinary player-placeable blocks outside protected headquarters construction cells.

### 7.2 Decorative interiors

Add a dedicated headquarters art module with staged roots, shared geometries, and shared materials. It owns:

- Consoles and animated monitor faces.
- Gaming desks/chairs and lounge furniture.
- Trophy shelves and hero emblems.
- Neon strips, signs, and ceiling fixtures.
- Elevator platform, rails, arrows, and call-pad visuals.
- Dispenser housings and animated reward icons.
- Rooftop antenna and completion beacon.

Decorative animation uses simulation delta only. Small details do not cast shadows. No extra scene render, real-time reflection, transmission pass, or per-frame label/material allocation is introduced. Restored stages do not replay construction animation.

The headquarters does not use `TycoonCollisionRoots`; its architecture collides through voxels. Existing factory collision remains separate and is not broadened to include the base.

## 8. Elevator

The elevator is a short, scripted ride between fixed safe endpoints, not a general moving-platform physics system.

Each local player has independent ride state, cooldown, and rearm state. Entering a call pad starts a ride only when stage 2 is owned, the player is at the matching level, no ride is active for that player, and the pad has been rearmed by leaving it after the previous ride.

A ride:

1. Centers the player from the call cell into the shaft.
2. Moves vertically for a fixed duration using simulation delta.
3. Zeroes vertical velocity and ignores ordinary movement input during the ride.
4. Moves the player onto the solid arrival cell.
5. Restores control and requires the player to leave before that pad can activate again.

The visual platform follows the same interpolated state. The upper shaft remains a real floor opening. Arrival never leaves a player standing over an unsupported cell. Split-screen cameras follow their own player; remote poses use the existing player synchronization.

Reloading never restores a mid-ride state. Both players may use the elevator sequentially without changing tycoon currency or progression.

## 9. Functional dispensers and gear

Dispensers use walk-on triggers with large icons, visible cooldown rings, and short pickup feedback. Either split player can activate the local shared-base dispenser; remote tycoons cannot grant rewards.

Each dispenser has an independent eight-second simulation-time cooldown. Activation grants through the real inventory and automatically makes rewarded blocks available in empty hotbar slots using existing inventory behavior. Rewards are not star purchases and do not change production.

Block dispensers grant eight blocks of their displayed type per activation. Gear dispensers grant one of:

- `star_pickaxe`: stone/ore mining multiplier `5`.
- `star_axe`: wood mining multiplier `5`.
- `pulse_sword`: training-dummy combat multiplier `4.5`.

Move tool bonus lookup to a small shared gear catalog used by both recipes and dispenser gear. Existing recipe IDs, costs, outputs, and bonuses remain unchanged. New gear is not added as a crafting recipe. Inventory, equipped-tool behavior, and persistence use existing item fields; no parallel inventory is introduced.

Dispenser cooldowns are transient and need not be serialized. Inventory rewards and stage ownership persist. Reloading does not duplicate a reward without a real dispenser activation.

## 10. Architecture boundaries

- `src/shared/tycoon-base-plan.ts`: pure stage footprints, ordered block operations, interaction positions, and route reservations.
- `src/shared/tycoon-slots.ts` and `src/shared/worldgen.ts`: shared reserved-site mask and deterministic per-slot level-site generation.
- `src/client/game/tycoon-base.ts`: preflight, deterministic fresh construction, idempotent restoration, world-edit callbacks, and build diagnostics.
- `src/client/game/tycoon-headquarters-art.ts`: staged decorative geometry, materials, elevator visuals, and dispenser visuals.
- `src/client/game/tycoon-expansion.ts`: existing ownership, affordability, costs, kiosk state, and purchase triggers; factory-prop modules and circular pads are replaced by headquarters integration.
- `src/client/game/tycoon.ts`: progression authority, purchase preflight hook, local interaction updates, visual-only remote updates, and save compatibility.
- `src/shared/gear-catalog.ts`: existing crafted gear and new dispenser gear bonuses.
- `src/main.ts`: real world/inventory adapters, local block-edit submission, per-player elevator stepping, reward feedback, and save wiring.

Unit-level world adapters use explicit fakes. Browser tests use real input for purchases, elevator travel, and dispenser activation. Test hooks may arrange stars/position but may not replace the behavior being asserted.

## 11. Error handling and lifecycle

- A failed new-purchase preflight deducts nothing and writes no blocks.
- A late factory asset load does not gate voxel headquarters construction.
- A decorative art failure does not create invisible voxel collision or duplicate progression.
- Disposing a tycoon removes its decorative roots and transient interaction state; persistent world blocks remain.
- Changing the local tycoon slot does not transfer or rebuild another plot's blocks.
- Remote visual restoration never grants items or emits authoritative block edits.
- Cooldowns, construction, elevator motion, and animations use no wall clock, `Date.now()`, or `Math.random()`.

## 12. Performance contract

Reuse the current terrain mesher for architecture rather than hundreds of individual wall/floor meshes. Share interior geometries/materials and instance repeated small decor where useful. Keep purchase holograms simple and avoid rendering hidden completed interiors for remote plots beyond the normal view-distance policy.

Measure fresh, mid-build, completed, and restored bases in solo and split-screen. Stay within the existing FPS, boot, draw-call, and remesh budgets. Do not claim Xbox performance from desktop evidence.

## 13. Verification design

### 13.1 Unit and plan tests

Verify:

- Exact stage indices, costs, positions, and preserved economy.
- Level, non-overlapping reserved sites across all eight slots and representative seeds, with unchanged tree-clearing bounds.
- Every stage plan is deterministic and stays inside its owning footprint.
- Air/surface/verify rules never overwrite foreign cells or change foundation elevation.
- Purchase preflight failure is atomic and free.
- Fresh construction versus immediate restoration and repeated restoration.
- Entrance, kiosk, elevator, and dispenser routes remain clear for every ownership combination.
- Upper floor has exactly one elevator opening and safe arrival support.
- Elevator ride endpoints, velocity reset, rearm, and split-player independence.
- Dispenser reward counts, cooldowns, hotbar integration, and remote no-grant behavior.
- Existing crafted gear values plus new gear multipliers.
- Decorative disposal and absence of headquarters cylinder colliders.

### 13.2 Browser mechanics and LAN

Use real Playwright input to verify purchase, entry, walking on both floors, elevator rides, dispenser collection, block placement with rewarded blocks, gear effects, and reload persistence. Verify both split players and no page errors.

Run two-client LAN coverage showing one owner's constructed base and rewarded inventory behavior without remote duplicate edits or grants. Existing room block persistence and tycoon mechanics remain green.

### 13.3 Visual and performance acceptance

Capture each construction stage, completed interior/exterior, elevator, dispensers, solo/split, and restored base. New intentional golden changes require explicit human approval and a recorded acceptance reason; never auto-accept them.

Run focused tests during small slices, `pipeline:fast` after integrated slices, and the complete pipeline for the acceptance candidate. Include the previously approved factory goldens and the current performance stage.

## 14. Delivery slices

1. Per-slot level sites, pure stage plans, new blocks, non-destructive preflight, and foundation construction.
2. Shell and upper-floor construction with correct voxel collision and persistence.
3. Elevator and split-player interaction.
4. Command-room art, lighting, and staged construction feedback.
5. Block dispensers, unique textures, and inventory/hotbar integration.
6. Gear catalog, gear dispensers, armory, and rooftop completion.
7. LAN, performance, visual captures, human golden acceptance, and full pipeline.
8. Separately reproduce and repair terrain/foliage/collision defects with focused tests and reviewed captures.

## 15. Acceptance criteria

The headquarters is accepted when:

- Every one of the six existing purchases visibly constructs its specified useful stage.
- Players can enter and use a complete multi-floor superhero base; no purchased stage merely unlocks a circle or decorative prop.
- Construction never destroys or overwrites foreign content and never charges for a blocked plan.
- Rendered walls/floors and collision agree, including the elevator opening and safe exits.
- The elevator works for both players without changing physics elsewhere.
- All four unique blocks and three gear rewards come from real dispensers and work through existing building/mining/combat systems.
- Offline saves and LAN play restore ownership, architecture, and inventory without duplicate charges, edits, or rewards.
- Existing factory, economy, trampoline, crafting, and persistence tests remain intact.
- Performance stays within budget and all intentional golden changes receive human approval.
