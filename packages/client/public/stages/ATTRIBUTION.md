# Stage backdrops

Painted stage art for Gun Mayhem and Tank Trouble. Both games look for a file
by convention and fall back to procedural drawing when it is not there.

```
packages/client/public/stages/gun_mayhem_stage_<levelId>.png   # Gun Mayhem
packages/client/public/stages/tanks/tank_stage_<stageId>.png   # Tank Trouble
```

`<levelId>` is a Gun Mayhem `LevelId` from
`packages/shared/src/games/gunmayhem/levels.ts` — currently `candyland`,
`desert`, `factory`, `green`, `green_2`, `israel`, `living_room`, `pirates`,
`snow`. `<stageId>` is a `TankStageId` from
`packages/shared/src/games/tanks/stages.ts`, whose entries name their own
`backdropUrl` explicitly.

## Adding one

Drop the file in at the arena's exact size — **1280×720** for Gun Mayhem — and
nothing else needs to change: `stageArt.ts:backdropUrl` builds the path from the
level id and `game/images.ts` loads it lazily on the first frame that wants it.

A Gun Mayhem backdrop is expected to paint **the platforms as well as the
scenery**, because the procedural platform outlines are switched off once it
loads. Platform boxes come from `levels.ts`, so the art has to line up with them
— `?debugHitboxes` in the URL overlays the real collision boxes for checking.

Keep backdrops **dark and low contrast**: four players, bullets, bombs and
pickups all have to stay readable on top, and busy art makes the game genuinely
harder to play. The palettes in `levels.ts` are a good guide to the intended
value range per stage.

## Fail-soft, by design

A missing, 404ing or corrupt file is **not** an error. `game/images.ts` follows
the same contract as `music.ts`: one attempt, never retried, failures degrade
silently. Until the image loads — and permanently, if it never does — the stage
renders procedurally: sky wash, two parallax bands, and outlined platforms.

## Licensing

Anything added here must be **CC0 / public domain** or otherwise clearly
licensed for redistribution, and must be recorded in the table below — the same
rule the music in `../music/ATTRIBUTION.md` follows. Kenney
(https://kenney.nl/assets, CC0) and OpenGameArt's CC0 section
(https://opengameart.org) are both good sources.

> **The table below is incomplete.** The stage art currently checked in predates
> this file and its provenance was never recorded. Fill it in before the repo is
> pointed at anyone outside the family.

| File | Title | Author | Licence | Source |
| --- | --- | --- | --- | --- |
| `gun_mayhem_stage_*.png` (9) | | | _unrecorded_ | |
| `tanks/tank_stage_*.png` (6) | | | _unrecorded_ | |
