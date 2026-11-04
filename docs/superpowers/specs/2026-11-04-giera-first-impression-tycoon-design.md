# Giera first-impression and tycoon presentation design

Date: 2026-11-04
Status: Approach B approved for direct implementation without a runtime feature flag

## 1. Purpose

Make Giera's first session immediately attractive and understandable for young, non-reading players. The launch scene should present a living toy factory, and the tycoon should communicate a complete collect-and-build loop through visual cause and effect.

This is not a cosmetic reskin alone. The existing tycoon fails to explain production, collection, purchase cost, and expansion payoff. The approved approach preserves the progression contract while rebuilding its presentation and adding visible expansion modules.

## 2. Approved direction

Adopt a **storybook voxel family adventure** with a **living toy star factory** as its first-session hero.

The factory communicates this loop without instructional prose:

1. The machine produces star tokens.
2. Produced stars accumulate in the vault.
3. The player collects the vault at the green collector.
4. The player spends stars at the golden upgrade pad or an affordable building site.
5. The purchased machine stage or expansion module appears immediately and persists.

The opening camera frames the factory, collector, family character, and a future building site as a coherent scene. The launch overlay supports that scene rather than covering it.

## 3. Scope and compatibility contract

### 3.1 Preserved behavior

The following remain authoritative and unchanged unless a test exposes a presentation-only wiring defect:

- `vaultCoins`, `collectedStars`, and `dropperTier` semantics.
- Tier-one production of one vault unit every 2.5 seconds.
- Tier interval `max(0.6, 2.5 / dropperTier)`.
- Upgrade cost `dropperTier * 5`.
- Expansion slot indices, local positions, costs, and purchase behavior.
- Collector, upgrade, expansion, and trampoline trigger positions and radii.
- Trampoline velocity and cooldown behavior.
- Serialized tycoon fields and compatibility with saves that predate expansions.
- Shared local/split-player progression and remote-tycoon visual-only updates.
- Existing audio and QA gameplay event IDs.
- Product pool size, product duration, conveyor path, and factory stage timing.
- Launch controls, profile selection, split-screen selection, gamepad navigation, and DOM test selectors.

### 3.2 Approved additive scene changes

Approach B explicitly permits visible expansion modules and matching additive collision for their solid parts. Collision must be derived from the same rendered module roots, as existing factory collision is derived from factory roots.

Pads, rings, floor decals, price sprites, particles, and holographic previews remain non-colliding.

No expansion module may change production, currency, purchase cost, or unlock rules. Its value is visible construction, animation, and completion of the factory scene.

### 3.3 Non-goals

- No new currency, offline earnings, automation rules, producer dependencies, or progression redesign.
- No change to world generation, mining, placing, crafting, NPC reasoning, LAN protocol, or save schema.
- No movement of existing interaction pads or the trampoline.
- No per-tile terrain material regression.
- No decorative geometry used to conceal unrelated structural or collision mismatches.
- No wholesale replacement of family avatars in this workstream.
- No bloom-first polish, real-time water reflection, or additional scene render.

## 4. Current problems being corrected

1. Conveyor gears, gold-ore vault iconography, and star currency currently describe the same loop through three incompatible metaphors.
2. Walk-to-trigger purchases do not show their outcome and price clearly before activation.
3. Red expansion rings read as danger or failure rather than construction opportunities.
4. Purchased expansions provide little visible payoff beyond ring growth and a marker.
5. Upgrade callbacks emphasize audio but do not adequately coordinate machine, world, and HUD feedback.
6. The current tycoon golden does not compose the factory as its subject and therefore provides weak protection for the actual tycoon experience.
7. The launch overlay and concierge status compete with the scene that should sell the game.

## 5. Visual language

### 5.1 Currency

Use one star symbol for produced tokens, vault contents, spendable currency, upgrade prices, and expansion prices.

The internal names `vaultCoins` and `collectedStars` remain unchanged. Gold-ore imagery remains available for mining and must not represent tycoon vault contents.

Products are chunky, beveled or sprite-supported star tokens with a silhouette readable at gameplay distance. They use the existing six-object pool and follow the existing conveyor path and timing.

### 5.2 Interaction roles

| Element | Required visual language |
| --- | --- |
| Collector | Green star container, collection symbol, stored amount |
| Upgrade | Gold upward arrow, machine symbol, current stars / required stars |
| Locked expansion | Quiet blue-gray foundation, lock symbol, star cost |
| Affordable expansion | Warm gold outline and one restrained pulse |
| Owned expansion | Completed factory module; purchase pad no longer competes for attention |
| Trampoline | Separate purple bounce treatment with upward chevrons |

Color is reinforced by shape and icon so state is not conveyed by hue alone.

Pad billboards must be legible before the 1.1-block purchase trigger. They begin appearing within 8 blocks and are fully readable by 4 blocks, subject to camera projection and viewport safe areas. Labels use icons and numbers rather than sentences.

Only one recommended action receives the strong attention treatment. The selection order is:

1. Collector when the vault is non-empty.
2. Upgrade when affordable.
3. Next unowned expansion when affordable.
4. Upgrade progress when none of the above is available.

This priority affects emphasis only. It never enables, disables, delays, or performs a purchase.

### 5.3 Factory materials

Use the existing lightweight Kenney factory kit as the initial geometry source. Apply a coherent toy-like palette with broad color regions, restrained roughness, and limited emissive accents. Avoid adding unique high-resolution textures to each module.

The factory must read as part of the storybook voxel world rather than a photorealistic industrial facility.

### 5.4 Upgrade payoff

For existing tiers 2–5, reveal the already-defined machine stages with coordinated feedback:

1. Upgrade pad emits a short anticipation flash.
2. Existing collect/star VFX and audio confirm the purchase.
3. The new module completes its existing growth animation.
4. Machine motion or emissive accents acknowledge the new tier.
5. The HUD tier badge updates with a restrained pulse.

Tiers beyond the existing geometry stages retain the current production rules. They may use a restrained overclock pulse and tier-badge response, but must not promise a new physical module that does not exist.

### 5.5 Expansion payoff

Each owned expansion creates one composed module from existing factory parts:

| Slot | Visual module |
| --- | --- |
| 0 | Conveyor annex |
| 1 | Packaging machine and hopper |
| 2 | Scanner station |
| 3 | Star storage unit |
| 4 | Control station with button and gear |
| 5 | Factory centerpiece combining existing parts |

Modules animate idle mechanical details only. They do not emit additional currency or imply additional production rate.

A new purchase grows the module over the existing 0.6-second expansion duration. Restored modules appear at final scale without purchase animation, particles, audio, or currency changes.

The trampoline remains at its current position but is visually separated from the primary collect/upgrade language.

## 6. Architecture

### 6.1 Authority and presentation remain separate

`TycoonManager` remains the authority for production, collection, upgrades, expansions, saving, and player interaction.

Add a read-only presentation snapshot or selector with this minimum shape:

```ts
type TycoonPresentationState = {
  vaultCoins: number;
  collectedStars: number;
  dropperTier: number;
  upgradeCost: number;
  collectorReady: boolean;
  upgradeAffordable: boolean;
  recommendedAction: "collect" | "upgrade" | "expand" | "save";
  expansions: readonly {
    index: number;
    cost: number;
    state: "locked" | "affordable" | "owned";
  }[];
};
```

The selector is pure. It does not mutate progression, emit products, play audio, or perform purchases.

Existing callbacks remain the event boundary:

- Collection callback supplies the collected amount and player position.
- Upgrade callback supplies the resulting tier or enough context to read it.
- Expansion callback supplies the purchased slot index.
- Bounce behavior remains unchanged.

Primary and secondary player callbacks share one feedback helper so their presentation stays equivalent without duplicating economy updates.

### 6.2 Factory asset ownership

Keep one factory-model loading path. Do not fetch the same GLBs independently for the plot and every expansion.

`TycoonPlot` remains the loader and exposes its loaded templates through a narrowly scoped factory-part provider used by the expansion renderer. The provider clones composed parts without duplicating geometry or textures.

All factory materials continue through the existing CSM registration path. Any new shader hook composes with existing hooks and has a unique cache key.

### 6.3 Expansion rendering and collision

`TycoonExpansion` continues to own slot state. Its renderer owns pads, labels, module roots, growth time, and module collision roots.

`TycoonManager.getCollisionBodies()` returns the union of plot and solid expansion collision bodies. The returned collection is stable between changes; collision bounds are recomputed only when a module appears, grows, or is restored.

Collision follows the visible module root during the 0.6-second growth animation, matching the existing factory-stage approach. Non-solid decoration is excluded.

A module is built only when:

- Its slot is owned.
- Factory assets have loaded.
- It has not already been instantiated.

Restoration marks owned modules for immediate final-scale construction. A late asset load reads the current owned state and therefore cannot replay a purchase.

### 6.4 HUD and world feedback

The HUD star counter, vault counter, upgrade cost, and tier retain their existing value classes and update method contract. Their visual hierarchy is simplified:

- Spendable stars are primary.
- Vault amount appears with a collection cue when non-empty.
- Upgrade cost appears with the upgrade icon.
- Tier uses a large icon/badge treatment and retains the tested text value.

Collection includes world-to-HUD star flight driven by accumulated simulation delta rather than wall-clock CSS timing. In split-screen it projects through the acting player's camera and stays inside that viewport. Reduced-motion mode replaces flights and pulses with immediate value changes and a short opacity cue.

The shared `GameplayVfx` pool remains capped at 64 particles. Gameplay feedback continues to outrank ambient particles.

### 6.5 Launch scene

Extend `MenuStage`; do not introduce a second orbit or collision implementation.

The launch shot uses a deterministic starting angle and a target composition containing the factory, collector, and family character. Existing camera collision clamping remains active. Candidate angles are validated across representative seeds so terrain does not block the hero view.

Before Start, the factory runs a **decorative preview token** through a menu-specific visual method. It does not call the authoritative production update, increment the vault, collect currency, or trigger purchases.

The launch overlay becomes narrower and reveals the factory. Concierge failure remains available through a restrained status and retry control but is not the dominant visual element.

This slice keeps the existing direct launch-to-game transition. It does not add a camera settle or change player spawn or physics.

## 7. Determinism and quality modes

- Use `makeRng(seed)` for any random visual variation.
- Advance all mechanical motion, token motion, growth, pulses, and VFX with accumulated simulation delta.
- Do not introduce `Date.now()` or `Math.random()` into simulation or visual-time code.
- Preserve fixed `1/60` delta and frame-based capture behavior under `?qa=1`.
- Preserve QA pose freezing and live-pose options.
- Add an explicit test-only launch composition path rather than changing the meaning of existing `?qa=1` boot.
- Capture uses a fixed launch angle and fixed simulation frame.
- Low-power mode must communicate state through shape, opacity, and emissive color without requiring AO or bloom.
- Reduced-motion mode removes nonessential pulsing, flying HUD tokens, and camera settles.

## 8. Error handling and lifecycle

- Preserve the current critical factory-model failure behavior; do not silently hide asset failures or leave invisible solid modules.
- A late model load completes the visual state from current progression without producing currency or replaying rewards.
- Disposal stops mixers and removes module roots, labels, materials, and references shared with collision aggregation.
- Shared geometry and textures are disposed once by their owner, not once per clone.
- Remote tycoons update visuals only and never advance the shared drop timer.
- Missing post-processing does not hide purchase prices or interaction icons.
- The concierge retry remains functional when its status presentation is minimized.

## 9. Performance contract

Establish comparable before/after captures before setting absolute factory budgets.

Record draw calls, triangles, geometries, textures, programs, DPR, post state, FPS, and boot time for solo, split, launch, and a completed factory.

Requirements:

- Reuse factory geometry and materials.
- Preserve the six-product pool and 64-particle pool.
- Do not allocate vectors, labels, or materials every frame.
- Small mechanical details do not cast shadows unless their contact shadow is visibly useful.
- New modules do not add another scene render, transmission pass, or real-time reflection.
- No regression in measured solo/split FPS or boot time against the agreed baseline.
- The broader terrain LOD/batching work remains a separate rendering plan. This tycoon slice records terrain-inclusive before/after metrics and must not regress them, but does not rewrite terrain streaming.
- Xbox and controller checks remain manual release gates; desktop FPS is not Xbox evidence.

## 10. Verification design

### 10.1 Characterization first

Before visual edits, preserve tests for:

- Exact production timing and upgrade costs.
- Collection and vault emptying.
- Expansion costs, ordering, ownership, and legacy-save restoration.
- Split-player collection, upgrades, and independent trampoline cooldowns.
- Remote visual updates without production.
- Existing machine collision.

Record fresh, mid-progress, completed, and restored factory views. Triage the currently failing golden stage before accepting any new baseline.

### 10.2 Unit tests

Add focused tests for:

- Presentation snapshot values and recommended-action priority.
- Selector purity under repeated calls.
- Locked, affordable, and owned visual states.
- Price availability before the purchase trigger.
- One module instance per owned slot.
- New-purchase growth versus restored final-scale construction.
- Additive collision only for solid module roots.
- No collision for labels, rings, particles, or previews.
- No duplicate reward effects on restoration or late asset loading.
- Disposal and repeated restore/load ordering.

Existing economic assertions are not loosened or replaced with weaker checks.

### 10.3 Browser mechanics tests

Use real Playwright keyboard/mouse input for player-driven checks. Test hooks may arrange deterministic starting state but may not replace the behavior being asserted.

Verify:

- Walking onto the collector pays the exact vault amount.
- Upgrade price is visible before entry and the exact price is deducted once.
- Expansion price is visible before entry and the correct module appears once.
- Reload restores the same module, currency, tier, and collision state without replaying rewards.
- Split-screen either player can collect and purchase with equivalent feedback.
- New modules cannot be walked through when solid.
- Spawn, launch, and required routes remain unobstructed across representative seeds.
- No page errors occur.

### 10.4 Golden coverage

Retain spawn, split, and tycoon coverage and add composed captures for:

- Launch factory hero shot.
- Fresh factory and collector.
- Affordable upgrade.
- Expansion under construction.
- Completed and restored factory.
- Split-screen factory feedback.
- Low-power factory.

Golden changes require human review and a recorded acceptance reason. A failing assertion is never loosened merely to obtain green.

### 10.5 Pipeline and manual checks

Run `pipeline:fast` during isolated slices and the full pipeline for each acceptance candidate. Re-run mechanics, persistence deltas, LAN parity, zero-page-error checks, and solo/split performance.

Manually verify controller navigation, reduced motion, split safe areas, Xbox rendering, and real first-session comprehension. Do not claim child comprehension without observing it; the automated proxy is that all required actions have visible icons, prices, and outcomes before activation.

## 11. Delivery slices

1. **Baseline and characterization:** current behavior, useful factory captures, performance baseline, golden triage.
2. **Presentation model:** pure read-only state and shared feedback wiring with no visible redesign yet.
3. **Currency and pads:** star tokens, coherent HUD icons, interaction roles, prices, and recommended-action emphasis.
4. **Factory upgrades:** coordinated tier-stage feedback without economic changes.
5. **Expansion modules:** visible construction, restoration, and additive collision.
6. **Launch integration:** deterministic factory hero composition and simplified overlay.
7. **Performance and acceptance:** comparative captures, full golden set, complete pipeline, and manual hardware checks.

Each slice is independently reviewable. The new presentation replaces the old renderer directly in the normal code path; there is no runtime feature flag or legacy-renderer fallback. Existing mechanics, persistence, collision, and golden tests are the regression safety net.

## 12. Acceptance criteria

The work is accepted when:

- Production, collection, upgrade, and expansion are visually understandable without instructional sentences.
- Every automatic purchase exposes its icon, price, and outcome before the player enters the trigger.
- Every tier stage and expansion purchase produces its specified visible response exactly once.
- Restoring a save produces the completed factory without replaying rewards or changing currency.
- Existing costs, intervals, positions, purchase behavior, and serialized progress remain compatible.
- Solid expansion modules have matching collision; non-solid presentation has none.
- Solo, split, remote, reduced-motion, and low-power presentations remain functional.
- Measured performance does not regress beyond the agreed project budget.
- The complete pipeline passes, with intentional golden changes explicitly reviewed and accepted.
