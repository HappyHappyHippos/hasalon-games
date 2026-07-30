# Music

Three background loops, all **CC0 / public domain**. No attribution is legally
required for any of them; this file exists so nobody has to re-derive where they
came from.

| File | Track | Author | Licence | Source |
| --- | --- | --- | --- | --- |
| `lobby.ogg` | Simple menu/background music loop | polosik | CC0 | https://opengameart.org/content/simple-menubackground-music-loop |
| `gunmayhem.mp3` | 8-bit — Jester Battle | HydiaGene | CC0 | https://opengameart.org/content/8-bit-jester-battle |
| `achtung.ogg` | Cynic Battle Loop | Alex Smith (cynicmusic), looped by Ferk | CC0 | https://opengameart.org/content/cynic-battle-loop |

## Swapping a track

Drop a replacement in with the same base name and update `TRACKS` in
`packages/client/src/music.ts` if the extension changes. A missing or unplayable
file is not an error — `music.ts` marks that track unavailable and the game runs
silently, so a bad swap can never break a match.

Keep them loopable: these are played with `loop = true`, so an abrupt tail is
audible every couple of minutes.

Two of the three are Ogg Vorbis because the machine these were fetched on had no
`ffmpeg` to transcode with. If you ever need mp3 across the board (very old iOS
Safari is the only browser that would care):

```bash
ffmpeg -i lobby.ogg -b:a 128k lobby.mp3
```

The server serves both — `.ogg` and `.mp3` are in `MIME_TYPES` in
`packages/server/src/static.ts`.
