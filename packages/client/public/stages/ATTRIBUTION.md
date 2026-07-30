# Stage backdrops

**This directory is empty on purpose, and the game is complete without it.**

Each Gun Mayhem stage draws its own scenery procedurally
(`packages/client/src/games/gunmayhem/stageArt.ts`) — a living room for The
Salon, a city skyline for Rooftops, spires above cloud for Towers. On top of
that, each stage will pick up an *optional* painted backdrop if one is present:

```
packages/client/public/stages/<levelId>/backdrop.png
```

where `<levelId>` is `salon`, `rooftops` or `towers`.

## Adding one

Drop in a `backdrop.png` at roughly **1280×720** (the arena's exact size; it is
scaled to cover, so a larger image is fine and a wildly different aspect ratio
will be stretched). Nothing else to change — `stageArt.ts:backdropUrl` already
looks for it and `game/images.ts` loads it lazily on first frame.

When a backdrop is present it replaces the two procedural parallax bands and is
drawn at 85% alpha, under the scenery and the platforms. Keep them **dark and
low contrast**: four players, bullets, bombs and pickups all have to stay
readable on top, and a busy backdrop makes the game genuinely harder to play.
The procedural palettes in `packages/shared/src/games/gunmayhem/levels.ts` are a
good guide to the intended value range for each stage.

## Fail-soft, by design

A missing, 404ing or corrupt file is **not** an error. `game/images.ts` follows
the same contract as `music.ts`: one attempt, never retried, failures degrade
silently. If nothing loads here the stages render exactly as they do today. That
is why these are checked in as absent rather than as placeholders.

## Licensing

Anything added here must be **CC0 / public domain** or otherwise clearly
licensed for redistribution, and must be recorded in the table below — the same
rule the music in `../music/ATTRIBUTION.md` follows. Kenney
(https://kenney.nl/assets, CC0) and OpenGameArt's CC0 section
(https://opengameart.org) are both good sources for parallax backgrounds.

| File | Title | Author | Licence | Source |
| --- | --- | --- | --- | --- |
| _(none yet)_ | | | | |
