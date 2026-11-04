# giera

## Tata world tools
The launch and pause concierge uses the dedicated Iskra avatar, not Tata's world GLB.

Tata can build cabins or lookout towers with randomized size and materials.
He can dig an 8×2×2 mine through untouched stone, dirt, grass, sand, and ore.
Mining stops at player edits, wood, water, bedrock, or occupied space.
World edits persist in the save and sync to connected LAN players.

Run `bun run concierge:provision` to publish tool schemas and prompts to ElevenLabs.
Starting gameplay from the launch menu closes Tata's active session and speech stream.

## LAN multiplayer

Manual joins adopt the room seed and reconnect before play.
Block edits (including TNT blast craters) sync to peers; fuse sparks and explosion VFX are local-only.

## TNT

Craft 4 planks + 1 coal ore into 3 TNT (inventory `[I]`). Place with right-click, ignite with left-click. The fuse burns 1.2 s, then the blast removes blocks in a 3.2-block radius (bedrock survives), shakes the camera, and knocks players back. Other TNT caught in the blast ignites with a short chain fuse. Craters persist like any other block edit.

The TNT texture under `public/assets/textures/pbr/tnt/` is the only tracked PBR source directory; its original author is unverified.

## Warsaw city district

The playable 96×96 district uses source voxel data from [stared/warsaw-vibe-voxel](https://github.com/stared/warsaw-vibe-voxel). It occupies world x=-80..15 and z=-112..-17, with a connector at x=4..7, z=-16..4, y=60. See the [source manifest](src/shared/warsaw-city-manifest.json) for pinned tiles and hashes.

The upstream source code is MIT-licensed; generated city data has separate ODbL and GUGiK attribution requirements. See the [design spec](docs/superpowers/specs/2026-11-03-giera-city-design.md).

The district uses committed voxel data pinned at revision `5ac94e8010450884690a6db4f4b289089e15bf27`. Rebuild it with `bun scripts/import-warsaw-city.ts --source-root "$HOME/.cache/giera/warsaw-vibe-voxel" --source-revision 5ac94e8010450884690a6db4f4b289089e15bf27`. Runtime generation is offline. Saved and LAN edits persist as overlays above immutable city data.

`cityTintIds` uses `255` for no tint. Tint IDs are runtime-only; saves and LAN edits do not store them.

Attribution:
- Source code: MIT license.
- OpenStreetMap-derived data: ODbL 1.0, © OpenStreetMap contributors.
- GUGiK NMPT/NMT 2025 and 2025 orthophotomap: open data under Article 40a of the Polish Geodetic and Cartographic Law.