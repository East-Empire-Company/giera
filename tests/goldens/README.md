# Goldens

`tests/goldens/*.png` are claims about the intended look of the game — spawn view,
split view, tycoon view.

A pixel diff means **regression**, not "the test is wrong". Fix the game, or ask a
human to accept the new look:

```
bun run accept -- --stage goldens --reason "why the new look is intended"
```

That copies the latest capture (`.ai/evidence/pipeline/golden-captured/`) over the
baseline and appends an entry to `.ai/evidence/pipeline/TRIAGE.md`.

Regenerate baselines from scratch:

```
bun run goldens:init
```

Baselines are captured with `?seed=424242&qa=1` (fixed timestep, pinned sky),
so they only change when the game's rendering changes.
