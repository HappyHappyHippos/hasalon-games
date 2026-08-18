# Music

Background loops, each picked to match the screen or game it plays under.

| File | Track | Author | Licence | Source |
| --- | --- | --- | --- | --- |
| `lobby.mp3` | Lofi Midnight Club | alex-morgan | Pixabay Content License | https://pixabay.com/music/lofi-lofi-midnight-club-568164/ |
| `gunmayhem.mp3` | Wild West | Playlistsons | Pixabay Content License | https://pixabay.com/music/modern-country-wild-west-466301/ |
| `achtung.mp3` | Sneaky Quirky | leberch | Pixabay Content License | https://pixabay.com/music/sneaky-sneaky-quirky-375837/ |
| `memes.mp3` | Funky Chill | The_Mountain | Pixabay Content License | https://pixabay.com/music/funk-funky-chill-138615/ |
| `tanks.mp3` | Retro Games (Glitch Technology Synthwave) | FASSounds | Pixabay Content License | https://pixabay.com/music/video-games-retro-games-glitch-technology-synthwave-199939/ |
| `gravity.mp3` | Interstellar Chase Theme with Glitchy Synths | DesiFreeMusic | Pixabay Content License | https://pixabay.com/music/upbeat-interstellar-chase-theme-with-glitchy-synths-385801/ |
| `worms.mp3` | Celtic Winds | Psychronic | Pixabay Content License | https://pixabay.com/music/folk-celtic-winds-439101/ |
| `telephone.mp3` | Playful Happy Background Music | JorisVermeer | Pixabay Content License | https://pixabay.com/music/instrumental-playful-happy-background-music-579027/ |

Skribbl reuses `lobby.mp3`. Attribution is not required by the Pixabay Content
License, but the source record stays here so every shipped asset is traceable.

## Everything must be mp3

Not a preference — **Safari has never supported Ogg Vorbis**, on any version,
desktop and iOS alike. MP3 is the one format every target browser decodes. Keep
it that way unless `music.ts` gains real format negotiation.

## Swapping a track

Drop a replacement in with the same base name and update `TRACKS` in
`packages/client/src/music.ts` if the extension changes. A missing or unplayable
file is not an error: `music.ts` retires that track after two failures and the
game runs silently, so a bad swap can never break a match.

Keep tracks loopable. They play with `loop = true`, so an abrupt tail is audible
every couple of minutes.

Serving is handled by `packages/server/src/static.ts`, which sends
`Accept-Ranges: bytes` and answers Range requests with `206`. Safari's media
stack probes files with a range request and may refuse a plain `200` response.
