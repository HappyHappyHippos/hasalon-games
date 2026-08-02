# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

הסלון (hasalon, "the living room") — a room-based multiplayer game site. Create
a room, share the code/link, everyone joins, the host picks a game from a
live game picker, then plays. No accounts, rooms live in memory only. Two
games ship today: **Gun Mayhem** (4-player platform fighter, the priority —
this is the flagship game and should get the most care) and **Achtung die
Kurve** (up to 8-player curve/Snake game).

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
subpath (`@mg/shared/achtung`, `@mg/shared/gunmayhem`) because both games
export same-named symbols (`createState`, `stepTick`, `ARENA_WIDTH`, ...) —
importing from the root never gives you game internals.

### The GameModule seam

This is the one abstraction the whole codebase hangs off. A game is a
`GameModule` (`packages/shared/src/gameModule.ts`): `meta`, `defaultConfig`,
`normalizeConfig`, and `create(seats, config, seed) → GameInstance`. A
`GameInstance` is a closure over one match's state exposing
`applyInput`/`stepTick`/`snapshot`/`status`/`scores`/`winnerSeat` — no
generics, no switch-on-game-id anywhere outside the module itself.
`packages/shared/src/registry.ts` (`GAMES`) is the whole catalogue; adding a
third game means one new `games/<id>/module.ts` plus one line in `registry.ts`
plus a matching entry in the **client** registry
(`packages/client/src/games/registry.tsx`, maps id → box art / screen /
settings panel component). `Room.ts` and the lobby never branch on which game
is active — they only ever call through the interface.

`GameConfig` and `GameSnapshot` are unions discriminated by a `game` field
(`'achtung' | 'gunmayhem'`). Narrow with `settings.game === 'achtung'` before
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

### Client structure

Shared canvas machinery both games reuse: `game/CanvasStage.ts` (DPR,
resize/letterbox transform, screen↔arena coordinate mapping) and
`game/interpolation.ts` (bracket two snapshots around render time, lerp).
Each game's `Renderer.ts` owns a `requestAnimationFrame` loop calling
`stage.begin()` then drawing; `predictor.ts` (Gun Mayhem only — Achtung
predicts inline in its renderer) does the reconciliation math. The renderer
instance is constructed once per mount in a `useEffect` with an empty dep
array (see the HMR gotcha below before "fixing" that pattern).

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
- Rooms and everything in them are in-memory; there is no persistence layer
  to reach for and none should be added casually.

## Recent Architecture & UI Changes
- **Face Asset Pipeline**: Replaced programmatic face drawing paths with SVG assets (`public/faces/*.svg`). Added new expressive faces ('surprised', 'tired', 'wink').
- **Character Customizer UI**: Redesigned the character appearance picker on the Home Screen and Lobby Screen to be a sleek, inline Carousel Picker that visually flanks the Avatar using left/right SVG chevrons, replacing the bulky grid of buttons and text labels. Handled RTL (Right-to-Left) layout logic to ensure arrows point correctly in Hebrew.
- **Card Aesthetics**: Removed `transform: rotate` and tilt mechanics from game cards, minicards, reviews, stickers, and animations for a strictly aligned, cleaner UI layout.
- **Avatar Anchoring**: Shifted the face assets down in `Avatar.tsx` to ensure hats sit above the eyes without clipping.
