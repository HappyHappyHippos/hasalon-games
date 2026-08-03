# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

הסלון (hasalon, "the living room") — a room-based multiplayer game site. Create
a room, share the code/link, everyone joins, the host picks a game from a
live game picker, then plays. No accounts, rooms live in memory only. Three
games ship today: **Gun Mayhem** (4-player platform fighter, the priority —
this is the flagship game and should get the most care), **Achtung die Kurve**
(up to 8-player curve/Snake game) and **Skribbl** (up to 8-player draw and
guess, Hebrew or English).

npm workspaces monorepo. Git repo with `origin` at
`github.com/HappyHappyHippos/hasalon-games` (public), deployed on Railway at
https://hasalon-games-production.up.railway.app — see **Deployment** below.

## Commands

```bash
npm install                 # once, from repo root
npm run dev                 # server (tsx watch, :3000) + client (vite, :5173) together
npm run typecheck           # tsc --noEmit across all 3 packages
npm test                    # vitest run (whole suite; app.test.ts alone takes ~45s, real WS integration)
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

**Playtest on `dev` before `main`.** Anything that changes how the game feels —
controls, netcode, tuning, voice — goes to the Railway `dev` environment first
and gets played on real phones there. `main` is production and the people using
it are family, not testers.

```bash
git push -u origin <branch>
railway environment dev && railway service hasalon-dev
railway service source connect --repo HappyHappyHippos/hasalon-games --branch <branch>
railway environment production   # or later commands silently target dev
```

The service is `hasalon-dev` at https://hasalon-dev-dev.up.railway.app. That
`source connect` prints **"ServiceInstance not found" and succeeds anyway** —
confirm by reading the deploying commit hash out of `railway status --json`,
never by trusting the exit message. The dev service draws Hobby-plan usage while
it exists, so it is worth pointing at whatever branch is current rather than
leaving a stale one deployed.

Railway, connected to `main` — **`git push` is the deploy**, there is no deploy
command. `railway.json` at the repo root holds the deploy config (Dockerfile
builder, `/healthz` healthcheck, `numReplicas: 1`, `sleepApplication: true`);
change it there and commit rather than in the dashboard. `fly.toml` is a
leftover alternative — configured, nothing deployed to it.

`railway status` / `railway logs` / `railway usage` for the current state. The
README's "Deploying" section has the full runbook.

**The GitHub→Railway webhook has silently stopped firing before.** Two merges to
`main` produced no build at all — not a failed one, *no deployment attempted* —
and prod kept serving a commit from hours earlier while everything looked
healthy. Never assume a push deployed. Check
`railway status --json | .latestDeployment.meta.commitHash` against `git rev-parse HEAD`,
or `railway deployment list` for whether a build even started. `railway up`
deploys from the CLI when the webhook is dead.

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
- `registry.ts` — `GAMES` and `GAME_IDS`
- `shared/package.json` — an `exports` subpath, so the client can import internals
- `Room.ts` — `settingsByGame` is a hand-written literal, one key per game
- `client/games/registry.tsx` — `CLIENT_GAMES` and `CLIENT_GAME_IDS`
- `client/i18n.ts` — a `games.<id>` block in **both** dictionaries
- `client/music.ts` — `MusicTrack` is `'lobby' | GameId`, so it needs a track
- `client/net/socket.ts` — `mirrorHud` switches on `snap.game`; the missing case
  is a type error rather than a silent misread (it used to be a two-way ternary,
  which would have read a third game's snapshot as Gun Mayhem's)

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

`GameConfig` and `GameSnapshot` are unions discriminated by a `game` field
(`'achtung' | 'gunmayhem' | 'skribbl'`). Narrow with `settings.game === 'achtung'` before
reading game-specific fields — see `Room.settings` getter and
`store.ts:selectSettings` for the pattern. Room settings are kept **per game**
(`Room.settingsByGame`), so switching games in the lobby and back doesn't
reset either one's config.

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
60s server-side (`Room.ts: DISCONNECT_GRACE_MS`) and their input freezes
rather than being removed.

### Achtung specifics

Collision is an occupancy grid (`achtung/grid.ts`), one byte per arena unit.
The probe geometry (radius, `PROBE_EPS`, `PROBE_ARC`, sweep step) is
interdependent — the file's top comment explains why probes can never
self-collide with a curve's own trail as long as the arc stays under 90°, and
why a *shrinking* radius needs `SELF_GRACE_TICKS`. Read it before touching
`achtung/constants.ts` speed/radius values.

### Gun Mayhem specifics

`gunmayhem/physics.ts:stepMovement` is the movement half, shared verbatim by
server and client prediction. Two things make it feel right: coyote time and
jump buffering (`COYOTE_TICKS`/`JUMP_BUFFER_TICKS` in `constants.ts`) — don't
remove these while "simplifying" the jump code, they're most of what
separates responsive from broken. Platforms are `solid` or `oneWay` (land
from above / jump up through / drop through on Down); bullets pass through
`oneWay` but not `solid`. Knockback (`gunmayhem/sim.ts:damageAndLaunch`)
*replaces* velocity rather than adding to it — that's intentional, it's what
makes every hit read consistently regardless of prior momentum — and scales
with accumulated damage per `KB_BASE`/`KB_PER_DAMAGE`.

`gunmayhem/constants.ts` is meant to be tuned; movement feel and weapon
balance are one-line changes there, not sim-logic changes.

Input is a bitmask + sequence number (`IN_LEFT`/`IN_JUMP`/etc in `types.ts`),
not per-key messages — taps shorter than one tick still register because the
server ORs rising edges (`sim.ts:applyInput`), and the sequence lets the
client replay unacknowledged inputs after a correction
(`client/games/gunmayhem/predictor.ts`). Prediction only runs while the local
player is actually in control (not respawning or out of stocks) —
knockback isn't predictable so the code deliberately doesn't try.

### Skribbl specifics

**The word is the whole design constraint.** `SkribblState.word` never leaves the
server. The snapshot carries only `masked` — the pattern with unrevealed letters
replaced — computed server-side, so a guesser is never sent letters they have not
earned. The drawer gets the real word through `privateFor` (see above). There is
deliberately no variant that ships the word plus a count of how much to hide.

Three tests guard that, and they are the ones to keep green: the mask is checked
at every reveal step for every word in both lists; `privateFor` is asserted to
answer the drawer and `null` for everyone else; and an end-to-end test in
`app.test.ts` reads back a guesser's entire received-frame buffer and greps it.

**Ink** is a flat op stream in the snapshot (`OP_BEGIN`/`OP_TO`/`OP_CLEAR` in
`skribbl/constants.ts`), drained as it is sent — so `droppableSnapshots: false`,
same as Achtung's trail. Two paths it cannot use, both learned the hard way:

- **not `mirrorHud`** — that returns early inside its 120 ms throttle, which
  would silently drop most strokes. `socket.ts` hands Skribbl snapshots to
  `games/skribbl/inkBus.ts` *before* the throttle instead.
- **not `SnapshotFeed`** — it keeps one second of history, so a tab backgrounded
  for two seconds would lose that ink permanently. The client accumulates into an
  offscreen canvas that `CanvasStage.begin()` never wipes.

Undo is a clear plus a full replay, because a delta already accumulated on
everyone's surface cannot be un-drawn.

**Guess matching** (`skribbl/guess.ts`) folds Hebrew final letters, strips
niqqud, and — the one that decides whether the Hebrew half feels broken — treats
interior vav and yod as optional, so שלחן and שולחן both count. Which spelling
someone types is habit rather than knowledge, and rejecting either is rejecting a
right answer. Only for words of four or more normalised letters, or the fold
equates שר and שיר.

**Language is a room setting** (`SkribblConfig.lang`), because the server has no
other notion of one — `lang` is client-only everywhere else. The settings panel
patches it once to match the host's UI language.

Word lists are `words.he.ts` / `words.en.ts`, tagged easy/medium/hard, one word
per line so growing them is appending. The three choices are always one per tier.
A test asserts no duplicates within a language — watch for homographs, which is
how ביצה (egg / swamp) and ספר (book / barber) got listed twice.

Known limit: a player joining **mid-round** sees the drawing from the moment they
arrived, because catch-up replays the last snapshot and for a delta format that is
nearly empty. Reconnects are fine — the client keeps its surface across a socket
reopen.

### Client structure

Shared canvas machinery both games reuse: `game/CanvasStage.ts` (DPR,
resize/letterbox transform, screen↔arena coordinate mapping) and
`game/interpolation.ts` (bracket two snapshots around render time, lerp).
Each game's `Renderer.ts` owns a `requestAnimationFrame` loop calling
`stage.begin()` then drawing; `predictor.ts` (Gun Mayhem only — Achtung
predicts inline in its renderer) does the reconciliation math. The renderer
instance is constructed once per mount in a `useEffect` with an empty dep
array (see the HMR gotcha below before "fixing" that pattern).

## Testing multiplayer without two tabs

`npm run smoke` covers create/join/ready against a live deploy. For anything
game-specific, the fast pattern is **one browser tab plus a throwaway `ws` bot**
in a scratch file at the repo root — a real second player over the real wire,
sharing the protocol constants so it cannot drift:

```bash
npx tsx bot.tmp.mjs ROOMCODE   # then delete it
```

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
