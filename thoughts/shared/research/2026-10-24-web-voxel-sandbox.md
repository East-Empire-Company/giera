---
date: 2026-10-24
commit: d6941ff
branch: feat/giera-voxel-mvp
tags: [threejs, voxel, browser-game, choyce-engine]
status: complete
---
# Research: Browser voxel sandbox

## Summary

The new browser game can reuse Choyce Engine's block-grid, split-screen, camera, and short onboarding-loop concepts without inheriting its Godot renderer. The approved architecture uses three.js, TypeScript, Vite, and Bun; deterministic voxel generation and meshing stay in shared modules, while browser rendering and LAN transport remain separate.

## Files Involved

### Backend
| File | Layer | Purpose |
|---|---|---|
| `src/shared/blocks.ts` | Shared domain | Block IDs, hardness, source texture mapping |
| `src/shared/worldgen.ts` | Shared domain | Deterministic chunk generation |
| `server/index.ts` | Server | LAN HTTP and WebSocket entry point |
| `server/npc-bridge.ts` | Server integration | ElevenLabs conversation relay and TTS |
| `server/nemotron-proxy.ts` | Server integration | Authenticated proxy to NexGate LiteLLM |

### Frontend
| File | Layer | Purpose |
|---|---|---|
| `src/client/render/worldRenderer.ts` | Renderer | Chunk meshes and materials |
| `src/client/entities/player.ts` | Gameplay | Input, physics and shoulder camera |
| `src/client/game/recipes.ts` | Gameplay | Crafting rules and Polish labels |
| `src/client/net/client.ts` | Network | LAN WebSocket client |

### Existing reference project
| File | Layer | Purpose |
|---|---|---|
| `~/Repos/choyce-engine/src/adapters/inbound/gameplay/build_grid.gd` | Gameplay | 1 m block grid, undo history, block events |
| `~/Repos/choyce-engine/src/adapters/inbound/gameplay/split_screen_runtime.gd` | Multiplayer | Shared world and inventory for couch co-op |
| `~/Repos/choyce-engine/levels/sandbox_level.gd` | Level design | 116 m village and gather/craft/repair/reward loop |
| `~/Repos/choyce-engine/gameplay/player/sandbox_player.gd` | Player | Aim pivot and spring-arm camera |
| `~/Repos/choyce-engine/data/models/NOTICES.md` | Assets | Existing CC0 asset provenance |

## Data Flow

In offline mode, the browser derives deterministic chunks from a URL seed, loads edits and player state from IndexedDB, meshes visible chunks in workers, and renders them through two scissored views when couch co-op is active. In LAN mode, Bun owns world generation and edits; clients request chunks, send input and block changes, and apply authoritative broadcasts. NPC text travels from the game server through ElevenLabs Agents' custom-LLM endpoint to NexGate LiteLLM (`nemotron-bolt`); ElevenLabs handles speech synthesis and agent hosting.

## Existing Patterns

- `~/Repos/choyce-engine/src/adapters/inbound/gameplay/build_grid.gd:81-120` provides integer 1 m block placement, breaking, and history behavior.
- `~/Repos/choyce-engine/src/adapters/inbound/gameplay/split_screen_runtime.gd:40-100` shows two cameras sharing world and inventory state.
- `~/Repos/choyce-engine/levels/sandbox_level.gd:204-286` implements the gather/craft/repair/reward onboarding loop.
- `~/Repos/choyce-engine/gameplay/player/sandbox_player.gd:96-115` defines the aim pivot and spring-arm camera; asset credits live in `data/models/NOTICES.md`.

## Architecture Notes

- Godot's measured HTML5 performance decline applies to its own export and does not establish three.js performance.
- Three-dimensional 16³ chunks require `(cx, cy, cz)` identity. The approved plan's `chunkKey(cx, cz)` conflicts with its 3D chunk storage and 128-block vertical world; implement and test a 3D key, then use it consistently in saves and LAN frames.
- Keep `src/shared` independent of browser DOM and Bun runtime so world generation and codecs can be tested in both environments.
- Keep all downloaded art local, licensed, and listed in `public/assets/NOTICES.md`; omit unsupported visuals rather than synthesize replacements.
- Keep NexGate credentials server-side. Public access, if required by ElevenLabs, must use an authenticated, narrowly scoped HTTPS tunnel; do not expose port 4000.

## Engine selection evidence

- Three.js's current voxel guide demonstrates chunk-local geometry and adjacent-face culling; 0fps explains greedy meshing's polygon reduction and linear-time tradeoff: [Three.js voxel geometry](https://threejs.org/manual/pages/voxel-geometry.html), [0fps greedy meshing](https://0fps.net/2012/06/30/meshing-in-a-minecraft-game/).
- Godot 4 exports WebAssembly/WebGL 2, with web threading requiring cross-origin isolation; the prior 200-to-15–20 fps result is from this project's Godot export only, not a three.js benchmark: [Godot web export](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html), `~/Repos/choyce-engine/thoughts/shared/research/shell-architecture-2026-05-21.md`.
- Unity officially supports WebGL, but its larger editor/build workflow is unnecessary for this TypeScript-first project: [Unity Web platform](https://docs.unity3d.com/Manual/webgl.html).
- Bevy uses Rust and has a WebAssembly release path; adopting it would add a separate Rust/WASM toolchain: [Bevy setup and wasm-release profile](https://bevy.org/learn/quick-start/getting-started/setup/).
- React Three Fiber is a React renderer for three.js; plain three.js avoids adding React to a game-loop-only app: [R3F introduction](https://r3f.docs.pmnd.rs/getting-started/introduction).

## Verified asset inventory

| Runtime content | Downloaded source members | Source / license |
|---|---|---|
| Block tiles | `grass_top.png`, `grass_side.png`, `dirt.png`, `stone_generic.png`, `cobblestone.png`, `sand_ugly.png`, `oak_log_top.png`, `oak_log_side.png`, `oak_planks.png`, `glass.png` | [ARoach 16x16 Block Texture Set](https://opengameart.org/content/16x16-block-texture-set), CC0 |
| Foliage tile | `blocks/ginkgo_leaves.png` | [ARoach 16*16 Block Textures](https://opengameart.org/content/1616-block-textures), CC0 |
| Ore tiles | `default_mineral_coal.png`, `default_mineral_iron.png`, `default_mineral_gold.png` | [JoeEnderman Assorted Minecraft style textures](https://opengameart.org/content/assorted-minecraft-style-textures), CC0 |
| Water and sky | `PNG/Tiles/water.png`, `PNG/Other/clouds.png`, `PNG/Other/skybox_sideClouds.png` | [Kenney Voxel Pack](https://kenney.nl/assets/voxel-pack), CC0 |
| Player models | `character-a.glb`, `character-b.glb`; clips include `idle`, `walk`, `sprint` | [Kenney Blocky Characters v2](https://kenney.nl/assets/blocky-characters), CC0 |
| Particles and UI | Transparent `dirt_01`, `dirt_02`, `spark_01`, `smoke_01`, `star_01`; green UI button/check/star sprites | [Kenney Particle Pack](https://kenney.nl/assets/particle-pack), [Kenney UI Pack](https://kenney.nl/assets/ui-pack), CC0 |
| Icons | `axe_iron.png`, `pick_iron.png`, `ore_coal.png`, `ore_iron.png`, `ore_gold.png` | [Kenney Voxel Pack](https://kenney.nl/assets/voxel-pack), CC0 |
| Water normal | `Ice001_1K-JPG_NormalGL.jpg` | [ambientCG Ice 001](https://ambientcg.com/view?id=Ice001), CC0 / Public Domain |
| Crack overlay | `crackover.png` | [FacadeGaikan 64x overlay](https://opengameart.org/node/31077), CC0 |
| UI font | Pixelify Sans local TTF/CSS | [Google Fonts](https://fonts.google.com/specimen/Pixelify+Sans), SIL OFL 1.1 |

The fetched files are listed with exact source and license in `public/assets/NOTICES.md`. The atlas only arranges source pixels at native dimensions; a pixel-by-pixel comparison verified all 15 source tiles remain unchanged in the atlas.

## External Dependencies

- three.js, TypeScript, Vite, Bun, Vitest, Playwright, glTF Transform, and ffmpeg-static.
- ElevenLabs audio generation endpoints: [`GET /v1/user/subscription`](https://elevenlabs.io/docs/api-reference/user/subscription/get), [`POST /v1/sound-generation`](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert), [`POST /v1/music`](https://elevenlabs.io/docs/api-reference/music/compose), and [`POST /v1/text-to-speech/{voice_id}`](https://elevenlabs.io/docs/api-reference/text-to-speech/convert). Music API access requires a paid subscriber; do not purchase or upgrade a plan.
- NexGate LiteLLM OpenAI-compatible API using `nemotron-bolt` for all generated text.
- Kenney, OpenGameArt/ARoach, OpenGameArt/JoeEnderman, ambientCG, and Google Fonts assets under the licenses recorded in the approved plan.
- The original Kenney models are meshopt-compressed. `gltf-transform inspect` confirms embedded PNG texture remains present; compression warnings only note UV coordinates outside `[0,1]`, so those coordinates remain unquantized.

## Audio API contracts

- SFX accepts `text`, `duration_seconds` from 0.5 to 30 seconds, `loop`, `prompt_influence`, and `eleven_text_to_sound_v2` or v3. Music accepts prompts, 3 seconds to 10 minutes, and `music_v2_5`; paid API access required. TTS `eleven_v4_turbo` supports Polish and `language_code: "pl"`.
- Subscription endpoint returns `tier`, `status`, and character usage; the generator fails closed unless an active paid tier is present. It never buys, upgrades, retries failed generations, or sends API keys to browser code.
- Generated voice copy is produced by NexGate alias `nemotron-bolt`; ElevenLabs only synthesizes the returned Polish text.

## Open Questions

- A dedicated existing Cloudflare hostname/tunnel must reach the authenticated NexGate proxy for live NPCs; otherwise keep that path blocked.
