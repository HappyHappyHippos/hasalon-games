# הסלון (hasalon)

*"The living room."* A small site for playing simple multiplayer games with
friends in the browser — create a room, wait for everyone to pile in, then
pick what to play together.

- Room codes and shareable invite links, no accounts
- Pick the game **after** everyone's joined, not before
- Up to 8 players, desktop keyboard or phone touch
- One Node process serves the site and the game, so it deploys anywhere

## The games

**Gun Mayhem** — a 4-player platform fighter. Run, double-jump, shoot each
other off the stage. Damage adds up, knockback scales with it, three stages,
five weapons, bombs, crates. This is the one we actually care about being
good.

**Achtung die Kurve** — up to 8 players, steer a curve, don't hit anything,
be the last one going. Classic rules plus Curve Fever-style powerups.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The game server runs on port 3000 and Vite proxies
`/ws` to it. To play from a phone on the same wifi, use the `Network:` address
Vite prints.

Other scripts:

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build
```

```bash
npm run smoke        # two real WS clients against a running deploy
```

`npm start` runs the production build (server + built client on one port).

## How to play

**Create a room**, share the code or the link, and once your friends have
piled in, the host picks a game from the lobby's game picker — everyone sees
the choice land live. Ready up, and the host starts the match. If more people
are ready than the game seats (Gun Mayhem is 4, Achtung is 8), the extras
spectate and rotate in next match.

### Gun Mayhem

<kbd>←</kbd>/<kbd>→</kbd> or <kbd>A</kbd>/<kbd>D</kbd> to move, <kbd>↑</kbd> or
<kbd>W</kbd> to jump (you get two), <kbd>↓</kbd>/<kbd>S</kbd> to drop through a
ledge, <kbd>J</kbd> to shoot, <kbd>K</kbd> to throw a bomb. On a phone you get
an on-screen gamepad — landscape recommended.

You start with an infinite pistol. Crates fall from the sky and hand you an
SMG, shotgun, sniper, or rocket launcher for a limited number of shots before
you're back to the pistol. Getting hit adds damage and knockback scales with
however much damage you're carrying — low damage, a shove; high damage, gone.
Fall past the edge of the stage and you lose a stock; run out of stocks and
you're out for the round. Last one standing takes the round; first to the
target number of round wins takes the match.

### Achtung die Kurve

Steer with <kbd>←</kbd>/<kbd>→</kbd> or <kbd>A</kbd>/<kbd>D</kbd>. On a phone,
hold the left or right half of the screen. You only ever turn — you can't stop
or speed up (unless a powerup says otherwise).

Your trail is solid and so is everyone else's. Every so often your curve leaves
a gap; that's the only way through. Each time someone crashes, everyone still
alive scores a point. First to the target score wins — by two, unless the host
turns that off.

Powerups are colour-coded: green affects you, red affects everyone else, blue
affects everyone. Speed changes, thin/thick lines, a ghost pass-through,
inverted controls, and one that wipes every trail on the field.

## Layout

```
packages/
  shared/   game rules, wire protocol, room types, game registry  (@mg/shared)
  server/   rooms, matchmaking, the tick loop                     (@mg/server)
  client/   React UI, the הסלון design system, canvas renderers   (@mg/client)
```

Inside `shared`, each game is self-contained under `src/games/<id>/` (sim,
physics, constants, types) and exposes a `GameModule` — the seam the room
talks through. `shared/src/registry.ts` is the whole catalogue. `client/src/
games/registry.tsx` is the matching client-side registry: box art, the game
screen, and the settings panel for the lobby.

`shared` stays as plain TypeScript source with no build step — Vite compiles it
for the browser, `tsx` runs it in development, and esbuild bundles it into the
server for production.

## How it works

**One simulation, two places.** The server is authoritative: it runs the game
at 60 Hz and broadcasts a snapshot every other tick. The client re-runs the
*same* movement code from `@mg/shared` to predict its own character or curve a
few ticks ahead, so steering feels instant instead of a round-trip late. That
only works because the simulation is deterministic, which is what the
`sim.test.ts` / `physics.test.ts` files in each game pin down.

**Achtung's collision** is an occupancy grid, one cell per arena unit. Before
moving, each curve sweeps a fan of probes just ahead of its head; if any of
them touches a trail or a wall, it dies. The reasoning behind the geometry is
in `packages/shared/src/games/achtung/grid.ts` — read it before changing
speed, radius or the probe constants, which are interdependent.

**Gun Mayhem's movement** (`packages/shared/src/games/gunmayhem/physics.ts`)
has coyote time and jump buffering — the two things that separate a platformer
that feels good from one that feels broken — plus one-way platforms you can
jump up through and drop down through. Knockback *replaces* velocity rather
than adding to it, so every hit reads the same regardless of what you were
doing when it landed, and it scales with accumulated damage.

**Rendering** uses two layers per game: a persistent canvas for things that
shouldn't be redrawn from scratch every frame (Achtung's trail), and a
per-frame overlay for everything that moves. Remote players are drawn slightly
behind real time and interpolated between snapshots, so motion stays smooth
even at 30 Hz network updates; the local player is drawn from client-side
prediction instead, reconciled against the server's version of events each
snapshot.

**Adding a third game** means writing a `GameModule` in `packages/shared/src/
games/<id>/` plus an entry in `client/src/games/registry.tsx`. Rooms, invite
links, reconnection, the lobby's game picker, and the tick loop are already
game-agnostic — `Room.ts` only ever talks to the `GameInstance` interface.

## Deploying

Any host that runs a Docker image and supports WebSockets works. The image
builds the client, bundles the server, and serves both on `PORT` (default 3000).

> **Moving to Israel.** Every player is in Israel and Railway has no Middle East
> region — EU West measures ~114 ms median round trip, against ~10–20 ms for a
> box in-country. That gap is worth more than any netcode change, because
> prediction and jitter buffering can only *hide* distance, never remove it.
> [`deploy/README.md`](deploy/README.md) is the runbook for a self-hosted box
> (Oracle Cloud's free Jerusalem region, or Vultr Tel Aviv); the Railway deploy
> below stays up until that is proven.

### Live deployment (Railway)

| | |
|---|---|
| Site | https://hasalon-games-production.up.railway.app |
| Repo | https://github.com/HappyHappyHippos/hasalon-games |
| Railway project | `hasalon-games` (workspace *Ohad's Projects*, env `production`) |
| Region | EU West, **1 replica** |

**Deploying is just pushing.** The Railway service is connected to this repo's
`main` branch, so `git push` builds and releases. There is no deploy command to
remember.

```bash
git push
```

`railway.json` at the repo root is the source of truth for deploy config
(Dockerfile builder, `/healthz` healthcheck, one replica, app sleeping) — change
it there and commit, rather than clicking in the dashboard, or the next person
won't know why the service behaves the way it does.

Useful checks:

```bash
railway status
```

```bash
railway logs
```

```bash
railway usage
```

### Railway gotchas

These each cost real debugging time. Read before touching the service.

**Never let the replica count exceed 1.** Rooms are in memory, so a second
replica means two friends can land on different instances and never see each
other. `numReplicas: 1` in `railway.json` covers normal deploys, but scaling by
region bypasses it — see below.

**`railway scale` treats region aliases as separate entries.** The service was
created in `sfo`. Running `railway scale us-west=0 eu-west=1` did *not* drain it
— Railway kept `sfo` and `us-west` as distinct rows and the service silently
went to **2 replicas**. Zeroing the region by the exact name shown in
`railway status` is what actually works:

```bash
railway scale sfo=0
```

Always re-read the printed `replicas:` line afterwards. It tells you the truth;
the command's arguments don't.

**App sleeping is on** (`sleepApplication` in `railway.json`). The service scales
to zero when idle and wakes on the next request — cold start measured ~1.7s. It
will *not* sleep mid-game, because an open WebSocket counts as activity; it only
drops once the last player leaves. But when it does sleep, **every room code
dies**, same as any restart. Share a link and then all walk away for an hour and
you'll need a fresh room.

**`railway status` reports `Online` when healthy and `Sleeping` when idle** —
neither is `Success`. If you script a wait-for-deploy poll, match on those, and
on `Failed`/`Crashed` too, or a crashloop looks identical to still-building.

### Setting it up again from scratch

```bash
railway init -n hasalon-games
```

```bash
railway add --service hasalon-games --repo HappyHappyHippos/hasalon-games --branch main
```

```bash
railway domain
```

A public repo needs no GitHub App authorization; a private one does (install the
Railway GitHub app on the org, or fall back to `railway up`, which uploads the
working directory but gives up deploy-on-push).

### Fly.io (alternative, configured but unused)

`fly.toml` is still in the repo and works, though nothing is deployed there.

```bash
fly launch --no-deploy
```

```bash
fly deploy
```

Edit `app` in `fly.toml` first — the name has to be unique. Same single-instance
rule applies:

```bash
fly scale count 1
```

Render works from the same Dockerfile too. Note that Render's free tier spins
down after inactivity and takes about a minute to come back, versus Railway's
couple of seconds.

### Verifying a deploy

A green build only proves Docker succeeded — it says nothing about whether
WebSockets survive the host's proxy, which is the part that actually breaks.
`npm run smoke` connects two real clients, creates a room with one, joins with
the other, and checks the broadcast reaches both:

```bash
npm run smoke
```

It defaults to production; pass a host to point it elsewhere:

```bash
npm run smoke -- http://localhost:3000
```

It also prints the round-trip time and warns if latency looks wrong for a 60 Hz
fighter — that's what caught the service being deployed to the wrong continent.

For a quick liveness check, `/healthz` returns `{"ok":true,"rooms":N,"clients":N}`,
where the counts are the fastest way to confirm a client actually connected:

```bash
curl https://hasalon-games-production.up.railway.app/healthz
```

Don't try to verify multiplayer with two browser tabs — see the localStorage and
hash-navigation notes in `CLAUDE.md`.

## Known limits

- Rooms are in-memory: no database, nothing survives a restart, no history.
- Joining mid-match makes you a spectator until the next match; Achtung
  spectators won't see trail drawn before they arrived.
- No chat or voice — the assumption is you're already on a call.
- Snapshots are JSON. Fine at this scale; a binary encoding is the obvious
  optimisation if it ever needs to support far more players per room.
