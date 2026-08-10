# AGENTS.md

The conventions for this repo live in **[CLAUDE.md](CLAUDE.md)**. Read it first —
it is the architecture doc, not a style guide, and most of it is things that
cost real debugging time to learn.

Per-game implementation notes are in [`docs/games/`](docs/games/), one file per
game. Read the one for the game you are touching before you touch it.

## The short version

```bash
npm install
npm run dev          # server :3000 + client :5173
npm run test:unit    # ~13s — the loop to run while working
npm run typecheck
npm run lint
npm test             # ~65s, includes real-WebSocket server tests
npm run build        # Vite client bundle + esbuild server bundle
```

Before proposing a change as finished: `npm run typecheck && npm run lint && npm test && npm run build`.
The production build is a separate gate: Vite/Rollup catches module-export and
bundle errors that an interrupted local workflow can otherwise send to Railway.

## Five things that catch people out

1. **Determinism is load-bearing.** The client predicts by re-running the exact
   per-tick function the server runs. No `Date.now()`, no ambient randomness in
   any sim — RNG is a seeded state threaded explicitly. Each game's
   `sim.test.ts` pins this with a same-seed, byte-identical test. If you touch
   tick logic, that test is the one that catches drift.

2. **A snapshot can never hold a secret.** It is built once, encoded once, and
   the identical bytes go to every socket in the room. Hidden state goes through
   `GameInstance.privateFor`.

3. **Don't test multiplayer with two browser tabs.** localStorage is shared
   across tabs, `requestAnimationFrame` is frozen in background tabs, and
   changing `location.hash` doesn't reload. Use `npm run smoke`, or one tab plus
   a throwaway `ws` bot. CLAUDE.md has the recipe.

4. **Each game copies `rng.ts` on purpose.** The duplication is the isolation.
   Never import another game's.

5. **Merge to `dev` and playtest before `main`.** Railway builds `dev` from the
   `dev` branch and production from `main`, both automatically — a merge *is*
   the deploy. Anything that changes how a game feels goes through `dev` first
   and gets played on a real phone. `main` is production, and the people on it
   are family, not testers.

## Architecture seams to preserve

- `packages/shared` owns deterministic rules, protocol, room types and the game
  registry; `packages/server` owns rooms/ticks/sockets; `packages/client` owns
  React, canvas rendering and prediction. Shared game internals are imported
  through their `@mg/shared/<game>` subpath, not the root export.
- `GameModule`/`GameInstance` is the game boundary. `Room.ts` and lobby code stay
  game-agnostic; game-specific branching belongs in the module or in exhaustive
  client switches. Adding a game also requires its shared export subpath,
  per-game settings entry, client registry/order, both i18n dictionaries, music,
  socket HUD/private switches, touch UI, CSS and server tests.
- Snapshots are built and encoded once for every socket, so they can never hold
  secrets. Use `GameInstance.privateFor(playerId)` for private player state.
- Reuse `client/games/bitInput.ts`, `client/games/prediction.ts:ticksBehind`,
  `client/game/canvasDraw.ts`, `client/game/RemoteBodies.ts` and
  `ui/motion.ts`. Copy each game's `rng.ts` instead of importing another game's;
  that duplication preserves deterministic isolation.
- High-frequency snapshots live in `net/feed.ts`, not React state. Renderers
  read the feed in their own rAF loop; only slow HUD data is mirrored to the
  store. Remote smoothing slides ordinary drift and snaps velocity events.

## Deploying and proving the deploy

| Branch | Railway service | URL |
|---|---|---|
| `dev` | `hasalon-dev` | https://hasalon-dev-dev.up.railway.app |
| `main` | production | https://hasalon-games-production.up.railway.app |

- Both services are permanently connected to their branches. Do not repoint a
  service to a feature branch. Merge and push to deploy.
- Before trusting Railway CLI output, select the intended environment/service:
  `railway environment dev && railway service hasalon-dev` (or select
  production explicitly afterward). Railway commands otherwise target the last
  selected environment.
- Never infer success from a push or `/healthz`. Confirm
  `latestDeployment.meta.commitHash` from `railway status --json` equals the
  branch HEAD; the GitHub webhook has previously failed silently.
- Keep exactly one replica because rooms are in memory. `railway.json` is the
  source of truth and `sleepApplication` is intentional.
- A green image/health check does not prove WebSockets. Run `npm run smoke --
  https://hasalon-dev-dev.up.railway.app` after a dev deploy. `Online` and
  `Sleeping` are healthy Railway states; include `Failed`/`Crashed` as terminal
  states when polling.

## Browser and multiplayer test traps

- Do not use two same-origin tabs as two players: localStorage is shared, hash
  changes do not reload, and background rAF is suspended. Use `npm run smoke`
  or one browser plus a temporary real-WS bot.
- Full-reload after editing a renderer class. Vite HMR can preserve an existing
  instance with old prototype methods when the importing React effect does not
  rerun.
- Do not inspect singleton modules with a fresh browser-console `import()` after
  HMR; it may create a different module instance. Use the dev-only
  `window.mgStore` or patch a browser global.
- Media must be MP3 for Safari, and the static server's byte-range support must
  remain intact. React state must never depend on rAF because hidden tabs freeze
  it.
