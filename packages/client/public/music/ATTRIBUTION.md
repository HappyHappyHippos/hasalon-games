# Music

Three background loops, one per screen, each picked to match the game it plays
under.

| File | Track | Author | Licence | Source |
| --- | --- | --- | --- | --- |
| `lobby.mp3` | Hot Swing | Kevin MacLeod | **CC BY 4.0** | https://incompetech.com/ |
| `gunmayhem.mp3` | The Cowboy's Theme | Umplix | CC0 | https://opengameart.org/content/wild-west-music |
| `achtung.mp3` | A Legend Will Rise | CodeManu | CC0 | https://opengameart.org/content/a-legend-will-rise-orchestral |

## Attribution is required for one of them

`lobby.mp3` is **CC BY 4.0**, not CC0, so the credit is a licence condition
rather than a courtesy. It is shown in the app's options menu, which is where
the licensor asks for it. Required text:

> Hot Swing by Kevin MacLeod (incompetech.com)
> Licensed under Creative Commons: By Attribution 4.0
> https://creativecommons.org/licenses/by/4.0/

If that track is ever replaced with a CC0 one, remove the credit block from
`packages/client/src/ui/OptionsMenu.tsx` at the same time.

## Everything must be mp3

Not a preference — **Safari has never supported Ogg Vorbis**, on any version,
desktop or iOS. Two of these were previously `.ogg`, which meant the element
fired `error` on every iPhone in the house, the track was marked unplayable, and
since `lobby` plays on every screen outside a match the site was silent from
first paint. It read as a code bug for two rounds of fixes and was a codec
choice.

mp3 is the only format every target browser decodes. Keep it that way unless
someone adds real per-browser format negotiation to `music.ts`.

## Swapping a track

Drop a replacement in with the same base name and update `TRACKS` in
`packages/client/src/music.ts` if the extension changes. A missing or unplayable
file is not an error — `music.ts` retires that track after two failures and the
game runs silently, so a bad swap can never break a match.

Keep them loopable: these are played with `loop = true`, so an abrupt tail is
audible every couple of minutes.

To transcode, if you have `ffmpeg` (the machine these were fetched on did not,
which is why every source above was chosen for having an mp3 already):

```bash
ffmpeg -i track.ogg -b:a 128k track.mp3
```

Serving is handled by `packages/server/src/static.ts`, which sends
`Accept-Ranges: bytes` and answers `Range` requests with `206`. That is also
required for Safari — its media stack opens every file with `Range: bytes=0-1`
and refuses to play anything answered with a plain `200`.
