# Test Plan: Giera Voxel Sandbox MVP

**Feature**: Browser Voxel Sandbox Game for Kids (Ziemek & Gniewko)  
**Date**: 2026-10-24  
**Tester**: Automated (Vitest + Playwright) & Operator  

## Scope

### In Scope
1. **Voxel Core & World Generation**: Deterministic seed generation, 16³ chunk storage, greedy mesher with ambient occlusion, DDA raycast (up to 6m), AABB physics sweep, zero-void respawn (`y < -20`).
2. **Child-Friendly Visual Interface**:
   - 9-slot hotbar with large 32×32 pixelated PNG tile icons (no reading required).
   - Visual tutorial objective ribbon with star progress counters (★ ★ ★ ★).
   - Visual Xbox Controller Map modal with colored button badges and action icons.
   - 1-player vs. 2-player mode toggle with visual kid avatars.
3. **Gameplay Mechanics**:
   - Mining with `crackover.png` 3D overlay (opacity animated by progress).
   - Tool bonuses: `stone_axe` (3× wood speed), `iron_pickaxe` (3× stone/ore speed).
   - Block placing with player AABB collision prevention and creative mode infinite placing.
   - Crafting modal with 5 recipes, visual cost equations, and sound effects.
4. **Local Split-Screen Co-Op (Couch Play)**:
   - Single `WebGLRenderer` rendering dual scissored viewports (`w/2 × h`).
   - P1 (Ziemek) and P2 (Gniewko) avatars matching concept art colors.
   - Dual Xbox controller support: Gamepad 0 drives P1, Gamepad 1 drives P2.
5. **LAN Multiplayer**:
   - Bun server (`server/index.ts`) on port 8080 with WebSocket (`/ws`).
   - Binary chunk frame protocol with RLE compression.
   - Real-time block edit broadcasting and 20 Hz player position relay.
   - LAN connection modal in HUD.
6. **NPC Agents & Voice Input**:
   - Three NPCs: Mina, Staszek, Papuga.
   - Proximity prompt within 3m (`[E]`).
   - Web Speech API microphone input for kids with live speech recognition.
   - Client tools (`give_block`, `give_quest`, `share_map_hint`) and Nemotron proxy.
7. **Mobile / Touch Controls**:
   - Virtual joystick (left screen) and camera look (right screen).
   - Floating action buttons: `Kop` (Mine), `Staw` (Place), `Skok` (Jump), `Plecak` (Inventory).
8. **Persistence & PWA**:
   - IndexedDB auto-save every 30s + `visibilitychange` + `pagehide`.
   - `manifest.webmanifest` and `sw.js` precaching for offline play.

### Out of Scope
- Combat systems, player damage, drowning, death screens (child-safe creative mode).
- Voice biometric training or account registration.

## Test Environment

- **Local Web**: `http://localhost:5173/?seed=424242` / `http://localhost:4173/`
- **LAN Web/WS**: `http://<LAN-IP>:8080/` / `ws://<LAN-IP>:8080/ws`
- **Browsers**: Chromium (Playwright), Safari (macOS/iOS), Google Chrome, Microsoft Edge (Xbox Series X|S)
- **Devices**: Mac Studio (host), MacBooks, iPad/tablets, Xbox Series X|S

---

## Test Scenarios

### TC-001: World Boot & Loading Lifecycle [P1]
**Category**: Functional  
**Preconditions**: Dev server running on port 5173/4173.  
**Steps**:
1. Navigate to `/?seed=424242`.
2. Wait for `#boot-status` progress to reach 100%.
3. Verify `window.__GIERA__.ready === true`.
**Expected**: `#boot-status` hides with `.boot-ready`, canvas renders 3D voxel terrain, player avatar Ziemek is visible, console has zero errors.

### TC-002: Child Visual Hotbar & Block Selection [P1]
**Category**: Functional / UX  
**Preconditions**: Game booted.  
**Steps**:
1. Inspect the 9 hotbar slots.
2. Verify each slot contains a clear 32×32 image icon (`<img>`) of the block texture.
3. Press `Digit2` or cycle mouse wheel / controller bumpers (LB/RB).
**Expected**: Active slot highlights with glowing gold border and slight bounce; no text reading is required to identify the active block.

### TC-003: Mining with Visual Crack Overlay and Tool Bonuses [P1]
**Category**: Functional  
**Preconditions**: Player faces an oak log voxel within 5m.  
**Steps**:
1. Hold Left Mouse Button (or Xbox RT / Touch `Kop`).
2. Observe targeted block.
3. Continue holding until block breaks.
4. Craft a `stone_axe` and repeat on an oak log.
**Expected**:
- `crackover.png` overlay appears directly on voxel with opacity increasing from 0% to 100%.
- `dig_wood` sound plays.
- When `stone_axe` is in inventory, mining speed is 3× faster.
- Block vanishes, `inventory.blocks.oak_log` increments, and objective star lights up.

### TC-004: Creative Block Placing & Collision Safety [P1]
**Category**: Functional  
**Preconditions**: Hotbar slot with cobblestone selected.  
**Steps**:
1. Aim at the side of a tree or terrain block.
2. Click Right Mouse Button (or Xbox LT / Touch `Staw`).
3. Aim directly at player's own feet and click RMB.
**Expected**:
- Block is placed adjacent to targeted face, `place_block` sound plays.
- Placing inside player AABB is rejected (player cannot trap themselves).
- Placed block is immediately meshed and visible.

### TC-005: Visual Crafting & Recipe Execution [P1]
**Category**: Functional / UX  
**Preconditions**: Player gathered 4 oak logs.  
**Steps**:
1. Press `KeyI` (or Xbox `X` / Touch `Plecak`).
2. Verify inventory modal opens.
3. Click "Rób" button next to Deska (`planks`).
**Expected**:
- Modal displays visual equation: 4 oak logs ➔ 4 planks.
- `craft_ok` chime plays.
- 4 planks are added to inventory and hotbar.
- Objective advances to next step.

### TC-006: Local Split-Screen Couch Co-Op [P1]
**Category**: Multiplayer / Rendering  
**Preconditions**: 1-player mode active.  
**Steps**:
1. Click `.hud-mode-btn` (or press Xbox `Y` / `Menu`).
2. Observe canvas rendering.
3. Move P1 (WASD) and P2 (Arrows / Gamepad 1).
**Expected**:
- Viewport splits cleanly into two equal halves (left: Ziemek, right: Gniewko).
- Both brothers see each other in the same shared world.
- FPS stays ≥ 30 fps (measured 60 fps on Apple Silicon).

### TC-007: Xbox Series X|S Controller Edge Mappings [P1]
**Category**: Input / Console  
**Preconditions**: Game opened in Microsoft Edge on Xbox Series X|S with 2 wireless controllers.  
**Steps**:
1. Press `View` button on controller to toggle gamepad mode.
2. Press `RT` to mine, `LT` to place, `A` to jump.
3. Press `X` once.
4. Press `Y` once.
5. Press `LB` / `RB`.
**Expected**:
- Pressing `X` opens inventory modal cleanly without triggering mining (edge-triggered, no flickering).
- Pressing `Y` switches between 1-player and 2-player split screen on TV.
- `LB`/`RB` cycle hotbar slots with audible click.

### TC-008: Xbox Controller Map In-Game Menu [P2]
**Category**: UX / Documentation  
**Preconditions**: Game booted.  
**Steps**:
1. Click toolbar button `🎮 Pad / Xbox`.
2. Inspect modal contents.
**Expected**:
- Modal displays clear button badges: RT (Mine), LT (Place), A (Jump), X (Inventory), Y/Menu (Split-screen), LB/RB (Hotbar), Left Stick (Move), Right Stick (Look).
- Includes note on Microsoft Edge `View` button.

### TC-009: LAN Multiplayer Block Synchronization [P1]
**Category**: Networking  
**Preconditions**: Bun server running `PORT=8080 bun server/index.ts`.  
**Steps**:
1. Client A opens `http://<LAN-IP>:8080/` in room DOM1.
2. Client B opens same URL from second device.
3. Client B places a block at `(15, 42, 18)`.
**Expected**:
- Client A receives `{ t: 'block' }` broadcast and immediately sees the new block.
- Binary chunk frame syncs world state without discrepancies.

### TC-010: NPC Conversation & Child Microphone Input [P1]
**Category**: AI / Audio  
**Preconditions**: Game booted near spawn.  
**Steps**:
1. Walk within 2.5m of Mina.
2. Verify proximity ribbon appears: "Naciśnij [E], aby porozmawiać z Mina".
3. Press `KeyE`.
4. Click `🎙️ Mów teraz przez mikrofon` and speak: "Daj mi blok".
**Expected**:
- Microphone activates with pulsing red indicator.
- Recognized speech appears in input box.
- Mina answers warmly in Polish, adhering to child safety rules.

### TC-011: Abyss Fall Respawn Protection [P2]
**Category**: Safety / Physics  
**Preconditions**: Player walks off world or into deep pit.  
**Steps**:
1. Move player below `y < -20`.
**Expected**: Player instantly respawns safely at spawn coordinates with zero velocity. No death screen or lost items.

### TC-012: Offline PWA & Persistence [P2]
**Category**: Reliability  
**Preconditions**: Production build served.  
**Steps**:
1. Build game and open in browser.
2. Gather blocks and place a structure.
3. Reload browser with no network.
**Expected**: Service worker serves cached assets; IndexedDB restores player inventory and seed.

---

## Coverage Matrix

| Area | Functional | Input / UX | Multi-Device | Network / API | Reliability |
|---|---|---|---|---|---|
| **Voxel World** | TC-001, TC-011 | TC-003 | TC-006 | TC-009 | TC-012 |
| **Child Interface** | TC-002, TC-005 | TC-002, TC-008 | TC-007 | — | TC-008 |
| **Mining & Placing**| TC-003, TC-004 | TC-003, TC-007 | TC-006 | TC-009 | — |
| **Split-Screen** | TC-006 | TC-007 | TC-006, TC-007 | — | — |
| **LAN Server** | TC-009 | — | TC-009 | TC-009 | TC-009 |
| **NPC & Audio** | TC-010 | TC-010 | — | TC-010 | — |

---

## Risks & Assumptions

1. **Hardware**: Three.js r186 requires WebGL2. Only Chromium-based Microsoft Edge on Xbox Series X|S is supported; legacy Xbox One (EdgeHTML WebGL1) cannot run WebGL2.
2. **Audio Unlocking**: Browsers require one user click/tap on the canvas before Web Audio playback starts.
3. **Microphone Permissions**: Web Speech API requires user permission grant on first speech interaction.

## Verification Evidence Summary

- **Unit Tests**: 30 suites, 94 tests passing (`bun run test`).
- **E2E Tests**: 5 Playwright scenarios passing (`bun run test:e2e`).
- **Evidence Screenshots**: 5 PNG captures (>250 KB each) in `.ai/evidence/evidence-shots/` (`01-boot.png`, `02-split.png`, `03-lan-client-b.png`, `04-craft-panel.png`, `05-xbox-pad-map.png`).
- **Performance**: Verified 60 FPS in solo and 60 FPS in split-screen recorded in `.ai/evidence/perf.json`.
