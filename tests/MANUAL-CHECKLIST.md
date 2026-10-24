# Manual checklist — Giera

Run `bun run manual` (boots dev server, opens `http://localhost:5173/?seed=424242`).
Save evidence (screenshots, notes, clip names) to `.ai/evidence/manual/YYYY-MM-DD/`.
Software-covered items are regression-tested by `bun run pipeline` — manual pass is a spot-check, not a re-test.

## Hardware-only (must be done by hand)

### Xbox controllers (2 pads, Edge on Xbox Series X|S)

- [ ] Both pads connect; P1 = pad 0 (Ziemek), P2 = pad 1 (Gniewko) in split mode.
- [ ] Left stick walks, right stick turns camera (right = turn right, down = look down).
- [ ] A jumps; X mines (hold); Y places; RT/LT also mine/place.
- [ ] LB/RB cycle hotbar slots; D-pad left/right cycles too.
- [ ] View button toggles gamepad mode without modal flicker (press-edge, no 60 Hz repeat).
- [ ] Menu button opens inventory modal; B closes (Esc equivalent).
- [ ] In split mode both pads control their own viewport simultaneously.

### Microphone (real mic, pl-PL)

- [ ] Mic button requests permission; speaking a Polish word shows recognized text.
- [ ] NPC dialog accepts voice input and echoes into the reply bubble.

### Touch (iPad / phone)

- [ ] Virtual joystick walks; drag on right half turns camera.
- [ ] Tap = mine-hold, two-finger tap = place; jump button works.
- [ ] HUD buttons (mode, LAN, music, inventory) respond to touch.

### Performance eyeball

- [ ] Xbox Edge: scene stays playable (~30 fps+) while walking through loaded chunks.
- [ ] Mac: no stutter after 5 min of play; chunk streaming doesn't hitch movement.

## Software matrix spot-check (pipeline covers these — verify feel only)

| # | area | spot-check |
|---|---|---|
| 1 | movement | W walks ~2.4 b/s, no drift when stopping |
| 2 | jump | single jump feels right, no double-jump |
| 3 | mine | block breaks with progress bar, drops item |
| 4 | place | block places on aimed face, can't bury yourself |
| 5 | hotbar | 1-5 keys + click select slot, icon shows item |
| 6 | craft | I opens modal, recipes craft, Esc closes |
| 7 | split | mode button splits viewport, both players move |
| 8 | music | music button cycles 5 tracks, audio audible |
| 9 | tycoon collect | stars appear in HUD chip when standing on collector |
| 10 | tycoon upgrade | upgrade pad consumes stars, tier chip increments |
| 11 | trampoline | bounce launches to fixed height, repeatable |
| 12 | dummy | holding mine near dummy shows hit feedback |
| 13 | NPC | E opens dialog near Mina, quick prompts reply |
| 14 | persistence | reload keeps active slot + crafted item |
| 15 | console | no red errors in devtools during a 5 min session |
| 16 | sky | day/night cycle visible over 10 min |
| 17 | water/edges | world edges and water render without holes |
