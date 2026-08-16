# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

הסלון (hasalon, "the living room") — a room-based multiplayer game site. Create
a room, share the code/link, everyone joins, the host picks a game from a
live game picker, then plays. No accounts, rooms live in memory only. The games
that ship today: **Gun Mayhem** (2–6 player platform fighter, the priority —
this is the flagship game and should get the most care), **Bomb It** (2–8 player
grid-based bomber with kickable bombs), **Worms** (up to
8-player turn-based artillery on destructible terrain), **Tank Trouble** (up to
8-player top-down maze duel with ricocheting shells), **Achtung die Kurve** (up
to 8-player curve/Snake game), **Gravity Guy** (up to 8-player one-button
auto-run elimination race), **Skribbl** (up to 8-player draw and guess, Hebrew
or English), **Broken Telephone** (2–8 player draw/guess chains) and **Meme Machine**.

npm workspaces monorepo. Git repo with `origin` at
`github.com/HappyHappyHippos/hasalon-games` (public), deployed on Railway at
https://hasalon-games-production.up.railway.app — see **Deployment** below.

## Commands

```bash
npm install                 # once, from repo root
npm run dev                 # server (tsx watch, :3000) + client (vite, :5173) together
npm run typecheck           # tsc --noEmit across all 3 packages
npm run lint                # eslint (typescript-eslint + react-hooks); also covers scripts/
npm run test:unit           # ~13s, shared + client — the loop to run while working
npm run test:integration    # ~65s, server only: real WS, real sockets
npm test                    # everything, ~65s (app.test.ts alone is ~60s of it)
npm run test:watch
npm run build                # client (vite build) then server (esbuild bundle)
npm start                    # runs the production bundle: node packages/server/dist/server.js
npm run smoke                # two real WS clients vs a live deploy (prod by default; needs a running server)
```

Single test file / single test: `npx vitest run path/to/file.test.ts` or
`npx vitest run -t "test name substring"`. Vitest config (`vitest.config.ts`,
repo root) globs `packages/**/*.test.ts`, `environment: 'node'` — canvas/DOM
renderer code is not unit tested, only the deterministic sim/physics is.

Dev client proxies `/ws` and `/healthz` to the server; override the server
port with `SERVER_PORT` (client) / `PORT` (server, default 3000). Client dev
server binds all interfaces (`host: true`) so a phone on the same wifi can
join via the `Network:` URL Vite prints.

Production smoke test: `PORT=3900 node packages/server/dist/server.js`, then
`curl localhost:3900/healthz`.

## Deployment

**Two branches, two Railway services, both wired permanently. Nothing is
repointed by hand.**

| Branch | Service | URL | Who's on it |
|---|---|---|---|
| `dev` | `hasalon-dev` | https://hasalon-dev-dev.up.railway.app | Us, playtesting |
| `main` | production | https://hasalon-games-production.up.railway.app | Family |

**Merging is the deploy.** Each service builds from its branch automatically, so
there is no deploy command in either direction:

```bash
git checkout dev && git merge --no-ff <branch> && git push    # deploys dev
git checkout main && git merge --no-ff dev && git push        # deploys production
```

**Playtest on `dev` before `main`.** Anything that changes how the game feels —
controls, netcode, tuning, voice — goes to `dev` first and gets played on a real
phone there. `main` is production and the people using it are family, not
testers.

Do not run `railway service source connect` to point a service at a feature
branch. That workflow is gone: merge into `dev` instead. (It used to print
"ServiceInstance not found" and succeed anyway, which is exactly the kind of
thing worth not having in the loop.)

`railway.json` at the repo root holds the deploy config (Dockerfile builder,
`/healthz` healthcheck, `numReplicas: 1`, `sleepApplication: true`); change it
there and commit rather than in the dashboard. `fly.toml` is a leftover
alternative — configured, nothing deployed to it.

`railway status` / `railway logs` / `railway usage` for the current state.
**Every one of those targets whichever environment the CLI last selected**, so
say which you mean before trusting the answer:

```bash
railway environment dev && railway service hasalon-dev
railway environment production
```

The README's "Deploying" section has the full runbook.

**The GitHub→Railway webhook has silently stopped firing before.** Two merges to
`main` produced no build at all — not a failed one, *no deployment attempted* —
and prod kept serving a commit from hours earlier while everything looked
healthy. Now that a merge is the entire deploy for *both* environments, this is
the failure mode to watch: a merge that lands, a branch that looks shipped, and
an instance still serving yesterday. Never assume a push deployed. Check
`railway status --json | .latestDeployment.meta.commitHash` against
`git rev-parse HEAD`, or `railway deployment list` for whether a build even
started. `railway up` deploys from the CLI when the webhook is dead.

**`/healthz` cannot tell you which build is running.** It returns byte-identical
JSON in every version, so a poll loop waiting for it to "come back" passes
instantly against the stale instance you are trying to replace. To check the
version, probe the protocol: send a current-version `join` for a nonexistent
room and read the error — `NO_SUCH_ROOM` means the new build, `BAD_VERSION`
means you are still talking to the old one. `npm run smoke` does this properly.

Deployment-specific traps, all of which have bitten once:

- **Replica count must stay 1.** Rooms are in memory; two replicas means two
  friends land on different instances and never see each other. `railway.json`
  covers ordinary deploys, but region scaling bypasses it.
- **`railway scale` treats region aliases as distinct rows.** `railway scale
  us-west=0 eu-west=1` did *not* drain the existing `sfo` replica — it added a
  second one, silently. Zero the region by the exact name `railway status`
  prints (`railway scale sfo=0`), then re-read the printed `replicas:` line to
  confirm. Trust the output, not the arguments.
- **`railway status` says `Online` (healthy) or `Sleeping` (idle), never
  `Success`.** A poll loop waiting for `Success`/`Deployed` never terminates.
  Match `Online|Sleeping|Failed|Crashed` — including the failure states, or a
  crashloop is indistinguishable from a slow build.
- **App sleeping is deliberately on.** It won't sleep mid-game (an open
  WebSocket counts as activity), but sleeping wipes all room codes, so a link
  shared and left idle for an hour is dead. Cold start is ~1.7s.
- **A green Docker build proves nothing about WebSockets** — the proxy is what
  breaks. Verify with `npm run smoke` (two real clients through create/join/
  ready, also reports round-trip latency) and `curl <host>/healthz` for live
  `rooms`/`clients` counts. Don't verify with two browser tabs (see the
  localStorage gotcha below).

## Architecture

### Package layout

```
packages/shared/   game rules, wire protocol, room types, game registry  (@mg/shared)
packages/server/   rooms, matchmaking, the tick loop                     (@mg/server)
packages/client/   React UI, canvas renderers, prediction                (@mg/client)
```

`shared` ships as raw `.ts` source (no build step) — Vite compiles it for the
browser, `tsx` runs it under the dev server, esbuild bundles it into the
server's single-file production output. `@mg/shared` root export is
room/protocol/registry only; each game's internals are behind their own
subpath (`@mg/shared/achtung`, `@mg/shared/gunmayhem`, `@mg/shared/skribbl`)
because the games export same-named symbols (`createState`, `stepTick`,
`defaultConfig`, ...) — importing from the root never gives you game internals.
A new game needs its subpath added to `packages/shared/package.json`.

### The GameModule seam

This is the one abstraction the whole codebase hangs off. A game is a
`GameModule` (`packages/shared/src/gameModule.ts`): `meta`, `defaultConfig`,
`normalizeConfig`, and `create(seats, config, seed) → GameInstance`. A
`GameInstance` is a closure over one match's state exposing
`applyInput`/`stepTick`/`snapshot`/`status`/`scores`/`winnerSeat` — no
generics, no switch-on-game-id anywhere outside the module itself.
`packages/shared/src/registry.ts` (`GAMES`) is the whole catalogue. `Room.ts`
and the lobby never branch on which game is active — they only ever call
through the interface.

**Adding a game touches more than the registry comment claims.** Write
`games/<id>/` in shared, then let `tsc` find the rest — every one of these is a
compile error until it is done, which is the point:

- `gameModule.ts` — the `GameId` union, and the `GameConfig`/`GameSnapshot` unions
- `registry.ts` — `GAMES` (keyed by id; it carries no ordering and no names)
- `shared/package.json` — an `exports` subpath, so the client can import internals
- `Room.ts` — `settingsByGame` is a hand-written literal, one key per game
- `client/games/registry.tsx` — `CLIENT_GAMES`, and `CLIENT_GAME_IDS` for the
  picker's display order. **This is the only ordering.**
- `client/i18n.ts` — a `games.<id>` block in **both** dictionaries. **This is the
  only display name**; `GameMeta.name` is the internal English one for logs.
- `client/music.ts` — `MusicTrack` is `'lobby' | GameId`, so it needs a track
- `client/net/socket.ts` — two exhaustive switches: `mirrorHud` on `snap.game`,
  and `receivePrivate` on the room's `gameId`. A missing case is a type error
  rather than a silent misread — `mirrorHud` used to be a two-way ternary that
  would have read a third game's snapshot as Gun Mayhem's, and `receivePrivate`
  used to be an if/else whose `else` meant Skribbl by assumption.

And the ones no compiler catches, which is why they are worth writing down:

- **`meta.touchSupported` is an unenforced claim.** Nothing in the client reads
  it. Touch is per-screen: mount your own controls behind
  `ui/useTouchControls.ts:useShowTouchControls`. Setting it true and shipping no
  touch UI compiles and is broken on every phone in the family.
- `client/ui/styles.css` — a `.<id>__*` block. No `rotate` on cards, hard offset
  shadows only.
- `client/public/music/<id>.mp3` and its `ATTRIBUTION.md` entry. **mp3 only.**
  Point the `TRACKS` entry at an existing file rather than a missing one while a
  real track is being sourced — silence reads as the Ogg bug all over again.
- `server/src/room.test.ts` and `app.test.ts` enumerate games, and so do
  `shared/src/registry.test.ts` (a literal id list), `shared/src/series.test.ts`
  (`ALL`, plus a count that assumes exactly one game is unfit at seven players)
  and `shared/src/series.ts:MAX_SERIES_ROUNDS`. `tsc` finds none of these.
- Reuse rather than copy. All three of these are parameterised and already used
  by every game that needs them:
  - `client/games/bitInput.ts` — the whole 60 Hz sampler/tap-latch/
    sequence-in-`sessionStorage` machinery, parameterised by key map.
  - `client/games/prediction.ts:ticksBehind` — snapshot age in fractional ticks.
  - `client/game/canvasDraw.ts` — `roundRect` and `shade`. Note Tank Trouble's
    local `darken(hex, factor)` is a *different* function with the opposite sign
    convention; that is why it has a different name.
  - `ui/motion.ts:prefersReducedMotion` gates shake, trails and parallax.
- `shared/src/games/<id>/rng.ts` — **copy it, do not import another game's.**
  The duplication is the isolation: it is what makes "editing Achtung cannot
  change which template Meme Machine deals" true. Gun Mayhem used to import
  Achtung's, which quietly made that promise false for the flagship game.
- `registry.test.ts` holds every registered module to the `GameModule` contract
  — snapshot tagged with its own id, `defaultConfig` surviving
  `normalizeConfig`, junk input neither throwing nor escaping. A new game is
  covered the moment it is added to `GAMES`, with nothing to remember here.

### Usage logging

Who uses the site, when, how, and what breaks — see
[`docs/analytics.md`](docs/analytics.md) for the field reference and the
dashboard at `/admin`. Three things about it are worth knowing before touching
anything nearby:

- **The server is the only writer.** It already sees joins, picks, matches and
  errors, so the client reports only what the server cannot observe: device
  shape (`hello`), uncaught browser errors, round-trip time, and three taps that
  send no other message. Before adding a client event, check whether the server
  already knows — it usually does, and two writers of one fact is how a log
  starts contradicting itself.
- **Adding a game needs nothing here.** Events carry the `GameId` as a string
  and the dashboard groups by whatever it finds, so a new game appears in the
  games table the first time somebody plays it. This is the one list in this
  file that a new game is *not* on.
- **`analytics` is a singleton**, like `serverNow`, and `Client.sendError`
  records every error the server sends. Recording never throws and never blocks
  — a logging bug must not be able to stall a tick loop.

### Private per-player state

`Room.broadcastSnapshot` builds the snapshot **once**, encodes it **once**, and
pushes the identical string to every socket in the room. That single encode is
most of why the tick loop is cheap, and it means **a snapshot can never hold a
secret** — anything in one is readable in devtools by every player.

Games with hidden information implement the optional
`GameInstance.privateFor(playerId)` instead. `Room` calls it once per player per
broadcast and sends a `private` message only when the serialised value changed,
so a value that changes once a round costs nothing in the steady state. It is
re-sent from `sendCatchUp` and forgotten on `detach`/`resume`, because a player
who reconnects must get their private view back.

Unlike `snapshot()`, `privateFor` must **not** drain — it is called repeatedly
and has to be cheap to answer with `null`, which is what it returns for every
game that has no secrets.

**Worms uses this channel for something that is not a secret**, and it is worth
knowing why before assuming the name is the contract. What the channel really
provides is *pushed on change, re-sent after a reconnect, replayed by
`sendCatchUp`* — which is exactly what its crater list needs and what a snapshot
cannot give it, since craters are far too big to re-send thirty times a second
and a delta is not a world to someone who just joined. That also makes Worms the
one game exempt from `registry.test.ts`'s "a stranger gets null" rule: spectators
need the terrain to draw the ground, and a spectator is indistinguishable in
there from an unknown id. See `docs/games/worms.md`.

Routing a `private` message to the right slice is an **exhaustive switch** over
`GameId` in `socket.ts:receivePrivate`, with a `never`-typed default. It used to
be `if (gameId === 'memes') … else`, where the `else` meant Skribbl by
assumption; a seventh game with secrets would have had its payload parsed as a
Skribbl secret with no compile error. Keep it exhaustive.

`GameConfig` and `GameSnapshot` are unions discriminated by a `game` field
(one member per `GameId`). Narrow with `settings.game === 'achtung'` before
reading game-specific fields — see the `Room.settings` getter for the pattern.
Room settings are kept **per game** (`Room.settingsByGame`), so switching games
in the lobby and back doesn't reset either one's config.

### Networking model

Server-authoritative, fixed 60 Hz tick (`packages/shared/src/engine.ts`:
`TICK_RATE`/`TICK_MS`/`DT`), snapshot broadcast every other tick (30 Hz). The
tick loop and snapshot cadence live once in `Room.ts` and are game-agnostic.

**Determinism is load-bearing.** The client predicts its own player by
re-running the *exact same* per-tick function the server runs
(`achtung/sim.ts:stepTick` / `gunmayhem/physics.ts:stepMovement`), then
reconciles against the next server snapshot. This only works if the sim never
reads anything outside the state it's given (no `Date.now()`, no ambient
randomness — RNG is always a seeded `RngState` threaded explicitly). Each
game's `sim.test.ts`/`physics.test.ts` pins this down with a same-seed,
same-input-log, byte-identical-output test — if you touch tick logic, that
test is the one that catches drift.

**Remote bodies are smoothed through one shared rule** (`game/RemoteBodies.ts`),
used by Gun Mayhem, Tank Trouble and Gravity Guy. Every frame re-extrapolates
everyone from the newest snapshot, so on the frame a new one lands their drawn
position steps by however wrong the last guess was — thirty times a second. The
rule has two halves and both matter: **slide across ordinary drift**, and
**snap on a velocity event** (a jump, a landing, a gravity flip, a tank hitting
a wall). Smoothing the events too is what made jumping feel floaty in Gun
Mayhem; smoothing nothing is what made Tank Trouble and Gravity Guy stutter —
Tanks had per-seat smoothers wired up but passed `jumped` as
`mine && predictor.resynced`, so for every remote seat it was a no-op.

The event threshold **scales with how much server time the snapshot skipped**.
It is a rate in disguise: a 500-unit velocity change across one 33 ms interval
is a knockback, and across a 250 ms hole it is just gravity. Comparing the raw
numbers meant every packet-loss burst was classified as an event, snapped to,
and the whole missing stretch landed in one frame — the "freeze then teleport"
players report. Achtung deliberately has none of this: its head is joined to a
persistent trail, and sliding the head would detach it from its own line.

Three test files pin the three things "lag" turns out to mean, all over a
simulated 114 ms Israeli link (`net/lagHarness.ts`): `net/inputLatency.test.ts`
(press to pixel, which must not scale with distance — currently 0–17 ms
predicted against 133–167 ms unpredicted), `net/gameLag.test.ts` (per-frame
stutter at 144 Hz, tracking error, and recovery across a 250 ms hole) and
`game/RemoteBodies.test.ts` (the slide/snap rule itself). Measure at a refresh
rate that is **not** 60 Hz — at 60 Hz one tick and one frame cover the same
ground, which is exactly the rate at which quantised motion is invisible.

Client-side, snapshots never touch React state directly (`net/feed.ts`'s
`SnapshotFeed`, module-level, not a store) — pushing 30 Hz updates through
React would re-render the tree 30x/sec for no benefit. Canvas renderers read
`feed` directly in their own `requestAnimationFrame` loop. Only slow-changing
derived data (scores, phase, countdown) gets mirrored into the zustand
`store.ts` for the HUD, throttled in `net/socket.ts:mirrorHud`.

Snapshots play back on a **synced server-time timeline**, not on arrival time
(`net/clock.ts` maps the server clock onto ours from the min-RTT ping sample;
`net/feed.ts` places each snapshot at the instant the server authored it). The
render delay in `feed.ts:updateDelay` therefore has to include `minRtt/2` — a
snapshot sits on the timeline at its authoring instant, so the soonest it can
physically be here is half the fastest round trip later. Leaving that term out
buffers less than the wire takes and underruns on every distant deploy, while
looking fine on localhost. `feed.test.ts` pins it.

Reconnection: `sessionStorage` (not localStorage — deliberately per-tab, see
gotchas) holds `{code, playerId, token}`; a dropped player's seat is held for
60s server-side (`server/src/roster.ts: DISCONNECT_GRACE_MS`) and their input
freezes rather than being removed.

**The server splits three ways**, and which file a change belongs in is usually
obvious once you know they exist:

- `roster.ts` — membership rules as pure functions over a player list: colour
  allocation, identity patching, the disconnect grace window, host handover. No
  timers, no sockets.
- `MatchClock.ts` — the tick loop: deadline scheduling, the accumulator, the
  250 ms catch-up clamp, snapshot cadence, the pause clock. Read the comment on
  `scheduleNext` before touching any of it; `setInterval(loop, TICK_MS)` is the
  obvious version and is subtly wrong.
- `Room.ts` — orchestration and broadcast, and nothing game-specific. If you
  find yourself writing `if (gameId === …)` there, it belongs on the module.

### Per-game notes

The details that only matter when you are inside one game live next to a
pointer instead of in this file, so every session does not pay for all nine.
**Read the one you are touching before you touch it** — each is a list of
things that cost real debugging time to learn.

- **Achtung die Kurve** — [`docs/games/achtung.md`](docs/games/achtung.md)
- **Bomb It** — [`docs/games/bombit.md`](docs/games/bombit.md)
- **Gun Mayhem** — [`docs/games/gunmayhem.md`](docs/games/gunmayhem.md)
- **Worms** — [`docs/games/worms.md`](docs/games/worms.md)
- **Tank Trouble** — [`docs/games/tanks.md`](docs/games/tanks.md)
- **Gravity Guy** — [`docs/games/gravity.md`](docs/games/gravity.md)
- **Skribbl** — [`docs/games/skribbl.md`](docs/games/skribbl.md)
- **Broken Telephone** — [`docs/games/telephone.md`](docs/games/telephone.md)
- **Meme Machine** — no separate notes; `packages/shared/src/games/memes/` is
  conventional, and its one secrecy subtlety (captions are private until the
  reveal) is covered by *Private per-player state* above. Two things that are
  not obvious from the code:
  - **The catalogue is generated, and re-running the generator replaces it.**
    `scripts/curate-memes.ps1` (stills) and `curate-gif-memes.ps1` (muted mp4
    loops) take the top N of a *live* Imgflip ranking, so a re-run legitimately
    changes which templates are present. `templates.test.ts` therefore asserts
    floors, not exact counts. The stills script also emits the shared
    `MemeAsset` interface that `gifTemplateAssets.ts` is typed against — it must
    keep declaring `format?: 'mp4'`, or every animated template fails to compile
    the next time it runs.
  - **`MemesSnapshot.gallery` is null until `matchOver`.** The end-of-match
    gallery is every meme of the match, archived in `finishRound` (after
    `awardTopMemes` settles the scores, before `dealRound` empties `entries`).
    It is attached to exactly one snapshot rather than carried the whole way
    through, because `Room.broadcastSnapshot` re-encodes and re-sends the
    snapshot thirty times a second and nobody can look at a gallery mid-match.
    `MatchClock` broadcasts a final snapshot before stopping, and `sendCatchUp`
    replays it, so a reconnecting player still gets the whole thing.

### Client structure

Shared canvas machinery the renderers reuse: `game/CanvasStage.ts` (DPR,
resize/letterbox transform, screen↔arena coordinate mapping),
`game/interpolation.ts` (bracket two snapshots around render time, lerp), and
`game/canvasDraw.ts` (`roundRect`, `shade`).

Each game's `Renderer.ts` owns a `requestAnimationFrame` loop calling
`stage.begin()` then drawing; `predictor.ts` (Gun Mayhem, Tank Trouble and
Gravity Guy — Achtung predicts inline in its renderer) does the reconciliation
math. The renderer instance is constructed once per mount in a `useEffect` with
an empty dep array (see the HMR gotcha below before "fixing" that pattern).

## Testing multiplayer without two tabs

`npm run smoke` covers create/join/ready against a live deploy. For anything
game-specific, the fast pattern is **one browser tab plus a throwaway `ws` bot**
in a scratch file at the repo root — a real second player over the real wire,
sharing the protocol constants so it cannot drift:

```bash
npx tsx bot.tmp.mjs ROOMCODE   # then delete it
```

`*.tmp.mjs` / `*.tmp.ts` are gitignored, so a forgotten one is not `git status`
noise — but still delete it, because a stale bot is worse than no bot.

The bot imports `PROTOCOL_VERSION` and `WS_PATH` from
`./packages/shared/src/protocol.ts`, joins with `{ t: 'join', v, code, identity }`,
and drives the game with `{ t: 'input', i: ... }`. Three traps, each of which has
made a working feature look broken:

- **Re-`ready` on every room broadcast, not just on `welcome`.** `rematch` clears
  ready flags, so a bot that readies once silently blocks the next match.
- **A witness that joins mid-round sees nothing that already happened.** Drained
  state — Skribbl's ink, Achtung's trail — appears in exactly one snapshot.
  Start the bot *before* the thing you want to observe.
- **Seats are held for 60 s after a disconnect.** Killing and restarting a bot
  inside that window makes it a spectator, and the abandoned seat still counts
  toward turn rotation and the minimum-players check.

Drive the browser side through `window.mgStore` (dev-only) rather than synthetic
clicks at coordinates: `mgStore.getState()` for assertions, and
`[...document.querySelectorAll('button')].find(...)?.click()` for actions. For
canvas input, dispatch `PointerEvent`s at the element and stub
`el.setPointerCapture = () => {}`, which synthetic events cannot satisfy.

## Non-obvious gotchas (cost real debugging time to find — don't rediscover)

- **localStorage is shared across all tabs on the same origin.** Testing
  "two players" by setting `mg.identity` in localStorage per tab is a trap —
  whichever tab loads/joins first wins, and a later `localStorage.setItem` in
  another tab doesn't retroactively rename an already-joined player. Set
  identity, *then* navigate, in that order, per tab; don't assume two tabs
  can hold two different identities simultaneously via localStorage alone.
- **Changing only `location.hash` does not reload the page** (browser
  behavior, not a bug) — the SPA's identity/join effect in `App.tsx` won't
  re-run. To force a real navigation in a same-origin tab, change the path or
  add a cache-busting query param, e.g. `location.href =
  'http://localhost:5173/?t=' + Date.now() + '#/room/CODE'`.
- **Editing a plain class module (e.g. `Renderer.ts`) and relying on Vite
  HMR** propagates the update to the nearest React-refreshable boundary
  (the importing component) but does not necessarily re-run that component's
  `useEffect` if its deps array is unchanged — an already-constructed
  instance keeps running with its *old* prototype methods indefinitely,
  silently. If a renderer's behavior doesn't match a just-saved edit, do a
  full reload (not HMR) before concluding the fix didn't work.
- **`requestAnimationFrame` is throttled/fully suspended in backgrounded
  browser tabs.** When driving multiple tabs via browser automation, front
  the tab you're inspecting before reading canvas pixels/state — a canvas
  that looks permanently blank may just be backgrounded, not broken.
- **Two browser tabs is the wrong tool for testing two players**, for all the
  reasons above stacked on top of each other (shared localStorage, hash
  navigation not reloading, rAF suspended when backgrounded, and automation
  harnesses that lose a tab when you assign `location.href`). To prove
  multiplayer works — locally or against a deploy — run `npm run smoke`
  (`scripts/smoke-ws.mjs`), which drives two real `ws` clients through
  create/join/ready. Faster, deterministic, and it exercises the actual wire
  protocol. Extend that script rather than reaching for tabs again.
- **Safari has never supported Ogg Vorbis** — not "old Safari", any of it,
  desktop and iOS. Two music tracks shipped as `.ogg` and the site was silent on
  every iPhone from first paint, which read as a code bug through two rounds of
  fixes. Everything in `public/music/` is mp3 for that reason; see the note in
  `public/music/ATTRIBUTION.md` before adding a format.
- **Safari will not play media served without HTTP byte ranges.** Its media
  stack opens every resource with `Range: bytes=0-1` and refuses a plain `200`.
  `packages/server/src/static.ts` answers `206` and advertises `Accept-Ranges`;
  `static.test.ts` pins it, including that exact opening probe. Chrome and
  Firefox take the whole file, which is why this is invisible locally.
- **Anything driven by `requestAnimationFrame` is frozen in a hidden or
  backgrounded tab**, including the Browser pane when it is not displayed. Never
  put React state behind a rAF poll — a player who tabs away and back gets a
  frozen UI. Canvas drawing is the only thing that may depend on it. This also
  makes a hidden preview pane useless for testing anything rAF-driven: a blank
  canvas there usually means "not compositing", not "broken".
- **`import()` from the browser console can hand you a *different module
  instance* than the running app.** After a Vite HMR update the app holds
  `/src/x.ts?t=123` while a bare `import('/src/x.ts')` gets a fresh copy — so a
  module-level singleton (`feed`, `music`, `socket`) inspected that way looks
  empty while the app's own copy is fine. Reach the app's state through
  `window.mgStore` (exposed in dev), or patch a global such as
  `WebSocket.prototype.send`, which is immune to module identity.
- Rooms and everything in them are in-memory; there is no persistence layer
  to reach for and none should be added casually.

## UI conventions worth not relitigating

- Faces are **assets** (`public/faces/*.svg`), all nine drawn on one grid: eyes
  on y=42, mouths inside y=62..74, one pen weight (9 primary, 7 for detail).
  `Avatar.tsx` scales them by 26/100 and anchors at `y=13`, so a stroke much
  thinner than 9 reads as a decal pasted on the head rather than part of the
  drawing, and a mouth below y≈74 hangs off the chin. Hats stay procedural in
  *two* places — `Avatar.tsx` (front-facing) and `game/appearance.ts` (side-on
  for the arena) — and have to be changed in both.
- Cards, stickers and minicards are **not** tilted. `transform: rotate` was
  removed everywhere deliberately.
- Hard offset shadows, never soft — see the note at the top of `tokens.css`. The
  single blur in the codebase is `.overlay--solid`'s backdrop scrim, which is a
  scrim rather than a shadow.
- **Inter ships no Hebrew subset**, so `--font-ui` silently falls back to
  `system-ui` for Hebrew. Anything Hebrew and prominent — the Skribbl word
  banner and chat log — uses `--font-display` (Rubik), which has it.
- Layout is logical-property first (`inset-inline-start`, `text-align: start`).
  The deliberate exceptions are commented where they live: the toggle knob's
  `translateX`, the touch controls' physical left/right, and numeric readouts
  that pin `dir="ltr"` in JSX. Content whose direction is its own — a room code,
  a Skribbl word from the other language's list — gets an explicit `dir`.
- The appearance picker is an inline carousel flanking the avatar with chevrons,
  not a grid of labelled buttons.
