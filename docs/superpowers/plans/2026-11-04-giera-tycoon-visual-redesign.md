# Giera Tycoon Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the confusing tycoon presentation with a readable star factory, visible expansion construction, and a factory-led launch scene without changing progression or save semantics.

**Architecture:** `TycoonManager` remains the economic authority and exposes a pure presentation snapshot. `TycoonPlot` remains the sole factory GLB loader and supplies shared parts to `TycoonExpansion`, which owns visual modules and their additive collision. Procedural stars and canvas labels avoid a new asset pipeline; launch previews use visual-only animation.

**Tech Stack:** TypeScript, Three.js 0.186, Vitest, Playwright, Bun, Vite.

## Global Constraints

- Change the normal renderer directly. Do not add a runtime feature flag or legacy-renderer fallback.
- Preserve `max(0.6, 2.5 / dropperTier)`, `dropperTier * 5`, expansion costs/positions, trigger radii, trampoline behavior, and serialized fields.
- Preserve the six-product pool, 64-particle pool, product path/duration, and existing audio/QA event IDs.
- Use accumulated simulation delta and `makeRng(seed)`; no `Date.now()` or `Math.random()` in visual-time code.
- Solid expansion roots have collision; labels, rings, particles, and previews never do.
- Do not run `git commit`, `git reset`, `git rebase`, or `git push` without an explicit owner request.
- Run focused tests after each task and `bun run pipeline:fast` before browser acceptance.

---

### Task 1: Pure tycoon presentation state

**Files:**
- Create: `src/client/game/tycoon-presentation.ts`
- Create: `tests/unit/tycoon-presentation.test.ts`
- Modify: `src/client/game/tycoon.ts`

**Interfaces:**
- Consumes: existing `TycoonManager` public progression fields and `ExpansionSlot`.
- Produces: `TycoonPresentationState`, `RecommendedTycoonAction`, `selectTycoonPresentation()`, and `TycoonManager.getPresentationState()`.

- [ ] **Step 1: Write failing selector tests**

```ts
import { describe, expect, it } from "vitest";
import { selectTycoonPresentation } from "../../src/client/game/tycoon-presentation";

const slots = [{ index: 0, x: 0, z: 0, cost: 20 }];

describe("selectTycoonPresentation", () => {
  it("prioritizes a non-empty vault without mutating input", () => {
    const input = { vaultCoins: 2, collectedStars: 30, dropperTier: 1, slots, owned: [] as number[] };
    const before = JSON.stringify(input);
    const view = selectTycoonPresentation(input);
    expect(view.recommendedAction).toBe("collect");
    expect(view.upgradeCost).toBe(5);
    expect(view.expansions[0].state).toBe("affordable");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("prioritizes upgrade, then expansion, then saving", () => {
    expect(selectTycoonPresentation({ vaultCoins: 0, collectedStars: 30, dropperTier: 1, slots, owned: [] }).recommendedAction).toBe("upgrade");
    expect(selectTycoonPresentation({ vaultCoins: 0, collectedStars: 20, dropperTier: 4, slots, owned: [] }).recommendedAction).toBe("expand");
    expect(selectTycoonPresentation({ vaultCoins: 0, collectedStars: 4, dropperTier: 4, slots, owned: [] }).recommendedAction).toBe("save");
  });
});
```

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run: `bunx vitest run tests/unit/tycoon-presentation.test.ts`
Expected: FAIL because `tycoon-presentation.ts` does not exist.

- [ ] **Step 3: Implement the pure selector**

```ts
import type { ExpansionSlot } from "./tycoon-expansion";

export type RecommendedTycoonAction = "collect" | "upgrade" | "expand" | "save";
export type TycoonPresentationState = {
  vaultCoins: number;
  collectedStars: number;
  dropperTier: number;
  upgradeCost: number;
  collectorReady: boolean;
  upgradeAffordable: boolean;
  recommendedAction: RecommendedTycoonAction;
  expansions: readonly { index: number; cost: number; state: "locked" | "affordable" | "owned" }[];
};

export function selectTycoonPresentation(input: {
  vaultCoins: number;
  collectedStars: number;
  dropperTier: number;
  slots: readonly ExpansionSlot[];
  owned: readonly number[];
}): TycoonPresentationState {
  const upgradeCost = input.dropperTier * 5;
  const owned = new Set(input.owned);
  const expansions = input.slots.map((slot) => ({
    index: slot.index,
    cost: slot.cost,
    state: owned.has(slot.index) ? "owned" as const : input.collectedStars >= slot.cost ? "affordable" as const : "locked" as const,
  }));
  const collectorReady = input.vaultCoins > 0;
  const upgradeAffordable = input.collectedStars >= upgradeCost;
  const nextExpansion = expansions.find((slot) => slot.state !== "owned");
  const recommendedAction: RecommendedTycoonAction = collectorReady
    ? "collect"
    : upgradeAffordable
      ? "upgrade"
      : nextExpansion?.state === "affordable"
        ? "expand"
        : "save";
  return { vaultCoins: input.vaultCoins, collectedStars: input.collectedStars, dropperTier: input.dropperTier, upgradeCost, collectorReady, upgradeAffordable, recommendedAction, expansions };
}
```

Add this manager method without changing update logic:

```ts
getPresentationState(): TycoonPresentationState {
  return selectTycoonPresentation({
    vaultCoins: this.vaultCoins,
    collectedStars: this.collectedStars,
    dropperTier: this.dropperTier,
    slots: this.expansion.slots,
    owned: this.expansion.ownedIndices(),
  });
}
```

- [ ] **Step 4: Run focused and existing economy tests**

Run: `bunx vitest run tests/unit/tycoon-presentation.test.ts tests/unit/tycoon.test.ts tests/unit/tycoon-expansion.test.ts`
Expected: all PASS.

- [ ] **Step 5: Check the diff**

Run: `git diff --check && git status --short`
Expected: no whitespace errors and no commit.

### Task 2: Share factory collision-root aggregation

**Files:**
- Create: `src/client/game/tycoon-collision.ts`
- Create: `tests/unit/tycoon-collision.test.ts`
- Modify: `src/client/game/tycoon-plot.ts`
- Modify: `src/client/game/tycoon-expansion.ts`
- Modify: `src/client/game/tycoon.ts`

**Interfaces:**
- Consumes: Three.js `Object3D` roots and existing `Cylinder`.
- Produces: `TycoonCollisionRoots.add(root)`, `.get(worldParent)`, `.clear()`, and expansion/manager collision aggregation.

- [ ] **Step 1: Write failing collision tests**

```ts
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TycoonCollisionRoots } from "../../src/client/game/tycoon-collision";

describe("TycoonCollisionRoots", () => {
  it("derives cylinders from visible roots and excludes hidden decoration", () => {
    const world = new THREE.Group();
    const solid = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), new THREE.MeshBasicMaterial());
    const hidden = solid.clone();
    hidden.visible = false;
    world.add(solid, hidden);
    const roots = new TycoonCollisionRoots();
    roots.add(solid);
    roots.add(hidden);
    const bodies = roots.get(world);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ radius: 1, height: 3 });
    expect(roots.get(world)).toBe(bodies);
  });
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `bunx vitest run tests/unit/tycoon-collision.test.ts`
Expected: FAIL because `tycoon-collision.ts` does not exist.

- [ ] **Step 3: Implement the cached aggregator**

```ts
import * as THREE from "three";
import type { Cylinder } from "../../shared/entity-collision";

export class TycoonCollisionRoots {
  private readonly roots: THREE.Object3D[] = [];
  private readonly bodies: Cylinder[] = [];
  private readonly bounds = new THREE.Box3();
  private readonly size = new THREE.Vector3();
  private dirty = true;

  add(root: THREE.Object3D): void { this.roots.push(root); this.dirty = true; }
  markDirty(): void { this.dirty = true; }
  clear(): void { this.roots.length = 0; this.bodies.length = 0; this.dirty = true; }

  get(worldParent: THREE.Object3D): readonly Cylinder[] {
    if (!this.dirty) return this.bodies;
    worldParent.updateWorldMatrix(true, true);
    let count = 0;
    for (const root of this.roots) {
      if (!root.visible) continue;
      this.bounds.makeEmpty();
      this.bounds.setFromObject(root);
      if (this.bounds.isEmpty()) continue;
      this.bounds.getSize(this.size);
      const radius = Math.max(this.size.x, this.size.z) * 0.5;
      if (radius <= 0.05 || this.size.y <= 0.05) continue;
      const body = this.bodies[count] ?? { x: 0, y: 0, z: 0, radius: 0, height: 0 };
      this.bodies[count] = body;
      body.x = (this.bounds.min.x + this.bounds.max.x) * 0.5;
      body.y = this.bounds.min.y;
      body.z = (this.bounds.min.z + this.bounds.max.z) * 0.5;
      body.radius = radius;
      body.height = this.size.y;
      count++;
    }
    this.bodies.length = count;
    this.dirty = false;
    return this.bodies;
  }
}
```

Replace the duplicated plot fields and `getCollisionBodies()` with this helper. Call `markDirty()` wherever `collisionDirty` was previously set. Give `TycoonExpansion` its own helper and have `TycoonManager` append both arrays into one persistent `collisionSnapshot` array.

- [ ] **Step 4: Run collision and tycoon tests**

Run: `bunx vitest run tests/unit/tycoon-collision.test.ts tests/unit/tycoon.test.ts tests/unit/tycoon-expansion.test.ts`
Expected: all PASS and existing machine-collision behavior remains intact.

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

### Task 3: Replace gear/gold metaphors with star currency

**Files:**
- Create: `src/client/game/tycoon-visuals.ts`
- Modify: `src/client/game/tycoon-plot.ts`
- Modify: `src/client/game/hud.ts`
- Modify: `src/style.css`
- Test: `tests/unit/hud.test.ts`

**Interfaces:**
- Consumes: existing product pool and HUD value classes.
- Produces: `createStarToken()`, `createTycoonLabel()`, and `TycoonLabelView.update()`.

- [ ] **Step 1: Add failing HUD icon-contract assertions**

Extend the HUD construction test to assert:

```ts
expect(container.querySelector<HTMLImageElement>(".hud-tycoon-vault-icon")?.src).toContain("/assets/ui/kenney/star.png");
expect(container.querySelector(".hud-tycoon-chip")).not.toBeNull();
expect(container.querySelector(".hud-tycoon-stars")).not.toBeNull();
expect(container.querySelector(".hud-tycoon-tier")).not.toBeNull();
```

- [ ] **Step 2: Run the HUD test and verify the old icon fails**

Run: `bunx vitest run tests/unit/hud.test.ts`
Expected: FAIL because the vault still uses `ore_gold.png`.

- [ ] **Step 3: Implement procedural stars and reusable canvas labels**

```ts
import * as THREE from "three";

export function createStarToken(): THREE.Group {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const angle = Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 === 0 ? 0.62 : 0.28;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.045, bevelThickness: 0.045, bevelSegments: 1, steps: 1 });
  geometry.center();
  const material = new THREE.MeshStandardMaterial({ color: 0xffd84d, emissive: 0x7a4d00, emissiveIntensity: 0.35, roughness: 0.38 });
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  group.add(mesh);
  return group;
}

export type TycoonLabelValue = { icon: "star" | "upgrade" | "lock"; text: string; accent: string };
export class TycoonLabelView {
  readonly sprite?: THREE.Sprite;
  private readonly canvas?: HTMLCanvasElement;
  private value = "";
  constructor() {
    if (typeof document === "undefined") return;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 512; this.canvas.height = 160;
    if (!this.canvas.getContext("2d")) return;
    const texture = new THREE.CanvasTexture(this.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
    this.sprite.scale.set(3.2, 1, 1);
  }
  update(value: TycoonLabelValue): void {
    const key = `${value.icon}|${value.text}|${value.accent}`;
    if (!this.canvas || !this.sprite || key === this.value) return;
    this.value = key;
    const ctx = this.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 512, 160);
    ctx.fillStyle = "rgba(12,22,28,.88)";
    ctx.beginPath(); ctx.roundRect(8, 8, 496, 144, 30); ctx.fill();
    ctx.lineWidth = 8; ctx.strokeStyle = value.accent; ctx.stroke();
    ctx.strokeStyle = "#ffd84d"; ctx.fillStyle = "#ffd84d"; ctx.lineWidth = 12; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    if (value.icon === "lock") { ctx.strokeRect(45, 70, 60, 50); ctx.arc(75, 70, 24, Math.PI, 0); }
    else if (value.icon === "upgrade") { ctx.moveTo(75, 120); ctx.lineTo(75, 35); ctx.moveTo(40, 70); ctx.lineTo(75, 35); ctx.lineTo(110, 70); }
    else { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const r = i % 2 === 0 ? 48 : 22; const x = 75 + Math.cos(a) * r; const y = 80 + Math.sin(a) * r; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); ctx.fill(); }
    ctx.stroke();
    ctx.fillStyle = "white"; ctx.font = "bold 64px system-ui"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(value.text, 140, 82);
    (this.sprite.material as THREE.SpriteMaterial).map!.needsUpdate = true;
  }
}
```

Use star tokens when initializing the six products, retain `PRODUCT_DURATION`, `PRODUCT_START_X`, `PRODUCT_END_X`, `PRODUCT_Z`, and change only visual positioning needed to sit the new geometry on the belt. Change the HUD vault icon to `/assets/ui/kenney/star.png` and enlarge tycoon icons to 28 px.

- [ ] **Step 4: Run HUD, tycoon, and content tests**

Run: `bunx vitest run tests/unit/hud.test.ts tests/unit/tycoon.test.ts && bun run typecheck`
Expected: PASS and exit 0.

- [ ] **Step 5: Check the visual asset contract**

Run: `test -f public/assets/ui/kenney/star.png && git diff --check`
Expected: exit 0.

### Task 4: Add legible pads and one recommended action

**Files:**
- Modify: `src/client/game/tycoon.ts`
- Modify: `src/client/game/tycoon-expansion.ts`
- Modify: `tests/unit/tycoon.test.ts`
- Modify: `tests/unit/tycoon-expansion.test.ts`

**Interfaces:**
- Consumes: `TycoonManager.getPresentationState()` and `TycoonLabelView`.
- Produces: collector/upgrade/expansion labels and deterministic emphasis without changing trigger geometry.

- [ ] **Step 1: Add failing emphasis and state tests**

```ts
it("keeps pad positions fixed while exposing collector readiness", () => {
  const tycoon = new TycoonManager({ x: -3, y: 50, z: 8 }, new THREE.Scene());
  expect(tycoon.collectorPadPos.toArray()).toEqual([-3, 50, 6]);
  expect(tycoon.upgradePadPos.toArray()).toEqual([-1, 50, 6]);
  expect(tycoon.getPresentationState().recommendedAction).toBe("save");
  tycoon.restore({ vaultCoins: 1, collectedStars: 0, dropperTier: 1 });
  expect(tycoon.getPresentationState().recommendedAction).toBe("collect");
});
```

Add expansion assertions that locked is the initial state, exact cost makes a slot affordable, and owned stays owned after `refresh(0)`.

- [ ] **Step 2: Run focused tests**

Run: `bunx vitest run tests/unit/tycoon.test.ts tests/unit/tycoon-expansion.test.ts`
Expected: any missing presentation/state assertion fails before implementation.

- [ ] **Step 3: Implement labels and deterministic emphasis**

Create collector and upgrade `TycoonLabelView` instances in `TycoonManager`, place their sprites above the existing pads, and update them from `getPresentationState()`:

```ts
const view = this.getPresentationState();
this.collectorLabel?.update({ icon: "star", text: String(view.vaultCoins), accent: "#65dc8c" });
this.upgradeLabel?.update({ icon: "upgrade", text: `${view.collectedStars}/${view.upgradeCost}`, accent: view.upgradeAffordable ? "#ffd84d" : "#9fb3bc" });
const pulse = 1 + Math.sin(this.pulseTime * 2.4) * 0.045;
this.collectorMesh?.scale.setScalar(view.recommendedAction === "collect" ? pulse : 1);
this.upgradeMesh?.scale.setScalar(view.recommendedAction === "upgrade" ? pulse : 1);
```

Keep the original theme material colors so existing exact-color tests remain valid. Expansion labels show the star cost, use a lock icon when locked, and switch to an upgrade/star icon when affordable. Owned pads and labels are hidden. Expansion emphasis reads the same recommended action but never changes purchase logic.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `bunx vitest run tests/unit/tycoon.test.ts tests/unit/tycoon-expansion.test.ts tests/unit/tycoon-presentation.test.ts && bun run typecheck`
Expected: PASS and exit 0.

- [ ] **Step 5: Run the fast pipeline**

Run: `bun run pipeline:fast`
Expected: typecheck, unit, content, build, and e2e-mechanics PASS; report any pre-existing failure separately.

### Task 5: Build persistent expansion modules with additive collision

**Files:**
- Modify: `src/client/game/tycoon-plot.ts`
- Modify: `src/client/game/tycoon-expansion.ts`
- Modify: `src/client/game/tycoon.ts`
- Test: `tests/unit/tycoon-expansion.test.ts`
- Test: `tests/unit/tycoon.test.ts`

**Interfaces:**
- Consumes: shared `TycoonCollisionRoots`, existing loaded factory templates.
- Produces: `FactoryPartProvider`, `TycoonPlot` ready callback, `TycoonExpansion.bindFactoryParts()`, and module collision included by `TycoonManager.getCollisionBodies()`.

- [ ] **Step 1: Write failing module lifecycle tests**

Use a fake provider cloning a 1×1×1 box for every part name:

```ts
const parts = { clonePart: () => new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())) };
const expansion = new TycoonExpansion({ groundAt: () => 0 });
expansion.bindFactoryParts(parts);
expansion.claim(0);
expansion.update(0.3);
const growing = expansion.group.getObjectByName("expansion-module-0")!;
expect(growing.visible).toBe(true);
expect(growing.scale.x).toBeGreaterThan(0);
expect(growing.scale.x).toBeLessThan(1);
expansion.update(0.3);
expect(growing.scale.x).toBe(1);
expect(expansion.getCollisionBodies()).toHaveLength(1);

const restored = new TycoonExpansion({ groundAt: () => 0 });
restored.restore([0]);
restored.bindFactoryParts(parts);
expect(restored.group.getObjectByName("expansion-module-0")!.scale.x).toBe(1);
```

Also assert `restore([0])` followed by `refresh(0)` leaves slot zero owned and does not create another module after repeated `bindFactoryParts()` calls.

- [ ] **Step 2: Run the lifecycle tests and verify failure**

Run: `bunx vitest run tests/unit/tycoon-expansion.test.ts`
Expected: FAIL because `bindFactoryParts` and expansion modules do not exist.

- [ ] **Step 3: Implement one shared factory-part provider**

Export from `tycoon-plot.ts`:

```ts
export type FactoryModel = "factoryConveyor" | "factoryLongConveyor" | "factoryMachine" | "factoryHopper" | "factoryScanner" | "factoryButton" | "factoryGear";
export type FactoryPartProvider = { clonePart(name: FactoryModel): THREE.Group | undefined };
export type TycoonPlotOptions = {
  surfaceAt: (x: number, z: number) => number;
  blocked?: (x: number, z: number) => boolean;
  onPartsReady?: (provider: FactoryPartProvider) => void;
};
```

After templates load and the base factory initializes, invoke:

```ts
this.options.onPartsReady?.({ clonePart: (name) => this.templates.get(name)?.clone(true) as THREE.Group | undefined });
```

Pass the provider from `TycoonManager` directly to `this.expansion.bindFactoryParts()`. Do not create another `GLTFLoader` for expansions.

- [ ] **Step 4: Implement six composed modules and their collision**

`bindFactoryParts()` stores the provider and synchronizes owned slots. Each module root is named `expansion-module-${index}`, positioned at the existing slot/ground offset, and composed at scales 0.55–0.8 so it remains within its building site:

```ts
private buildModule(index: number, restored: boolean): void {
  if (this.modules.has(index) || !this.parts || !this.isOwned(index)) return;
  const slot = this.slots.find((entry) => entry.index === index)!;
  const root = new THREE.Group();
  root.name = `expansion-module-${index}`;
  root.position.set(slot.x, this.groundAt(slot.x, slot.z), slot.z);
  const add = (name: FactoryModel, x: number, y: number, z: number, scale: number): void => {
    const part = this.parts!.clonePart(name);
    if (!part) return;
    part.position.set(x, y, z); part.scale.setScalar(scale); root.add(part);
  };
  if (index === 0) add("factoryLongConveyor", 0, 0, 0, 0.65);
  if (index === 1) { add("factoryMachine", 0, 0, 0, 0.55); add("factoryHopper", 0, 1.3 * 0.55, 0, 0.55); }
  if (index === 2) add("factoryScanner", 0, 0, 0, 0.75);
  if (index === 3) { add("factoryMachine", 0, 0, 0, 0.55); add("factoryHopper", 0, 1.3 * 0.55, 0, 0.55); }
  if (index === 4) { add("factoryButton", 0, 0, 0, 0.8); add("factoryGear", 0.55, 0.55, 0, 0.45); }
  if (index === 5) { add("factoryMachine", -0.45, 0, 0, 0.5); add("factoryScanner", 0.55, 0, 0, 0.6); }
  root.scale.setScalar(restored ? 1 : 0.001);
  this.group.add(root);
  this.modules.set(index, root);
  this.growth.set(index, restored ? 1 : 0);
  this.collision.add(root);
  this.collision.markDirty();
}
```

During new growth, update scale with the existing cubic ease and mark collision dirty. At completion set exact scale 1. `getCollisionBodies()` delegates to `TycoonCollisionRoots.get(this.group)`. Pads and labels are never registered. Repeated bind/restore/update calls return early through `modules.has(index)`.

- [ ] **Step 5: Run lifecycle, economy, and collision tests**

Run: `bunx vitest run tests/unit/tycoon-expansion.test.ts tests/unit/tycoon-collision.test.ts tests/unit/tycoon.test.ts && bun run typecheck`
Expected: all PASS and exit 0.

### Task 6: Coordinate collection, upgrade, and expansion feedback

**Files:**
- Modify: `src/main.ts`
- Modify: `src/client/game/hud.ts`
- Modify: `src/style.css`
- Test: `tests/unit/hud.test.ts`
- Test: `tests/e2e/mechanics.spec.ts`

**Interfaces:**
- Consumes: existing collect/upgrade/expansion callbacks, player positions, cameras, and split viewport rectangles.
- Produces: `GameHUD.pulseTycoon()`, `GameHUD.flyTycoonStars()`, `GameHUD.updateTycoonFeedback(delta)`, and one shared local-player feedback helper.

- [ ] **Step 1: Add failing HUD feedback tests**

```ts
hud.pulseTycoon("collect");
expect(container.querySelector(".hud-tycoon-chip")?.classList.contains("is-collect")).toBe(true);
hud.flyTycoonStars({ x: 300, y: 300 }, 3);
expect(container.querySelectorAll(".hud-tycoon-fly-star.is-active")).toHaveLength(3);
hud.updateTycoonFeedback(0.7);
expect(container.querySelectorAll(".hud-tycoon-fly-star.is-active")).toHaveLength(0);
hud.updateTycoon(8, 0, 2, 10);
expect(container.querySelector(".hud-tycoon-stars")?.textContent).toBe("8");
```

- [ ] **Step 2: Run the HUD test and verify the missing methods fail**

Run: `bunx vitest run tests/unit/hud.test.ts`
Expected: FAIL because the tycoon feedback methods are not implemented.

- [ ] **Step 3: Implement pooled, simulation-time HUD feedback**

Create eight reusable star images. Each has an active flag, age, start position, and target position. `flyTycoonStars(start, amount)` activates `min(8, max(1, ceil(amount / 5)))` stars, reads the star counter's rectangle once, and stores a 0.65-second flight. `updateTycoonFeedback(delta)` advances ages and uses `transform: translate(...)` plus opacity; expiry removes `is-active`. Reduced-motion mode skips creation and only pulses the counter.

`pulseTycoon()` replaces prior `is-collect`, `is-upgrade`, and `is-expand` classes and stores 0.45 seconds remaining. The same delta update removes the class at zero. Neither method uses `setTimeout()`, `performance.now()`, or CSS animation time.

- [ ] **Step 4: Implement shared world-to-HUD feedback**

In `main.ts`, project the acting player's reward position through the correct camera and viewport:

```ts
const tycoonFeedback = (actingPlayer: PlayerController, actingCamera: THREE.PerspectiveCamera, secondary: boolean, kind: "collect" | "upgrade" | "expand"): void => {
  const position = new THREE.Vector3(actingPlayer.position.x, actingPlayer.position.y + (kind === "collect" ? 1.4 : 0.8), actingPlayer.position.z);
  gameplayVfx.emit("collect", position);
  audio.play(kind === "collect" ? "celebrate_collect" : "celebrate_win");
  if (kind === "collect") {
    audio.play("craft_ok", { rate: 1.4 });
    actingPlayer.avatar?.playOnce("pickup");
  }
  const viewport = getSplitViewports(window.innerWidth, window.innerHeight, splitScreen.isSplitScreen)[secondary ? 1 : 0];
  position.project(actingCamera);
  hud.flyTycoonStars({ x: viewport.x + (position.x * 0.5 + 0.5) * viewport.width, y: viewport.y + (-position.y * 0.5 + 0.5) * viewport.height }, kind === "collect" ? 3 : 6);
  hud.pulseTycoon(kind);
};
```

Call with `(player, camera, false, kind)` and `(player2, camera2, true, kind)` from the existing callbacks. Call `hud.updateTycoonFeedback(delta)` once per gameplay frame. Preserve separate bounce callbacks and velocity 22 behavior.

- [ ] **Step 5: Run HUD and tycoon mechanics tests**

Run: `bunx vitest run tests/unit/hud.test.ts && bunx playwright test tests/e2e/mechanics.spec.ts --grep "tycoon|collision: player cannot walk through the tycoon machine"`
Expected: all selected tests PASS.

- [ ] **Step 6: Typecheck and diff check**

Run: `bun run typecheck && git diff --check`
Expected: exit 0.

### Task 7: Make the factory the launch hero with a visual-only token

**Files:**
- Modify: `src/client/game/tycoon-plot.ts`
- Modify: `src/client/game/tycoon.ts`
- Modify: `src/client/startup/menu-stage.ts`
- Modify: `src/main.ts`
- Modify: `src/style.css`
- Test: `tests/unit/tycoon.test.ts`

**Interfaces:**
- Consumes: existing `MenuStage`, launch controls, and product positioning.
- Produces: `TycoonManager.updateMenuVisuals(delta)` and `TycoonPlot.updateMenuPreview(delta)` with no economic side effects.

- [ ] **Step 1: Add a failing menu-production safety test**

```ts
it("animates menu previews without producing or banking stars", () => {
  const tycoon = new TycoonManager({ x: 0, y: 50, z: 0 }, new THREE.Scene());
  tycoon.updateMenuVisuals(10);
  expect([tycoon.vaultCoins, tycoon.collectedStars, tycoon.dropperTier]).toEqual([0, 0, 1]);
});
```

- [ ] **Step 2: Run the test and verify the missing method failure**

Run: `bunx vitest run tests/unit/tycoon.test.ts --grep "menu previews"`
Expected: FAIL because `updateMenuVisuals` is missing.

- [ ] **Step 3: Implement a dedicated preview token**

Add one `createStarToken()` named `tycoon-menu-preview`, hidden during normal plot updates. `updateMenuPreview(delta)` advances its age modulo `PRODUCT_DURATION`, positions it with the same belt function as normal products, and never calls `produce()` or changes manager fields. `TycoonManager.updateMenuVisuals()` calls `updateVisuals(delta)` followed by `plot.updateMenuPreview(delta)`. Change only the pre-start branch in `main.ts` to call `updateMenuVisuals(menuDelta)`.

- [ ] **Step 4: Compose the launch scene and simplify the overlay**

Keep `MenuStage` collision clamping. Add optional `focusOffset` and `lookHeight` options, set a slow deterministic orbit (`speed: 0.035`), and aim at the conveyor/collector midpoint rather than the bare origin. Keep the camera above sampled ground and never alter the player spawn.

Change only the non-pause launch layout: a 400–440 px left panel, transparent-to-dark left gradient, and visible world space on the right. Preserve every launch control and concierge retry. Use the existing responsive media queries to return to a centered panel on narrow screens.

- [ ] **Step 5: Run menu safety, launch unit, and type checks**

Run: `bunx vitest run tests/unit/tycoon.test.ts tests/unit/hud.test.ts && bun run typecheck`
Expected: PASS and exit 0.

### Task 8: Browser acceptance and golden coverage

**Files:**
- Modify: `tests/e2e/goldens.spec.ts`
- Modify: `tests/e2e/mechanics.spec.ts`
- Modify: `tests/goldens/README.md`
- Evidence: `.ai/evidence/pipeline/report.md`

**Interfaces:**
- Consumes: all prior public behavior and existing QA frame controls.
- Produces: deterministic factory coverage and full regression evidence.

- [ ] **Step 1: Add composed factory capture setup**

Add a reusable capture arrangement that points the camera at the conveyor and collector, waits for `tycoon-plot` and `expansion-module-*` assets, freezes on a QA frame, and captures fresh, affordable, expanded, and restored states. Do not use wall-clock waits.

For the expansion capture, arrange stars through the existing QA hook, walk onto the pad with Playwright keyboard input, and assert exactly one module before capture. For restoration, reload and assert identical `toJSON()` plus final module scale.

- [ ] **Step 2: Add real collision and persistence assertions**

Extend the tycoon mechanics coverage to walk into one owned solid expansion and assert horizontal displacement stops at its cylinder boundary. Assert labels/rings do not appear in `getCollisionBodies()`. Reload and assert the same `vaultCoins`, `collectedStars`, `dropperTier`, and expansion indices without additional collect/win events caused solely by restoration.

- [ ] **Step 3: Run focused browser tests**

Run: `bunx playwright test tests/e2e/mechanics.spec.ts --grep "tycoon|collision"`
Expected: all selected tests PASS with zero page errors.

- [ ] **Step 4: Run the fast pipeline**

Run: `bun run pipeline:fast`
Expected: all enabled stages PASS. If goldens differ only for the intended redesign, inspect captures before using the acceptance command.

- [ ] **Step 5: Accept reviewed intentional golden changes**

Run: `bun run accept -- --stage goldens --reason "Direct tycoon visual redesign: star currency, legible pads, persistent factory modules, and launch composition"`
Expected: acceptance recorded only after human visual review.

- [ ] **Step 6: Run full verification**

Run: `bun run pipeline`
Expected: typecheck, unit, content, build, e2e-mechanics, goldens, performance, network, and quality PASS. Xbox/controller results remain separately identified as manual evidence.
