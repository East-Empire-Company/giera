# Giera Warsaw City Integration Design

## Intent

Integrate the existing Warsaw voxel source into Giera as a real, reachable city scene. Keep a 96×96-block playable district editable, preserve the source city’s visual identity, and add high-quality PBR surface detail. Revise the teaser only after city behavior and rendering pass verification.

## User decisions

- Use the existing `stared/warsaw-vibe-voxel` project, not a synthetic replacement.
- Keep the editable footprint at 96×96 blocks, or six-by-six Giera chunks.
- Work in the current checkout; do not create a worktree.
- Build and verify the city before revising the teaser.
- The teaser must show real gameplay with genuine input.

Other implementation details below are proposals, not user-approved choices.

## Verified source

- Repository: [stared/warsaw-vibe-voxel](https://github.com/stared/warsaw-vibe-voxel), source revision `5ac94e8010450884690a6db4f4b289089e15bf27`.
- The source contains central Warsaw voxel data with 1/2/4/8 m LOD tiles, a 21.5° local-grid rotation, and palette-indexed voxel materials.
- The current metadata reports a 3,950×4,430 m area; the README’s 3,950×3,150 m figure is stale.
- Committed compressed tile data can be reused; rebuilding source datasets is not required.
- Source code is MIT-licensed. Generated city data has separate ODbL and GUGiK attribution requirements; retain notices and assess obligations for redistributed data.
- Giera uses 16³ chunks, a 128-block world height, deterministic shared world generation, and sparse persistent edits.

## Proposed integration

### City placement and geometry

- Convert a source-derived 96×96 m district into Giera chunk data. Do not recreate streets or buildings procedurally.
- Place the district northwest of spawn, at world coordinates x=-80..15 and z=-112..-17. Connect a source street at z=-17 to the spawn clearing through a four-block-wide corridor at x=4..7,z=-16..4; end at x=4..7,z=4 inside the fixed y=60 core and outside every pad.
- Select a lower-rise source crop near the PKiN/Złote Tarasy area. Rebase ground to the existing city floor. Keep all editable geometry within Giera’s 0..127 block range; do not scale or clip the source crop.
- Do not add a distant skyline LOD in this slice. The playable district itself must be visible from spawn at Giera's normal view radius.
- Keep the source grid’s existing orientation. Do not apply its 21.5° rotation a second time.

### World behavior

- Provide immutable source-derived city blocks through shared world generation so browser fallback, chunk workers, and LAN server generation agree.
- Keep Giera’s 128-block world height, current generated ceiling `MAX_GENERATED_BLOCK_Y=104`, and existing 16³ chunk, edit, save, and LAN contracts.
- Use source walkable ground, not water, roofs, or fixtures, for city surface queries. Apply one shared city-surface policy to client and server; honor edits even in unloaded chunks.
- House plans must not replace source buildings or road surfaces.
- Keep placement at x=-80..15 and z=-112..-17, subject to measured crop and route fit. Keep the district visible from spawn at normal view radius.
- Select a contiguous 96×96 crop from the pinned 1 m tile grid; allow adjacent source tiles. Preserve source scale and local-grid orientation.
- Rebase median source ground to y=60. Require walkable city ground at y≥41 and all city solids at y≤104. If no crop fits, measure alternatives; never scale, clip, or raise Giera's global ceiling.
- Source run solids override natural generation at every height. At/above source top solid (`ground - 1`), absent source data is explicit air; below it, absent source data uses existing deterministic Giera geology, caves, and ores with source ground as height. Do not add city-specific underground fill.
- Source air above ground must suppress procedural trees. Exclude procedural tree sites whose crowns overlap the city or connector masks; source `1f` data owns foliage inside the city.
- Build a seed-independent road profile from the measured source street exit to y=60 at x=4..7,z=4. Require ≤1-block adjacent steps across the full four-block width and route; clear road+1 through `MAX_GENERATED_BLOCK_Y` and fill only below the road.
### Materials and assets

The Warsaw source provides palette colors and material classes, not PBR maps. Preserve source colors as mesh tint, then add surface detail through shared PBR material families:

| Material family | Proposed source | Use |
|---|---|---|
| Asphalt | [Asphalt033](https://ambientcg.com/a/Asphalt033) | Roads and parking |
| Paving | [PavingStones151](https://ambientcg.com/a/PavingStones151) | Sidewalks and plazas |
| Brick | [Bricks097](https://ambientcg.com/a/Bricks097) | Masonry facades |
| Plaster | [Plaster001](https://ambientcg.com/a/Plaster001) | Rendered and concrete facades |
| Roof tile | [RoofingTiles013A](https://ambientcg.com/a/RoofingTiles013A) | Roofs and awnings |

### Source palette mapping

| Source entry | Giera block family |
|---|---|
| `GLASS`, `WINDOW` | glass |
| `WATER` | water |
| `LEAF` | oak_leaves |
| `GRASS` | grass |
| `SOIL` | dirt |
| `ROOF` | roof_tile |
| `WALL`, `PKIN`, `CONCRETE` | plaster |
| `TENEMENT`, `CLASSIC` | brick |
| `MARK`; `SOLID` asphalt/asphalt_l/cycle/parking tuples | asphalt |
| `SOLID` paving/paving2/sett/gravel/ballast/trambed/platform/kerb/track tuples | paving |
| `SOLID` concrete/steps/benchkerb tuples | plaster |
| `SOLID` trunk / woodfloor tuples | oak_log / planks |
| `LAMP`, `METAL`, `CAR`, `CLOCK`, `BRONZE`, `SIGN`, `JET`, `SIGNBAND`, `RIBBON`; unmatched `SOLID` tuples | stone |

Match `SOLID` entries by exact RGB tuple from the pinned source palette. Fail import on unknown material IDs. Record every source palette index-to-block/tint mapping and each quantized family palette in the generated manifest.

Keep each source RGB as mesh tint, independent of the selected block family. Use existing glass, water, foliage, and ore material buckets where source classes match. Add only the city block/material data required; never renumber existing block IDs. Fetch CC0 source maps through the existing asset pipeline and regenerate the atlas, normal map, ORM map, manifest, and notices. The atlas builder’s existing neutral AO fallback remains valid.

### Teaser

- Create a separate city-first storyboard after implementation and gameplay verification.
- Keep the prior Polish narration and delivery format unless the user changes them.
- Show only verified city traversal and interactions. Use genuine player input; do not inject game state or reuse earlier state-injected footage.
- Do not imply regular combat is delivered by this city slice.

## Non-goals

- Replacing Warsaw with a synthetic district.
- Making all 3,950×4,430 m editable in this slice.
- Changing Giera’s 128-block world height.
- Adding combat, survival, or other mechanics solely for trailer footage.
- Uploading or publishing footage.
- Mixed-version clients and downgrading city saves are unsupported because older builds cannot read new block IDs.

## Acceptance criteria

- The 96×96 playable district derives from the pinned Warsaw source data and fits y=41..104 without scaling or clipping.
- Players can see the district from spawn, reach it safely over the four-block connector, and walk through source streets.
- Mining source ground reaches deterministic Giera geology, not a data-gap void; source underpasses remain open. Building and edits work across reload and LAN rooms.
- City clients and server share surface behavior: water and untouched roofs/fixtures are not walkable; edits count even when chunks are unloaded.
- The connector ends at fixed y=60 core, has ≤1-block steps across width and length, clears through `MAX_GENERATED_BLOCK_Y`, uses no seed-dependent profile, and avoids every tycoon pad.
- The same seed and source revision produce identical city blocks across generation order, worker seams, and server generation. Source run solids override at every height; source air above ground masks procedural blocks; source-ground gaps below use deterministic Giera geology.
- Player edits override the city base without changing blocks outside the district. Existing save and LAN edit formats remain unchanged.
- Source palette classes and exact `SOLID` RGB tuples map deterministically to Giera block families. Unknown material IDs fail import; every palette index maps to its block/tint family in the manifest.
- Source tint and material families remain recognizable under PBR detail. Source-ground faces retain exact voxel heights; quantized palette keys preserve face-count budgets and do not bleed across merged faces.
- All referenced PBR maps and atlas rectangles exist in a clean asset package; existing material buckets and HUD icons remain functional.
- Spawn and every tycoon pad retain current geometry and access. The full pipeline, active-play visual smoke, and desktop radius-20 performance checks pass.
- Runtime and packaged attribution identify source code and city-data licenses separately.
- The revised teaser follows city verification and passes real-gameplay, audio, caption, motion, and final-render review.

## Open design checks

- Verify the selected 96×96 source crop contains suitable lower-rise geometry before implementation. If it cannot fit the existing height without scaling or clipping, return with measured alternatives.
