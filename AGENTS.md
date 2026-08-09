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
```

Before proposing a change as finished: `npm run typecheck && npm run lint && npm test`.

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
