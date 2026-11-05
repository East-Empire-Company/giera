# Giera Superhero Headquarters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the six factory-prop expansion unlocks with a non-destructive, persistent, multi-floor superhero headquarters containing real architecture, an elevator, decorated interiors, and functional block/gear dispensers.

**Architecture:** A shared pure plan defines each stage's voxel operations and interaction cells. A client construction controller preflights and applies those operations through the real world-edit path, while a separate art controller owns decorative meshes. The existing tycoon manager remains the progression authority; voxels provide architecture collision, and lightweight scripted interactions provide elevator and dispenser behavior.

**Tech Stack:** TypeScript, Three.js, Vite, Bun, Vitest, Playwright, Sharp, existing voxel world persistence and LAN block messages.

## Global Constraints

- Preserve production timing, collection, upgrade cost `dropperTier * 5`, expansion indices/costs/X/Z triggers, trampoline velocity `22`, product pool/path/timing, and existing save compatibility.
- Expansion costs remain exactly `20/30/40/50/60/70`; purchases remain independent and shared across split players.
- Construction never clears trees, excavates, or overwrites foreign/player cells. Foundation `surface` operations only replace an unedited generated surface block at the same Y.
- New-purchase preflight failure deducts zero stars and writes zero blocks.
- Use accumulated simulation delta only; no `Date.now()` or `Math.random()` in construction, elevator, dispenser, or art animation code.
- Headquarters architecture uses voxels, not `TycoonCollisionRoots`. Pads, holograms, labels, and small decor do not collide.
- Only the owning local tycoon emits block edits or grants inventory. Remote tycoons are visual-only.
- Implement directly without a feature flag. Do not weaken existing assertions to obtain green.
- Golden changes require explicit human acceptance and a recorded reason. Never auto-accept them.
- Do not use subagents, commits, deployment, or git-history mutations. Omit the usual per-task commit steps.
- Terrain/foliage/general collision repair is a separate follow-up plan. This plan only guarantees level tycoon sites and correct HQ collision.
- Stop temporary Vite/Playwright servers after verification. Do not claim Xbox performance from desktop evidence.

---

## File Structure

**Create**
- `src/shared/tycoon-base-plan.ts` — footprints, ordered voxel operations, elevator cells, dispenser definitions.
- `src/client/game/tycoon-base.ts` — preflight, construction, restoration, diagnostics.
- `src/client/game/tycoon-headquarters-art.ts` — staged interior/exterior decor and interaction visuals.
- `src/client/game/tycoon-elevator.ts` — deterministic single-platform, two-player ride state.
- `src/shared/gear-catalog.ts` — crafted and dispenser gear metadata/bonuses.
- `scripts/generate-hq-textures.ts` — reproducible original pixel textures.
- `tests/unit/tycoon-base-plan.test.ts`, `tycoon-base.test.ts`, `tycoon-headquarters-art.test.ts`, `tycoon-elevator.test.ts`, `gear-catalog.test.ts`.
- `tests/e2e/tycoon-headquarters.spec.ts` — real-input HQ mechanics.

**Modify**
- `src/shared/tycoon-slots.ts`, `src/shared/worldgen.ts` — reserved-site lookup and flat site generation.
- `src/shared/blocks.ts`, `src/shared/terrain-materials.ts`, `src/client/render/worldRenderer.ts` — four new blocks and glass bucket behavior.
- `scripts/fetch-assets.ts`, `scripts/build-atlas.ts`, `src/shared/asset-manifest.json`, `src/shared/atlas-manifest.json` — asset source and atlas registration.
- `src/client/game/tycoon-expansion.ts`, `tycoon.ts`, `tycoon-plot.ts` — replace expansion props with HQ integration; retain factory behavior.
- `src/client/game/inventory.ts`, `recipes.ts`, `hud.ts` — shared gear lookup, dispenser rewards, icons/equipment metadata.
- `src/main.ts` — world/inventory adapters, elevator stepping before physics, LAN edit submission.
- `server/ws-handler.ts` — use the shared reserved-site mask for companion protection without expanding it accidentally.
- `tests/e2e/mechanics.spec.ts`, `tests/e2e/lan.spec.ts`, `tests/e2e/goldens.spec.ts`, `playwright.config.ts` — integration coverage.
- Existing tycoon/unit tests whose names currently describe circles or factory expansion collision.

---

### Task 1: Level, Non-overlapping Sites for Every Tycoon Slot

**Files:**
- Modify: `src/shared/tycoon-slots.ts`
- Modify: `src/shared/worldgen.ts:90-127`
- Modify: `server/ws-handler.ts:488-492,526-531`
- Test: `tests/unit/tycoon-slots.test.ts`, `tests/unit/worldgen.test.ts`, `tests/unit/companion-room.test.ts`

**Interfaces:**
- Produces: `TYCOON_SITE_BOUNDS`, `tycoonSiteSlot(x,z): number | null`, and `tycoonSiteOriginHeight(slot,seed)` usage inside worldgen.
- Keeps `SLOT_PAD_HALF_SIZE = 5` for legacy transition math; the new reserved core overrides that math only inside the asymmetric site.

- [ ] **Step 1: Write failing site coverage tests**

```ts
import { describe, expect, it } from "vitest";
import { MAX_TYCOON_SLOTS, tycoonSiteSlot, tycoonSlotOrigin, TYCOON_SITE_BOUNDS } from "../../src/shared/tycoon-slots";
import { surfaceHeight } from "../../src/shared/worldgen";

describe("headquarters reserved sites", () => {
  it("assigns disjoint complete sites and keeps every site level", () => {
    for (const seed of [424242, 664938100]) {
      for (let slot = 0; slot < MAX_TYCOON_SLOTS; slot++) {
        const at = tycoonSlotOrigin(slot);
        const expected = surfaceHeight(at.x, at.z, seed);
        for (let x = at.x + TYCOON_SITE_BOUNDS.minX; x <= at.x + TYCOON_SITE_BOUNDS.maxX; x++) {
          for (let z = at.z + TYCOON_SITE_BOUNDS.minZ; z <= at.z + TYCOON_SITE_BOUNDS.maxZ; z++) {
            expect(tycoonSiteSlot(x, z)).toBe(slot);
            expect(surfaceHeight(x, z, seed)).toBe(expected);
          }
        }
      }
    }
  });

  it("leaves a two-block gap between neighboring sites", () => {
    const a = tycoonSlotOrigin(0);
    const b = tycoonSlotOrigin(1);
    expect(tycoonSiteSlot(a.x + 5, a.z)).toBe(0);
    expect(tycoonSiteSlot(a.x + 6, a.z)).toBeNull();
    expect(tycoonSiteSlot(b.x - 7, b.z)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests and confirm the missing API failure**

Run: `bunx vitest run tests/unit/tycoon-slots.test.ts tests/unit/worldgen.test.ts`
Expected: FAIL because `tycoonSiteSlot` and `TYCOON_SITE_BOUNDS` do not exist.

- [ ] **Step 3: Implement the pure site mask**

Add to `tycoon-slots.ts`:

```ts
export const TYCOON_SITE_BOUNDS = { minX: -7, maxX: 5, minZ: -8, maxZ: 8 } as const;

export function tycoonSiteSlot(x: number, z: number): number | null {
  for (let slot = 0; slot < MAX_TYCOON_SLOTS; slot++) {
    const at = tycoonSlotOrigin(slot);
    if (
      x >= at.x + TYCOON_SITE_BOUNDS.minX && x <= at.x + TYCOON_SITE_BOUNDS.maxX &&
      z >= at.z + TYCOON_SITE_BOUNDS.minZ && z <= at.z + TYCOON_SITE_BOUNDS.maxZ
    ) return slot;
  }
  return null;
}
```

At the start of `terrainSurfaceHeight`, before legacy pad weights:

```ts
const reservedSlot = tycoonSiteSlot(x, z);
if (reservedSlot !== null) {
  return reservedSlot === 0 ? TYCOON_SURFACE_HEIGHT : slotPadHeight(reservedSlot, seed);
}
```

Import `tycoonSiteSlot` in worldgen. In `protectedBlock` and companion site overlap checks, replace hand-written symmetric bounds with `tycoonSiteSlot(x,z) !== null`; for rectangular plan overlap, reject when any plan corner/cell resolves to a site. Do not change `TYCOON_TREE_CLEARANCE`, `SLOT_PAD_TREE_CLEARANCE`, or tree-site code.

- [ ] **Step 4: Verify sites and existing protection**

Run: `bunx vitest run tests/unit/tycoon-slots.test.ts tests/unit/worldgen.test.ts tests/unit/companion-room.test.ts`
Expected: PASS, including existing clear-pad/tree-buffer and protected-plot tests.

---

### Task 2: Original HQ Blocks and Atlas Registration

**Files:**
- Create: `scripts/generate-hq-textures.ts`, four PNGs under `public/assets/textures/tiles/`
- Modify: `src/shared/blocks.ts`, `src/shared/terrain-materials.ts`, `src/client/render/worldRenderer.ts`
- Modify: `scripts/fetch-assets.ts`, `scripts/build-atlas.ts`
- Modify: `src/shared/asset-manifest.json`, `src/shared/atlas-manifest.json`, `public/assets/NOTICES.md`
- Test: `tests/unit/blocks.test.ts`, `tests/unit/assets.test.ts`, `tests/unit/atlas.test.ts`, `tests/unit/terrain-materials.test.ts`

**Interfaces:**
- Produces block IDs `hero_floor=21`, `hero_wall=22`, `hero_glass=23`, `neon_block=24` and tile names matching those IDs.
- `hero_glass` uses `TERRAIN_MATERIAL.glass`; the other three use the merged opaque bucket.

- [ ] **Step 1: Write failing block/material tests**

```ts
import { describe, expect, it } from "vitest";
import { BLOCK_ID, getBlockDef } from "../../src/shared/blocks";
import { TERRAIN_MATERIAL, terrainMaterialFor } from "../../src/shared/terrain-materials";

describe("headquarters blocks", () => {
  it("defines four solid placeable block types", () => {
    expect(BLOCK_ID.hero_floor).toBe(21);
    expect(BLOCK_ID.hero_wall).toBe(22);
    expect(BLOCK_ID.hero_glass).toBe(23);
    expect(BLOCK_ID.neon_block).toBe(24);
    for (const id of [21, 22, 23, 24]) expect(getBlockDef(id).solid).toBe(true);
    expect(getBlockDef(23).tiles.side).toBe("hero_glass");
  });

  it("keeps opaque blocks merged and routes hero glazing to glass", () => {
    expect(terrainMaterialFor("hero_floor")).toBe(TERRAIN_MATERIAL.opaque);
    expect(terrainMaterialFor("hero_wall")).toBe(TERRAIN_MATERIAL.opaque);
    expect(terrainMaterialFor("neon_block")).toBe(TERRAIN_MATERIAL.opaque);
    expect(terrainMaterialFor("hero_glass")).toBe(TERRAIN_MATERIAL.glass);
  });
});
```

Add an atlas assertion that `atlasGridDimensions(25, 512, 8)` returns four columns, seven rows, and no overflow.

- [ ] **Step 2: Confirm failures**

Run: `bunx vitest run tests/unit/blocks.test.ts tests/unit/terrain-materials.test.ts tests/unit/atlas.test.ts`
Expected: FAIL on unknown block IDs, glass mapping, and the current 24-tile cap.

- [ ] **Step 3: Add reproducible original textures**

Create a Sharp script that writes 16×16 nearest-neighbor-friendly PNGs with these exact palettes/patterns:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const tiles = {
  hero_floor: { base: [25, 39, 70, 255], line: [48, 75, 118, 255], accent: [58, 225, 230, 255] },
  hero_wall: { base: [221, 230, 235, 255], line: [113, 139, 158, 255], accent: [34, 52, 86, 255] },
  hero_glass: { base: [60, 205, 225, 70], line: [175, 250, 255, 150], accent: [255, 255, 255, 190] },
  neon_block: { base: [22, 45, 58, 255], line: [35, 80, 88, 255], accent: [142, 255, 78, 255] },
} as const;

for (const [name, palette] of Object.entries(tiles)) {
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    const seam = x === 7 || y === 7;
    const bolt = (x === 2 || x === 13) && (y === 2 || y === 13);
    const color = bolt ? palette.accent : border || seam ? palette.line : palette.base;
    color.forEach((channel, i) => { pixels[(y * 16 + x) * 4 + i] = channel; });
  }
  await mkdir("public/assets/textures/tiles", { recursive: true });
  await writeFile(`public/assets/textures/tiles/${name}.png`, await sharp(pixels, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer());
}
```

Add a `giera-original` asset source (`Giera contributors`, project MIT license) and four `preplaced: true` tile picks. Extend `packagePbrAssets()` so it merges only tile picks whose source is `ambientcg-pbr` or `giera-original` into the existing manifest, and extend its notices merge for those same sources. It must preserve every existing model, animation, font, and other manifest entry; do not use `packageSelectedAssets()` for this task.

- [ ] **Step 4: Register blocks and rendering behavior**

Append block IDs 21–24 with hardness `1.5`, `1.5`, `0.3`, and `1.2`; all are solid and non-liquid. Give each block the same-named top/bottom/side tile.

Map `hero_glass` to the glass bucket. In `worldRenderer.ts`, replace glass-only predicates with:

```ts
const glass = name === "glass" || name === "hero_glass";
```

Use that same boolean for `ormMaps`, `transparent`, opacity (`0.3`), environment intensity, and cache-key selection. Add all four names to `PBR_SOURCES` with `null`, and raise `MAX_TILES` to `32`.

- [ ] **Step 5: Rebuild manifests/atlases and verify content**

Run: `bun scripts/generate-hq-textures.ts && bun scripts/fetch-assets.ts --pbr-only && bun run assets:atlas && bunx vitest run tests/unit/blocks.test.ts tests/unit/assets.test.ts tests/unit/atlas.test.ts tests/unit/terrain-materials.test.ts`
Expected: 25 tiles packed successfully; all listed tests PASS and every manifest path exists. Snapshot the existing manifest before running the asset command and verify that only the four new tile paths changed.

---

### Task 3: Pure Stage Plans and Non-destructive Construction Controller

**Files:**
- Create: `src/shared/tycoon-base-plan.ts`
- Create: `src/client/game/tycoon-base.ts`
- Test: `tests/unit/tycoon-base-plan.test.ts`, `tests/unit/tycoon-base.test.ts`

**Interfaces:**
- `BaseBlockOp = { x:number; y:number; z:number; id:BlockId; kind:"air"|"surface"|"verify" }`.
- `baseStagePlan(stage:number): readonly BaseBlockOp[]` returns local coordinates.
- `HQ_FOOTPRINT`, `HQ_ELEVATOR`, `HQ_DISPENSERS` provide shared interaction layout.
- `TycoonBase.preflight(stage): boolean`, `start(stage): boolean`, `restore(stages): void`, `update(delta): void`, `dispose(): void`.

- [ ] **Step 1: Write failing plan and safety tests**

```ts
import { describe, expect, it } from "vitest";
import { BLOCK_ID } from "../../src/shared/blocks";
import { baseStagePlan, HQ_ELEVATOR, HQ_FOOTPRINT } from "../../src/shared/tycoon-base-plan";

describe("HQ stage plans", () => {
  it("builds a same-height foundation inside the footprint", () => {
    const floor = baseStagePlan(0);
    expect(floor).toHaveLength(13 * 9);
    expect(floor.every((op) => op.y === 0 && op.id === BLOCK_ID.hero_floor && op.kind === "surface")).toBe(true);
    expect(floor.every((op) => op.x >= HQ_FOOTPRINT.minX && op.x <= HQ_FOOTPRINT.maxX && op.z >= 0 && op.z <= 8)).toBe(true);
  });

  it("keeps a two-block entrance and exactly one upper shaft opening", () => {
    const shell = baseStagePlan(1);
    expect(shell.some((op) => op.z === 0 && (op.x === -1 || op.x === 0) && (op.y === 1 || op.y === 2))).toBe(false);
    const upper = baseStagePlan(2);
    expect(upper.filter((op) => op.y === 4 && op.x === HQ_ELEVATOR.x && op.z === HQ_ELEVATOR.z)).toHaveLength(0);
    expect(upper.some((op) => op.y === 4 && op.x === 1 && op.z === 3)).toBe(true);
  });

  it("is deterministic and has no duplicate coordinates within a stage", () => {
    for (let stage = 0; stage < 6; stage++) {
      expect(baseStagePlan(stage)).toEqual(baseStagePlan(stage));
      const keys = baseStagePlan(stage).map((op) => `${op.x},${op.y},${op.z}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
```

Controller tests use a fake world containing generated grass at local Y0 and air above. Assert: blocked preflight costs/writes nothing; `start(0)` writes four operations per `update(1/60)`; repeated `restore([0])` is idempotent; a foreign player block is preserved and returned in diagnostics.

- [ ] **Step 2: Run the new tests and confirm missing-module failure**

Run: `bunx vitest run tests/unit/tycoon-base-plan.test.ts tests/unit/tycoon-base.test.ts`
Expected: FAIL because the plan and controller modules do not exist.

- [ ] **Step 3: Implement exact structural plans**

Use local Y0 for the existing ground block, Y1–3 for ground walls, Y4 for the second-floor block, Y5–7 for upper walls, and Y8 for roof. Generate:

```ts
export const HQ_FOOTPRINT = { minX: -7, maxX: 5, minZ: 0, maxZ: 8 } as const;
export const HQ_ELEVATOR = { x: 1, z: 2, groundCallZ: 1, upperCallZ: 3, upperY: 5 } as const;

export function baseStagePlan(stage: number): readonly BaseBlockOp[] {
  const ops: BaseBlockOp[] = [];
  const add = (x:number,y:number,z:number,id:BlockId,kind:BaseBlockOp["kind"]="air") => ops.push({x,y,z,id,kind});
  if (stage === 0) {
    for (let z = 0; z <= 8; z++) for (let x = -7; x <= 5; x++) add(x,0,z,BLOCK_ID.hero_floor,"surface");
  }
  if (stage === 1 || stage === 2) {
    const minWallY = stage === 1 ? 1 : 5;
    const maxWallY = stage === 1 ? 3 : 7;
    for (let y = minWallY; y <= maxWallY; y++) for (let z = 0; z <= 8; z++) for (let x = -7; x <= 5; x++) {
      if (x !== -7 && x !== 5 && z !== 0 && z !== 8) continue;
      if (stage === 1 && z === 0 && (x === -1 || x === 0) && y <= 2) continue;
      const window = (y === minWallY + 1) && ((x + z) % 3 === 0) && !(x === -7 && z === 0) && !(x === 5 && z === 8);
      add(x,y,z,window ? BLOCK_ID.hero_glass : BLOCK_ID.hero_wall,"verify");
    }
  }
  if (stage === 2) {
    for (const [x,z] of [[-6,1],[4,1],[-6,7],[4,7]] as const) for (let y=1;y<=3;y++) add(x,y,z,BLOCK_ID.hero_wall,"verify");
    for (let z=0;z<=8;z++) for (let x=-7;x<=5;x++) if (x!==1 || z!==2) add(x,4,z,BLOCK_ID.hero_floor,"verify");
    for (let z=0;z<=8;z++) for (let x=-7;x<=5;x++) add(x,8,z,BLOCK_ID.roof_tile,"verify");
  }
  return ops;
}
```

Stages 3–5 intentionally return empty block plans; their deliverables are art and functional interactions in later tasks.

- [ ] **Step 4: Implement preflight, ordered writes, and restoration**

Define the adapter and controller:

```ts
export type BaseWorld = {
  getBlock(x:number,y:number,z:number): number;
  getGeneratedBlock(x:number,y:number,z:number): number;
  hasEdit(x:number,y:number,z:number): boolean;
  setBlock(x:number,y:number,z:number,id:number): void;
};

export class TycoonBase {
  private queue: BaseBlockOp[] = [];
  readonly diagnostics: string[] = [];
  constructor(private origin:{x:number;y:number;z:number}, private world:BaseWorld) {}
  private current(op:BaseBlockOp) { return this.world.getBlock(this.origin.x+op.x,this.origin.y+op.y,this.origin.z+op.z); }
  private compatible(op:BaseBlockOp, restoring=false) {
    const x=this.origin.x+op.x, y=this.origin.y+op.y, z=this.origin.z+op.z;
    const current=this.world.getBlock(x,y,z);
    if (current===op.id) return true;
    if (current!==BLOCK_ID.air) {
      if (op.kind!=="surface" || restoring || this.world.hasEdit(x,y,z)) return false;
      return current===this.world.getGeneratedBlock(x,y,z);
    }
    return op.kind!=="surface";
  }
  preflight(stage:number) { return baseStagePlan(stage).every((op)=>this.compatible(op)); }
  start(stage:number) {
    const plan=baseStagePlan(stage);
    if (!plan.every((op)=>this.compatible(op))) return false;
    this.queue.push(...plan);
    return true;
  }
  update(_delta:number) {
    for (let count=0;count<4 && this.queue.length;count++) {
      const op=this.queue.shift()!;
      if (!this.compatible(op)) { this.diagnostics.push(`Skipped foreign HQ cell ${op.x},${op.y},${op.z}`); continue; }
      if (this.current(op)!==op.id) this.world.setBlock(this.origin.x+op.x,this.origin.y+op.y,this.origin.z+op.z,op.id);
    }
  }
  restore(stages:readonly number[]) {
    this.queue.length=0;
    for (const stage of stages) for (const op of baseStagePlan(stage)) {
      if (this.current(op)===op.id) continue;
      if (!this.compatible(op,true)) { this.diagnostics.push(`Preserved foreign HQ cell ${op.x},${op.y},${op.z}`); continue; }
      this.world.setBlock(this.origin.x+op.x,this.origin.y+op.y,this.origin.z+op.z,op.id);
    }
  }
  dispose() { this.queue.length=0; }
}
```

Main's adapter will submit each `setBlock` through the existing local/LAN path. The fixed operation budget is four per update; `_delta` remains explicit so construction scheduling has one simulation-time boundary.

- [ ] **Step 5: Verify all construction safety tests**

Run: `bunx vitest run tests/unit/tycoon-base-plan.test.ts tests/unit/tycoon-base.test.ts tests/unit/tycoon.test.ts`
Expected: PASS, including foreign-cell preservation and no duplicate restore writes.

---

### Task 4: Replace Circular Expansions with Real HQ Stages

**Files:**
- Modify: `src/client/game/tycoon-expansion.ts`
- Modify: `src/client/game/tycoon.ts`
- Modify: `src/client/game/tycoon-plot.ts` (remove obsolete expansion-part provider only)
- Modify: `src/main.ts:261-272,395-403`
- Test: `tests/unit/tycoon-expansion.test.ts`, `tests/unit/tycoon.test.ts`, `tests/e2e/tycoon-headquarters.spec.ts`, `playwright.config.ts`

**Interfaces:**
- `TycoonExpansionOptions` adds `preflight?(index):boolean`, `build(index,restored):void`, and `art?:HeadquartersArt`.
- `TycoonManagerOptions` adds `base?:TycoonBase` and `headquarters?:HeadquartersArt`.
- `getCollisionBodies()` continues returning the factory-only stable array; HQ collision comes from world blocks.

- [ ] **Step 1: Replace circle/module assertions with HQ assertions**

```ts
it("builds a purchased HQ stage once and restores it without growth replay", () => {
  const calls: [number, boolean][] = [];
  const expansion = new TycoonExpansion({
    groundAt: () => 0,
    preflight: () => true,
    build: (index, restored) => calls.push([index, restored]),
  });
  expect(expansion.claim(0)).toBe(true);
  expect(expansion.claim(0)).toBe(false);
  expansion.restore([0]);
  expect(calls).toEqual([[0,false],[0,true]]);
  expect(expansion.getCollisionBodies()).toHaveLength(0);
  expect(expansion.group.getObjectByName("hq-kiosk-0")).toBeDefined();
  expect(expansion.group.getObjectByName("expansion-ring-0")).toBeUndefined();
});

it("does not claim an obstructed stage", () => {
  const expansion = new TycoonExpansion({ groundAt:()=>0, preflight:()=>false });
  expect(expansion.claim(0)).toBe(false);
  expect(expansion.stateOf(0)).toBe("locked");
});
```

Add a manager test proving `buyExpansion(0)` checks preflight before subtracting 20 stars. Rename remaining circle-specific test names to headquarters stages without changing economy assertions.

- [ ] **Step 2: Run focused tests and capture intended old-behavior failure**

Run: `bunx vitest run tests/unit/tycoon-expansion.test.ts tests/unit/tycoon.test.ts`
Expected: FAIL because circular pads, factory modules, and preflight hooks still reflect the old expansion purpose. Do not loosen economy assertions.

- [ ] **Step 3: Implement kiosks and construction hooks**

Replace ring/disc geometry with a thin `BoxGeometry(1.5,0.08,1.5)` kiosk named `hq-kiosk-${index}` plus a holographic stage icon. Preserve `ExpansionSlot`, states, costs, `ownedIndices`, and trigger calculations.

Use this claim contract:

```ts
claim(index:number): boolean {
  if (this.isOwned(index) || !this.slots.some((slot)=>slot.index===index)) return false;
  if (!(this.preflight?.(index) ?? true)) return false;
  this.states.set(index,"owned");
  this.paint(index);
  this.build?.(index,false);
  return true;
}
```

`restore` calls `build(index,true)` once per owned index. Remove factory cloning, `createExpansionArt`, growth, and expansion collision roots. Keep `setLabelsHidden`, material registration, label disposal, and menu behavior. `TycoonManager.buyExpansion` already routes through `claim`; ensure no currency is subtracted when it returns false.

In `makeTycoon`, only the owning local manager receives a `TycoonBase`; remote managers receive no world-writing adapter. Construct the local base with this adapter, but do not invoke any adapter method until initialization is complete:

```ts
const base = new TycoonBase(at, {
  getBlock: (x,y,z)=>world.getBlock(x,y,z),
  getGeneratedBlock: (x,y,z)=>generateBlock(x,y,z,seed),
  hasEdit: (x,y,z)=>world.hasEdit(x,y,z),
  setBlock: (x,y,z,id)=>{ world.setBlock(x,y,z,id); lanClient?.sendBlockEdit(x,y,z,id); },
});
```

Add a `localConstructionReady` gate and retain pending tycoon progress. `preflight` returns false while the gate is closed, and `build` calls `base.start(index)` or `base.restore([index])` only while it is open. Remove the early `saved.tycoon` restore. For offline play, open the gate and call `tycoon.restore(saved.tycoon)` only after `world` has been constructed and `world.applySavedEdits(saved)` has completed. For LAN play, wait until the room session is active and the initial room sync—including an empty sync—has completed, then restore once; matching restored cells must emit no edits. Slot changes dispose the old base, construct a new local base, and restore the pending progress only when the same readiness conditions hold. Call `base.update(delta)` only for the owning local manager and dispose it with the slot. This avoids the current `makeTycoon`-before-`WorldRenderer` initialization-order bug and prevents restoration from racing LAN state.

- [ ] **Step 4: Add real-input foundation and shell browser coverage**

Configure the mechanics project to include `tycoon-headquarters.spec.ts`. Use existing QA helpers to add exact stars and position near a kiosk, then real WASD to enter it. Assert:

```ts
const purchased = await page.evaluate(() => window.__GIERA__.tycoon.toJSON());
expect(purchased.expansions).toContain(0);
const floor = await page.evaluate(() => {
  const g=window.__GIERA__, at=g.tycoon.origin;
  return g.world.getBlock(at.x,at.y,at.z) === 21;
});
expect(floor).toBe(true);
```

Walk through the two-block doorway, verify wall collision with real input, and assert the stage 2 floor, roof, supports, and shaft opening structurally through the world API. Reload and assert matching blocks plus unchanged currency/expansions. Do not require walking onto the upper floor until Task 6 implements the elevator.

- [ ] **Step 5: Run integrated regression checks**

Run: `bun run typecheck && bunx vitest run tests/unit/tycoon-expansion.test.ts tests/unit/tycoon.test.ts tests/unit/tycoon-base.test.ts && bunx playwright test --project=mechanics --grep "tycoon|headquarters"`
Expected: PASS; no page errors and no factory collision regressions.

---

### Task 5: Command Room, Labs, Neon, and Rooftop Art

**Files:**
- Create: `src/client/game/tycoon-headquarters-art.ts`
- Modify: `src/client/game/tycoon-expansion.ts`, `src/client/game/tycoon.ts`
- Test: `tests/unit/tycoon-headquarters-art.test.ts`, `tests/unit/tycoon-menu-labels.test.ts`

**Interfaces:**
- `createHeadquartersArt(): HeadquartersArt`.
- `HeadquartersArt = { root:THREE.Group; setOwned(indices):void; update(delta):void; setElevatorHeight(y:number):void; dispose():void }`.
- Stable object names: `hq-stage-0`…`hq-stage-5`, `hq-command-room`, `hq-elevator-platform`, `hq-block-lab`, `hq-gadget-lab`, `hq-rooftop-antenna`.

- [ ] **Step 1: Write failing staged-art tests**

```ts
const art=createHeadquartersArt();
expect(art.root.children).toHaveLength(6);
expect(art.root.getObjectByName("hq-stage-3")!.visible).toBe(false);
art.setOwned([0,2,3,5]);
expect(art.root.getObjectByName("hq-stage-0")!.visible).toBe(true);
expect(art.root.getObjectByName("hq-stage-1")!.visible).toBe(false);
expect(art.root.getObjectByName("hq-command-room")).toBeDefined();
expect(art.root.getObjectByName("hq-rooftop-antenna")).toBeDefined();
art.setElevatorHeight(3.5);
expect((art.root.getObjectByName("hq-elevator-platform") as THREE.Object3D).position.y).toBe(3.5);
const beacon=art.root.getObjectByName("hq-rooftop-antenna")!;
art.update(0.5);
expect(beacon.rotation.y).toBeGreaterThan(0);
art.dispose();
expect(art.root.parent).toBeNull();
```

- [ ] **Step 2: Run the art test and confirm missing-module failure**

Run: `bunx vitest run tests/unit/tycoon-headquarters-art.test.ts`
Expected: FAIL because the art module does not exist.

- [ ] **Step 3: Implement shared-material staged geometry**

Use four shared `MeshStandardMaterial` roles: navy (`0x192746`), ceramic (`0xdde6eb`), cyan emissive (`0x35dce3`, intensity `0.8`), and lime emissive (`0x8eff4e`, intensity `0.65`). Reuse unit box/cylinder geometries through helpers:

```ts
function box(parent:THREE.Group,name:string,material:THREE.Material,x:number,y:number,z:number,sx:number,sy:number,sz:number) {
  const mesh=new THREE.Mesh(sharedBox,material);
  mesh.name=name; mesh.position.set(x,y,z); mesh.scale.set(sx,sy,sz);
  mesh.receiveShadow=true; parent.add(mesh); return mesh;
}
```

Build exactly:
- Stage 0: twelve perimeter light posts and one construction beacon.
- Stage 1: a two-meter cyan star emblem above the entrance and navy roof-trim strips.
- Stage 2: elevator platform/rails, two arrow call pads, and upper railing strips around (but not across) the shaft route.
- Stage 3 (`hq-command-room`): three rear consoles with animated monitor bars, two gaming desk/chair pairs along the right wall, one sofa and table along the left wall, six trophy displays, four ceiling fixtures, and two neon lightning signs.
- Stage 4 (`hq-block-lab`): four dispenser housings at X `-5,-3,-1,1`, Z `7`, each displaying its block texture/color and a rotating cube.
- Stage 5 (`hq-gadget-lab`): three armory housings at X `-6`, Z `2,4,7`, tool silhouettes, and `hq-rooftop-antenna` at Y9 with a rotating beacon.

Attach each stage root to expansion ownership with `setOwned(ownedIndices())`; restoration changes visibility only. Update monitor emissive intensity, display cubes, and antenna rotation using accumulated `delta`. Register materials with CSM, but only large emblem/platform meshes cast shadows. Disposal disposes shared geometry/materials once and removes the root.

- [ ] **Step 4: Verify art, launch, and allocation behavior**

Run: `bunx vitest run tests/unit/tycoon-headquarters-art.test.ts tests/unit/tycoon-menu-labels.test.ts tests/unit/tycoon-expansion.test.ts && bun run typecheck`
Expected: PASS; six staged roots, no duplicate roots after repeated restore, and no per-frame material creation.

---

### Task 6: Working Two-level Elevator

**Files:**
- Create: `src/client/game/tycoon-elevator.ts`
- Modify: `src/client/game/tycoon.ts`, `src/main.ts` (before each player physics step)
- Modify: `src/client/game/tycoon-headquarters-art.ts`
- Test: `tests/unit/tycoon-elevator.test.ts`, `tests/e2e/tycoon-headquarters.spec.ts`

**Interfaces:**
- `TycoonElevator.step(playerIndex:0|1, position:Position3, delta:number, owned:boolean): Position3 | null` returns a scripted position only while riding.
- `platformHeight():number` drives the single visual platform.
- One global ride owns the platform; the other player continues normal physics until it finishes.

- [ ] **Step 1: Write failing ride/rearm/split tests**

```ts
const elevator=new TycoonElevator({x:0,y:60,z:0});
const ground={x:1.5,y:61,z:1.5};
expect(elevator.step(0,ground,1/60,true)).toEqual({x:1.5,y:61,z:1.5});
let pose=ground;
for(let i=0;i<90;i++) pose=elevator.step(0,pose,1/60,true) ?? pose;
expect(pose).toEqual({x:1.5,y:65,z:3.5});
expect(elevator.platformHeight()).toBe(4);
expect(elevator.step(0,pose,1/60,true)).toBeNull(); // arrival does not immediately reverse

const other=new TycoonElevator({x:0,y:60,z:0});
other.step(0,ground,1/60,true);
expect(other.step(1,ground,1/60,true)).toBeNull(); // one platform, sequential rides
```

Also test downward travel after leaving/re-entering the upper call pad, zero velocity applied by main, and no activation when stage 2 is absent.

- [ ] **Step 2: Run elevator tests and confirm missing-module failure**

Run: `bunx vitest run tests/unit/tycoon-elevator.test.ts`
Expected: FAIL because `TycoonElevator` does not exist.

- [ ] **Step 3: Implement deterministic three-segment rides**

Use duration `1.2` seconds: 0.15 center-in, 0.85 vertical, 0.20 exit. Interpolate ground `(1.5,61,1.5)` → shaft `(1.5,61,2.5)` → upper `(1.5,65,2.5)` → exit `(1.5,65,3.5)` relative to origin Y60. Reverse those points for downward rides.

```ts
export class TycoonElevator {
  private ride:{player:0|1;direction:"up"|"down";time:number}|null=null;
  private readonly armed=[true,true];
  private height=0;
  constructor(private origin:Position3){}
  step(player:0|1,pos:Position3,delta:number,owned:boolean):Position3|null {
    if(!owned){this.ride=null;this.height=0;return null;}
    if(this.ride){
      if(this.ride.player!==player)return null;
      this.ride.time=Math.min(1.2,this.ride.time+delta);
      const t=this.ride.time, up=this.ride.direction==="up";
      const y0=this.origin.y+1, y1=this.origin.y+5;
      let x=this.origin.x+1.5,y=y0,z=this.origin.z+1.5;
      if(t<0.15){const q=t/0.15;z=this.origin.z+1.5+q;}
      else if(t<1){const q=(t-0.15)/0.85;y=up?y0+4*q:y1-4*q;z=this.origin.z+2.5;}
      else{const q=(t-1)/0.2;y=up?y1:y0;z=this.origin.z+(up?2.5+q:2.5-q);}
      this.height=y-this.origin.y-1;
      if(t===1.2){this.armed[player]=false;this.ride=null;}
      return{x,y,z};
    }
    const level=Math.abs(pos.y-(this.origin.y+1))<0.5?"ground":Math.abs(pos.y-(this.origin.y+5))<0.5?"upper":null;
    if(!level)return null;
    const callZ=this.origin.z+(level==="ground"?1.5:3.5);
    const near=Math.hypot(pos.x-(this.origin.x+1.5),pos.z-callZ)<0.75;
    if(!near){this.armed[player]=true;return null;}
    if(!this.armed[player])return null;
    this.ride={player,direction:level==="ground"?"up":"down",time:0};
    return{x:this.origin.x+1.5,y:pos.y,z:pos.z};
  }
  platformHeight(){return this.height;}
}
```

Before normal `player.step`/`player2.step`, call the controller for that player. When it returns a pose, copy position, set `velocity.set(0,0,0)`, set `onGround=false`, sync avatar, and skip physics/input for that frame. Feed `platformHeight()` to HQ art once per frame. Reset ride state on disposal/slot change; never serialize it.

- [ ] **Step 4: Verify unit and real-input travel**

Extend `tycoon-headquarters.spec.ts`: after purchasing stage 2, use real WASD to reach the ground call pad, ride to the upper floor, walk off through the safe arrival cell, leave and re-enter the upper call pad, and ride down. Assert positions and solid arrivals through QA state, with zero page errors.

Run: `bunx vitest run tests/unit/tycoon-elevator.test.ts && bunx playwright test --project=mechanics --grep "headquarters.*elevator|elevator"`
Expected: PASS for up/down, safe solid arrivals, no immediate reversal, split sequential use, and zero page errors.

---

### Task 7: Block and Gear Dispensers with Real Inventory Rewards

**Files:**
- Modify: `src/shared/tycoon-base-plan.ts`, `src/client/game/tycoon.ts`, `src/main.ts`
- Create: `src/shared/gear-catalog.ts`, `tests/unit/gear-catalog.test.ts`
- Modify: `src/client/game/inventory.ts`, `recipes.ts`, `hud.ts`
- Modify: `src/client/entities/dummy.ts`
- Modify: `src/client/game/tycoon-headquarters-art.ts`
- Test: `tests/unit/tycoon.test.ts`, `tests/unit/inventory.test.ts`, `tests/unit/hud.test.ts`, `tests/unit/dummy.test.ts`, `tests/e2e/tycoon-headquarters.spec.ts`

**Interfaces:**
- `HQ_DISPENSERS: readonly {id:string;stage:4|5;kind:"block"|"gear";item:string;count:number;x:number;z:number}[]`.
- `TycoonManager.tryDispenser(position,onReward):string|null` checks stage, distance, and cooldown.
- `gearBonus(item):{material:"wood"|"stone"|"iron"|"combat";speedMultiplier:number}|undefined`.
- `GameInventory.getCombatMultiplier():number` and `TrainingDummy.hit(multiplier?:number)` make combat gear mechanically effective rather than cosmetic.

- [ ] **Step 1: Write failing reward and gear tests**

```ts
expect(HQ_DISPENSERS).toHaveLength(7);
expect(HQ_DISPENSERS.filter((d)=>d.stage===4).map((d)=>[d.item,d.count])).toEqual([
  ["hero_floor",8],["hero_wall",8],["hero_glass",8],["neon_block",8],
]);
expect(HQ_DISPENSERS.filter((d)=>d.stage===5).map((d)=>d.item)).toEqual(["star_pickaxe","star_axe","pulse_sword"]);
expect(gearBonus("star_pickaxe")).toEqual({material:"stone",speedMultiplier:5});
expect(gearBonus("star_axe")).toEqual({material:"wood",speedMultiplier:5});
expect(gearBonus("pulse_sword")).toEqual({material:"combat",speedMultiplier:4.5});
```

Manager tests: no reward before owning the required stage; first walk-on grants once; immediate second activation grants nothing; activation after exactly eight seconds grants again; primary and secondary share the dispenser cooldown; `updateVisuals` alone never invokes the reward callback. Inventory tests prove existing recipe multipliers are unchanged, new blocks enter an empty hotbar slot, and owned/equipped combat gear returns the exact combat multiplier. Dummy tests prove the default hit impulse remains `14` and `hit(4.5)` produces `14 * 4.5`, so the pulse sword has an observable gameplay effect.

- [ ] **Step 2: Run reward/gear tests and confirm missing API failure**

Run: `bunx vitest run tests/unit/gear-catalog.test.ts tests/unit/inventory.test.ts tests/unit/dummy.test.ts tests/unit/tycoon.test.ts`
Expected: FAIL on missing dispenser definitions, gear catalog, and combat multiplier API.

- [ ] **Step 3: Implement catalog, cooldown authority, and combat wiring**

Define dispenser positions exactly as in Task 5 and cooldown `8`:

```ts
export const HQ_DISPENSERS = [
  {id:"floor",stage:4,kind:"block",item:"hero_floor",count:8,x:-5,z:7},
  {id:"wall",stage:4,kind:"block",item:"hero_wall",count:8,x:-3,z:7},
  {id:"glass",stage:4,kind:"block",item:"hero_glass",count:8,x:-1,z:7},
  {id:"neon",stage:4,kind:"block",item:"neon_block",count:8,x:1,z:7},
  {id:"pickaxe",stage:5,kind:"gear",item:"star_pickaxe",count:1,x:-6,z:2},
  {id:"axe",stage:5,kind:"gear",item:"star_axe",count:1,x:-6,z:4},
  {id:"sword",stage:5,kind:"gear",item:"pulse_sword",count:1,x:-6,z:7},
] as const;
```

Create one catalog containing every existing recipe bonus plus the three new values. Recipes obtain `toolBonus` via `gearBonus(recipe.output.item)` so values are not duplicated. Inventory mining and combat lookups iterate the catalog instead of recipes. Combat lookup returns the equipped matching bonus, or the best owned combat bonus when no matching weapon is equipped, mirroring mining behavior. HUD equipment metadata comes from the same catalog; icons map new blocks to their tile paths and new gear to existing pick/axe icon shapes.

Change `TrainingDummy.hit(multiplier = 1)` to scale its existing hit impulse by that multiplier while retaining the current spring/update behavior. In the dummy branch in `main.ts`, call `trainingDummy.hit(inventory.getCombatMultiplier())`. This wires both existing swords and `pulse_sword` into real combat feedback instead of adding a cosmetic-only item.

In `TycoonManager`, decrement cooldowns once in `updateVisuals`, and implement:

```ts
tryDispenser(pos:Position3,onReward:(item:string,count:number)=>void):string|null {
  const found=HQ_DISPENSERS.find((d)=>this.expansion.isOwned(d.stage)&&Math.hypot(pos.x-(this.origin.x+d.x),pos.z-(this.origin.z+d.z))<0.85&&Math.abs(pos.y-(this.origin.y+1))<1);
  if(!found||((this.cooldowns.get(found.id)??0)>0))return null;
  this.cooldowns.set(found.id,8);
  onReward(found.item,found.count);
  return found.id;
}
```

Call it from primary/secondary local interaction updates only. Main grants blocks with `inventory.addMinedBlock(item,count)` and gear by incrementing `inventory.items[item]`, then calls `syncHotbarWithBlocks()` and existing pickup feedback. Remote plots never call it.

- [ ] **Step 4: Verify rewards through real gameplay systems**

Browser test: purchase stage 4, walk onto each pad, place one of each rewarded block using real mouse input, wait for the cooldown through QA simulation frames, and verify another grant. Purchase stage 5, collect each gear item, equip through the real equipment UI, and assert mining/dummy speed uses the exact new multipliers. Reload and assert inventory counts do not increase without walking onto a dispenser.

Run: `bunx vitest run tests/unit/gear-catalog.test.ts tests/unit/inventory.test.ts tests/unit/recipes.test.ts tests/unit/dummy.test.ts tests/unit/tycoon.test.ts tests/unit/hud.test.ts && bunx playwright test --project=mechanics --grep "dispenser|headquarters"`
Expected: PASS; no duplicate grant, no craft-recipe count change, and exact combat impulse scaling.

---

### Task 8: LAN Parity, Complete Pipeline, and Visual Acceptance

**Files:**
- Modify: `tests/e2e/lan.spec.ts`, `tests/e2e/goldens.spec.ts`, `tests/e2e/shots.spec.ts`
- Modify: `.ai/evidence/pipeline/` generated reports only
- Review: all files changed by Tasks 1–7

**Interfaces:**
- Uses all prior public APIs; no new gameplay behavior in this task.

- [ ] **Step 1: Add two-client HQ persistence/no-duplicate coverage**

Extend the LAN scenario: owner collects enough stars through the authoritative QA setup, walks onto stage 0 with real input, and both clients observe the same floor block. Record server edit count before/after a client restore; matching restoration produces zero new edits. Remote visual updates produce no inventory reward and no dispenser activation. Reload the room and verify the same HQ blocks and ownership.

- [ ] **Step 2: Run fast regression and investigate failures at their source**

Run: `bun run pipeline:fast`
Expected: typecheck, all unit tests, content, build, all mechanics, LAN/companion, and quality PASS. If assets are absent, restore them with `bun scripts/fetch-assets.ts --pbr-only`; do not bypass assertions.

- [ ] **Step 3: Measure current-revision performance**

Run: `GIERA_JSON_OUT="$PWD/.ai/evidence/pipeline/perf-results.json" bunx playwright test --project=perf`
Expected: PASS within `fpsMin=45`, `fpsFail=30`, `bootMs=15000`, `drawCalls=8500`; remesh must remain within the tested budget. Record completed-HQ solo/split metrics separately before optimizing; reduce decorative shadows/instancing cost rather than removing architecture.

- [ ] **Step 4: Stage and inspect final visual evidence**

Run: `GIERA_GOLDENS_STAGE=1 bunx playwright test --project=goldens && bunx playwright test tests/e2e/shots.spec.ts`
Capture launch, spawn, split, tycoon, HQ exterior, command room, elevator, and completed labs. Check file sizes before reading images. Inspect doorway visibility, floor/wall seams, glass sorting, kiosk readability, elevator opening, and interior route clearance.

- [ ] **Step 5: Obtain explicit human golden acceptance**

Present the staged images and measured results. Do not run acceptance until the owner explicitly approves the new HQ visuals. After approval:

Run: `bun run accept -- --stage goldens --reason "Owner approved the constructed superhero headquarters, interiors, elevator, and functional lab presentation."`
Then run: `bunx playwright test --project=goldens`
Expected: five existing goldens plus new HQ goldens PASS.

- [ ] **Step 6: Run the complete pipeline and cleanup checks**

Run: `bun run pipeline`
Expected: every stage PASS, including goldens, performance, network, and quality.

Then run: `bun run typecheck && git diff --check`
Inspect `git status --short`, confirm no project Vite/Playwright test servers remain, and leave `.kimi-work/` untouched. Report any manual Xbox/controller checks as unverified unless actually performed.

---

## Follow-up Plan Boundary

Create a separate terrain/foliage/collision repair plan after the HQ acceptance candidate. It must begin with reproducible screenshots/coordinates and failing tests for mesh face coverage, chunk seams, foliage alpha/winding, smooth rendered ground versus physical ground, and prop collision shapes. Do not hide those defects with HQ decorations or weaken goldens to make them pass.
