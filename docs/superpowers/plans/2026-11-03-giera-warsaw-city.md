# Warsaw City Integration and City-First Teaser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track implementation steps with checkboxes.

**Goal:** Integrate a playable 96×96 Warsaw district into Giera, then revise its teaser after verification.
**Architecture:** Convert a fixed source crop offline into compact shared voxel data. Generate immutable city blocks through existing deterministic worldgen and preserve normal edit overlays. Add source-aware meshing and PBR before capturing verified gameplay.
**Tech Stack:** TypeScript, Three.js, Vite, Bun, Vitest, Playwright.
**Spec:** `docs/superpowers/specs/2026-11-03-giera-city-design.md`

## Locked user decisions

- Use `stared/warsaw-vibe-voxel`, not a synthetic replacement.
- Keep the editable footprint at 96×96 blocks, or six-by-six Giera chunks.
- Work in the current checkout. Do not create a worktree.
- Build and verify the city before revising the teaser.
- Capture genuine gameplay input. Do not inject game state or reuse state-injected footage.

Source revision: `5ac94e8010450884690a6db4f4b289089e15bf27`. Reuse its committed compressed 1/2/4/8 m tile data. Do not rebuild its 11 GB source-data pipeline. Tile format and palette/material encoding live in `web/src/mesher.worker.ts`, `web/src/voxelMaterial.ts`, and `scripts/voxelize.py`.

## Global constraints

- Keep Giera's 16³ chunks, 128-block world height, `MAX_GENERATED_BLOCK_Y=104`, deterministic shared worldgen, and current save/LAN edit formats.
- Map source (east, south, up) to Giera (x, z, y). Preserve source scale; never rotate by 21.5° twice, scale, clip, or renumber existing block IDs.
- Preserve saved edits as final overlays. Do not reset or migrate user edits.
- Keep footage local. Do not deploy, publish, or upload the game or teaser.
- City worlds require compatible client/server builds. Older builds cannot read new block IDs; downgrade support is out of scope.

## Review focus

- Source air at and above source ground must suppress procedural terrain; natural Giera geology remains below source ground. Terrain outside the city mask and connector remains unchanged.
- City roofs must never act as ground for companion spawning or house plans.
- Saved edits must remain intact and override the new city base.
- The connector must terminate inside the fixed y=60 core, preserve a one-block maximum grade, clear generated terrain above the road, and avoid every tycoon pad.
- Palette identity must not multiply face counts or bleed across merged faces.

---

## Design constraints

- Keep Giera's 128-block world height, current generated ceiling `MAX_GENERATED_BLOCK_Y=104`, and existing 16³ chunk, edit, save, and LAN contracts.
- Keep proposed placement at x=-80..15 and z=-112..-17. Connect a measured source street to spawn through a four-block-wide corridor.
- Use the measured crop at source x=619..714,y=2468..2563, spanning source tiles x=4..5,y=19..20 at levels 1 and 1f.
- Its median ground top is 43, minimum is 41, and highest solid is 70. Translate source-relative heights by +17, producing ground y=58..60 and highest solid y=87. Four street cells at source x=703..706,y=2563 map to local x=84..87,y=95 and world x=4..7,z=-17. Preserve source scale and local-grid orientation.
- Do not add a broad terrain-transition band. Put the connector corridor at x=4..7, z=-16..4, outside the city mask. Join a measured four-cell source-street exit at z=-17 to x=4..7,z=4 inside the fixed y=60 core and outside all pad footprints. Every adjacent road surface across width and length differs by at most one block; reject a crop that cannot reach y=60 within 21 steps. Derive the profile from the crop, not the world seed. Override terrain only inside the corridor, fill only below the road, and clear from road+1 through `MAX_GENERATED_BLOCK_Y`.
- Source run solids override natural generation at every height. At/above source top solid (`ground - 1`), absent source data is explicit air; below it, absent source data uses existing deterministic Giera geology, caves, and ores with source ground as height. Do not add city-specific underground fill. Exclude procedural tree sites whose crowns overlap city or connector masks.
- Keep the player spawn cell and every tycoon pad unchanged. The connector may override terrain only inside its corridor; the city mask ends at z=-17, with no transition band toward the tycoon area.
- Generated city blocks remain immutable base data. Existing saved and LAN edits remain the final overlay without reset, dropping edits, or schema migration. Old absolute block IDs at edited coordinates intentionally overlay the new base.
- Do not add a distant skyline LOD in this slice. The district itself must be visible from spawn at normal view radius.
- Do not deploy, publish, or upload the game or teaser.

## Implementation phases

### Task 1: Preflight and pin source data

- [ ] Use `$HOME/.cache/giera/warsaw-vibe-voxel` as the pinned source Git repository. Verify the pinned commit with `git cat-file -e 5ac94e8010450884690a6db4f4b289089e15bf27^{commit}` and never switch HEAD or check out source files. Read blobs with `git show <revision>:<path>`; when a partial clone lacks a blob, fetch the raw file at that exact revision and accept it only when `git hash-object --stdin` matches `git rev-parse <revision>:<path>`.
- [ ] Use the measured crop at x=619..714,y=2468..2563. Its median ground top is 43, minimum 41, highest solid 70, and vertical offset +17. Four street cells at source x=703..706,y=2563 have equal ground top 43; they map to local x=84..87,y=95 and world x=4..7,z=-17. Confirm this crop leaves the connector endpoint inside the fixed y=60 core, respects the one-block grade, avoids every pad, and clears through `MAX_GENERATED_BLOCK_Y`.
- [ ] Record source revision, tile coordinates, crop bounds, vertical offset, SHA-256 checksums, each palette index's source RGB/material ID/block ID/tint ID, quantized tint palettes, and separate license notices in `src/shared/warsaw-city-manifest.json`.
- [ ] Add failing tests in `tests/unit/warsaw-city-data.test.ts` for `decodeWarsawTile(bytes: Uint8Array, N: number)` and `mapWarsawPalette`. Pass decompressed bytes to the shared decoder; let the importer decompress pinned source tiles. Use compact golden slices from one real matching level-1 and `1f` tile; cross-check expected counts, ground, runs, and palette entries with the pinned source decoder. Document that `1f` carries foliage/trunks/grass, while level 1 replaces grass with bare earth and omits trees/trunks.
- [ ] Test every source material ID and exact `SOLID` RGB tuple, unknown material-ID failure, unmatched `SOLID`-to-stone behavior, and deterministic tint quantization. Use a small test fixture sourced from the pinned tiles, not only a handcrafted buffer.
- [ ] Run `bun run test -- tests/unit/warsaw-city-data.test.ts`; confirm each new case fails before implementation.
- [ ] Add `BLOCK_ID.asphalt=15`, `paving=16`, `brick=17`, `plaster=18`, and `roof_tile=19` with block definitions in `src/shared/blocks.ts`.
- [ ] Implement `mapWarsawPalette` using the design's exact mapping: `GLASS/WINDOW→glass`, `WATER→water`, `LEAF→oak_leaves`, `GRASS→grass`, `SOIL→dirt`, `ROOF→roof_tile`, `WALL/PKIN/CONCRETE→plaster`, `TENEMENT/CLASSIC→brick`; `MARK` and exact `asphalt/asphalt_l/cycle/parking` tuples→asphalt; `paving/paving2/sett/gravel/ballast/trambed/platform/kerb/track` tuples→paving; `concrete/steps/benchkerb` tuples→plaster; `trunk/woodfloor` tuples→oak_log/planks; `LAMP/METAL/CAR/CLOCK/BRONZE/SIGN/JET/SIGNBAND/RIBBON` and unmatched `SOLID` tuples→stone. Fail on unknown material IDs. Quantize RGB by deterministic linear-space median-cut with stable source-index tie-breaks, at most 16 tint IDs per block family, and 255 reserved for no tint.
- [ ] Implement `decodeWarsawTile(bytes: Uint8Array, N: number)` and `mapWarsawPalette` in `src/shared/warsaw-city-data.ts`, plus `scripts/import-warsaw-city.ts --source-root "$HOME/.cache/giera/warsaw-vibe-voxel" --source-revision 5ac94e8010450884690a6db4f4b289089e15bf27`. Decompress source tile blobs in the importer with `node:zlib.gunzipSync`; the shared decoder consumes decompressed bytes. Read pinned `web/public/data/meta.json` and required level-1/`1f` tile blobs. If `git show` lacks a blob, fetch the raw file at the pinned revision and accept bytes only when `git hash-object --stdin` matches `git rev-parse <revision>:<path>`. Reject a missing Git repository or mismatched/missing revision. Generate compact per-column varint runs, block/tint mappings, and a base64 byte stream in `src/shared/warsaw-city-data.generated.ts`; decode it once per runtime.
- [ ] Enforce a 300 KiB generated-data limit. Run the data tests and generated-crop checks; stop before worldgen integration if the limit fails.
- [ ] Keep runtime offline. Preserve separate MIT, ODbL, and GUGiK attribution; review data obligations before any external redistribution.

### Task 2: Integrate city generation and edits

- [ ] Add failing tests in `tests/unit/warsaw-city-data.test.ts`, `tests/unit/worldgen.test.ts`, `tests/unit/world-renderer.test.ts`, and `tests/unit/lan-server.test.ts`. Cover city bounds and explicit air, source solids below ground, source-ground geology, underpasses, connector clearance/profile, edits in loaded/unloaded chunks, tint restoration, and RLE parity.
- [ ] Run those four targeted files; confirm every new behavior case fails before implementation.
- [ ] Add `lookupWarsawVoxel(x, y, z): { blockId: number; tintId: number } | null`, `lookupWarsawGroundHeight(x, z): number | null`, and `lookupWarsawConnectorHeight(x, z): number | null` in `src/shared/warsaw-city-data.ts`. Return source-run solids at any in-mask height; return explicit air for absent voxels at/above `ground - 1`; return `null` for absent voxels below that height or outside the mask. `lookupWarsawGroundHeight` returns top-solid y=`ground - 1`.
- [ ] Add `generateChunkWithCityTints(cx, cy, cz, seed): { data: Uint8Array; cityTintIds?: Uint8Array }` beside `generateChunk` in `src/shared/worldgen.ts`. Keep `generateChunk(): Uint8Array` unchanged for server/RLE consumers. Use tint sentinel 255; allocate tint data only for chunks containing source tints.
- [ ] Add optional `cityTintIds` to successful `ChunkBuildResult`, `ChunkView`, and `meshChunk` input. Pass the shared tint palette to `meshChunk`; return and transfer tint IDs from `src/client/workers/chunk.worker.ts`; use them in `WorldRenderer.remeshChunk`.
- [ ] Use the same city-aware block/tint generator for worker chunks, chunks created by `setBlock`, and `clearEdits` rebuilds. Clear source tint on edits from `setBlock`, `applySavedEdits`, and `applyChunkEdits`; restore base tint after clearing edits. Keep tint data out of saves and LAN edits.
- [ ] Integrate city and connector lookups before natural terrain in `src/shared/worldgen.ts`, preserving bedrock at y=0. Source run solids override at every height; above source top solid, source gaps are air; below it, source gaps use existing deterministic geology/caves/ores with source ground as height. On connector cells, place asphalt at the fixed profile, support only below the road, and return air through `MAX_GENERATED_BLOCK_Y` above it.
### Task 3: Integrate city surfaces and block families

- [x] Add failing tests in `tests/unit/house-plan-shared.test.ts`, `tests/unit/lan-server.test.ts`, `tests/unit/worldgen.test.ts`, and `tests/unit/inventory.test.ts`. Cover source water and untouched roofs/fixtures as non-walkable surfaces, edits including unloaded chunks raising surfaces, house rejection over source buildings and paved streets, procedural tree-mask boundaries, and stone-family boundaries.
- [x] Run those four targeted files; confirm the new behavior cases fail before implementation.
- [x] Make `surfaceHeight` return source walkable ground or connector height inside their masks. Use one shared city-surface policy on client and server: ignore water and untouched roofs/fixtures, honor edits including unloaded-chunk edits, and let edited solids raise the top. Preserve non-city behavior.
- [x] In `src/shared/house-plan.ts`, reject footprints with source solids above walkable ground or asphalt/paving as source surface. Do not replace source buildings or road surfaces.
- [x] Preserve source 1 m ground surfaces, underpasses, and building volumes. Exclude procedural tree sites whose crowns overlap the city or connector masks; source `1f` data owns foliage inside the city.
- [x] Add `isStoneFamily(id: number): boolean` in `src/shared/blocks.ts`, explicitly covering stone, cobblestone, and ore IDs. Replace `inventory.ts`'s `isStoneOrOre` threshold and the `src/main.ts` threshold with this helper; keep the concierge allowlist unchanged.
- [x] Run the six targeted test files; confirm source geology, tree boundaries, connector grade/clearance, city water/edit behavior, house-site rejection, tint restoration, and family boundaries pass.
### Task 4: Add city materials and texture coverage

- [x] Add tests in `tests/unit/mesher.test.ts` for same-tint face merging, different-tint boundaries, AO preservation, and exact-height city grass/dirt faces at chunk edges.
- [x] Add tests in `tests/unit/hud.test.ts`, `tests/unit/assets.test.ts`, and `tests/unit/atlas.test.ts`. Assert five material icons resolve to their AmbientCG Color maps, manifests include required files, and atlas tiles have UV rectangles.
- [x] Run `bun run test -- tests/unit/mesher.test.ts tests/unit/hud.test.ts tests/unit/assets.test.ts tests/unit/atlas.test.ts`; confirm missing behavior fails. Same-tint merging stays green because Task 2 already implements it.
- [x] Consume the phase-1 block/tint mappings; do not quantize source colors at runtime. Keep tint IDs 0–15 per block family and reserve 255 for no tint.
- [x] Include material family and tint ID in `src/shared/mesher.ts` merge keys. Index the shared tint palette by block ID and tint ID. Convert source RGB to linear space, normalize tint luminance, apply `mix(white, luminanceNormalizedTint, 0.6)`, then multiply by existing AO vertex color. Skip smooth terrain deformation for source-marked city blocks; preserve smoothing elsewhere.
- [x] Carry tint IDs through `src/client/workers/chunk.worker.ts` and edited-chunk remeshing. Edited and placed blocks use tint ID 255 and retain material-family appearance.
- [x] Add the specified AmbientCG assets through the existing pipeline: Asphalt033, PavingStones151, Bricks097, Plaster001, and RoofingTiles013A. Reuse glass, water, foliage, and soil materials where source classes match.
- [x] Verify `src/shared/terrain-materials.ts` already routes new opaque tiles through the merged bucket. Update `scripts/fetch-assets.ts`, `scripts/build-atlas.ts`, generated `src/shared/atlas-manifest.json`, asset manifests, and notices. Keep atlas buckets and tile consumers working.
- [x] Map asphalt, paving, brick, plaster, and roof-tile icons in `src/client/game/hud.ts` to their matching PBR Color maps. Include those paths in generated asset manifests; verify none use the star fallback.
- [x] Run the four targeted test files; confirm tint boundaries, AO, face merging, icons, and atlas coverage pass. Run `bun run assets:fetch --pbr-only` to avoid re-fetching existing asset packs, then run `bun run assets:atlas`.
- [x] Do not add a distant skyline LOD in this slice.

### Task 5: Verify the city before teaser work

- [ ] Run `bun run pipeline`. Do not relax assertions or accept visual changes without reviewing diffs.
- [ ] Run a real-browser active-play smoke at desktop view radius 20. Walk from spawn into the district, traverse a street, mine a source block, place a family block, save/reload, and verify a LAN peer sees identical base and edits. Keep temporary smoke code unless it proves a stable contract.
- [ ] Verify spawn visibility, ground/collision, road clearance and grade, chunk boundaries, clean-package texture maps, source tint, zero console errors, and client/server street-height agreement.
- [ ] Measure FPS, draw calls, triangles, and greedy-face counts at normal desktop radius 20. The pipeline's radius-8 performance stage does not replace this check.
- [ ] Review city screenshots and pipeline evidence. Refresh goldens only for intentional, reviewed changes using `bun run accept -- --stage goldens --reason ...`.
- [ ] Update `AGENTS.md` render-layer details and `README.md` with the source revision, import command, runtime behavior, tint channel, and attribution.

### Task 6: Revise and verify the teaser

- [ ] Create a city-first storyboard only after city verification. Preserve the approved Polish narration and delivery format unless the user changes them. Show only implemented city traversal and interactions; do not imply regular combat.
- [ ] Use a fresh real gameplay session and genuine keyboard/mouse/controller input. Do not assign game state, teleport, insert blocks, dispatch synthetic gameplay events, or reuse earlier state-injected footage.
- [ ] Capture the city's approach from spawn, street traversal, close architectural/material shots, and an editable-block interaction. Include co-op only if the actual session verifies both players moving.
- [ ] Reuse existing trailer production conventions for viewport, audio, captions, synchronization, and QC. Retain raw captures and verify gameplay, frame pacing, audio, captions, and final render before delivery.
- [ ] Keep all footage local. Do not publish or upload it.

## Acceptance criteria

- The playable 96×96 district derives from the pinned source and fits y=41..104 without scaling or clipping.
- The district is visible from spawn, safely reachable on a four-block road, and walkable through source streets.
- Source blocks can be mined and placed. Mining source ground reaches deterministic Giera geology, not a data-gap void; source underpasses remain open. Untouched geometry retains recognizable, quantized source tint; edits persist across reload and synchronize in LAN rooms.
- The connector ends at the fixed y=60 core, has ≤1-block steps across width and length, clears through `MAX_GENERATED_BLOCK_Y`, uses no seed-dependent profile, and avoids every tycoon pad.
- Client and server share city surface semantics: water and untouched roofs/fixtures are not walkable; edits count even when chunks are unloaded. House plans avoid source buildings and paved streets.
- Source run solids override natural generation at every height. Source air above ground masks procedural blocks; source-ground gaps below use deterministic Giera geology, and source underpasses remain intact.
- Existing saved and LAN edits remain unchanged and override immutable city base data. Procedural terrain remains unchanged outside the city mask and connector.
- Palette tint and material families remain recognizable under PBR detail. Quantized palette keys do not cause city chunks to exceed existing face-count budgets or bleed across merged faces; source-ground faces retain exact voxel heights.
- All referenced maps and atlas rectangles exist in a clean asset package. Existing material buckets and HUD icons remain functional.
- Spawn and every tycoon pad retain current geometry and access.
- Full pipeline, active-play visual smoke, and normal desktop radius-20 performance checks pass.
- Source code and generated city-data attribution remain distinct and accurate.
- Revised teaser uses verified real gameplay and passes audio, caption, motion, and final-render review.

## Implementation authorization

The user authorized implementation in the current checkout. Do not create a worktree, merge unrelated companion branches, deploy, publish, or upload the game or teaser.

## Changelog

- 2026-11-03: Initial plan created.
- 2026-11-03: Added explicit source palette mapping and pre-integration tint quantization. Clarified source-backed decoder fixtures, subsoil, surface parity, connector clearance, and compatible-build limits.
- 2026-11-03: Measured and pinned the source crop; moved surface, house-site, tree-mask, and stone-family tests to Task 3 to match their implementations. Added verified raw-blob fallback for partial clones without checkout.
- 2026-11-03: Pinned the generated runtime artifact path and verified missing-blob fallback.
- 2026-11-03: Kept Node-only gzip decoding in the importer; shared tile decoding accepts decompressed bytes.