# Usage logging

Who plays, when, which games hold them, and what breaks — with no third-party
analytics, no cookies, no tracking script, and nothing that ties this site to the
host it happens to be running on today.

## Using it

Open **`/admin`**. That is the whole interface.

```
https://hasalon-games-production.up.railway.app/admin?key=YOUR_ADMIN_TOKEN
```

The page aggregates the log live on every request — nothing is precomputed — and
covers 7, 30 or 90 days. `raw ↓` in the corner downloads every event as NDJSON,
which is the escape hatch: if the page ever stops answering the question, the
whole history is one `curl` away from `jq` or a spreadsheet.

```bash
curl -s "$SITE/admin/events.ndjson?key=$ADMIN_TOKEN" > events.ndjson
```

Locally, `npm run dev` and then <http://localhost:3000/admin> — no token needed
outside production.

### Reading the page

| Panel | The question it answers |
|---|---|
| visitors / players | How many browsers opened the site, and how many of those actually sat down |
| bounce | Share who looked and left without joining a room |
| room length / matches each | Whether an evening is one game or a whole session |
| by day / by hour | When people actually play, in **Israel time** |
| games | Which games get picked, which get finished, which get abandoned |
| people | Who is playing, and when they were last here |
| what is going wrong | Server errors, browser crashes, dropped connections, real-world lag |

Two columns in the games table are worth knowing how to read:

- **picked vs played** — a game picked far more often than it is played is one
  whose box art is selling something the game itself does not.
- **finished** — the share of matches that reached a real conclusion instead of
  being restarted, skipped, quit or ended by the room emptying out. A low number
  is the clearest "this one is not working" signal in the log.

## The design, in one rule

**The server is the only writer.** It already sees who joined, which game was
picked, how long the match ran and how it ended, so the client never reports any
of that — two writers of the same fact is how a log starts contradicting itself.

The client reports exactly four things, and only because the server cannot
observe them:

| From the browser | Why the server cannot know it |
|---|---|
| `hello` | Device shape, app language, PWA mode, whether they followed an invite link |
| `crash` | An uncaught error in someone's browser |
| `net` | Round-trip time is measured client-side against the server clock |
| `ui` | Three taps that send no other message: invite, options menu, fullscreen |

Nothing is on a timer. `hello` is one frame per connection, `net` is one per
match, and the rest fire on something that already happened.

## Events

One line of NDJSON each, flat, newest last. Every row has `t` (ISO, UTC) and `e`.

| `e` | Fields | Written when |
|---|---|---|
| `visit` | `visitor` `device` `browser` `os` `lang` `touch` `standalone` `controls` `entry` `screen` | A browser opens a socket and introduces itself |
| `leave` | `ms` `rooms` | That socket closes. `rooms: 0` is a bounce |
| `join` | `room` `name` `size` `host` | Somebody takes a seat. `host: true` means they created it |
| `part` | `room` `name` `why` | They leave for good — `left`, `kicked`, `gone`, `closed` |
| `back` | `room` `name` `gap` `mid` | A dropped player reconnects, after `gap` ms away |
| `room_close` | `room` `ms` `peak` `people` `matches` `games` | The room is torn down. One row per evening |
| `pick` | `room` `game` | The host selects a different game in the lobby |
| `match_open` | `room` `game` `players` `names` `series` `cfg` | A match starts |
| `match_close` | `room` `game` `why` `ms` `players` `winner` `pauses` | It stops — see below |
| `series_open` | `room` `legs` `pace` `pool` `players` | A roulette run is drawn |
| `error` | `code` `room` | Any error the server sends anyone |
| `crash` | `msg` `at` `browser` `os` `room` `game` | An uncaught error in a browser |
| `net` | `rtt` `p90` `delay` `room` `game` `name` | One player's connection across one match |
| `ui` | `what` `room` `game` `name` | `invite`, `menu` or `fullscreen` |

`match_close.why` is the one worth memorising, because everything except
`finished` is a match that did not go the distance:

| `why` | What happened |
|---|---|
| `finished` | Ran to a real conclusion with a winner |
| `short` | The room dropped below the game's minimum players |
| `restart` | The host restarted, or a series leg replaced it |
| `skipped` | The host abandoned a roulette leg |
| `quit` | "End match" — everyone back to the lobby |
| `closed` | The room was torn down with a match still running |

### What is deliberately not logged

No IP addresses, no raw User-Agent strings (only a coarse browser/OS family), no
message contents, no chat, no drawings, no captions, no guesses. `visitor` is a
random id in `localStorage` that identifies a **browser**, never a person, and
never leaves this server. Names are logged, because "who is playing" is the
question — they are the same names shown to everyone in the lobby.

The dashboard is `noindex`, `no-store`, and 404s without the token.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `ADMIN_TOKEN` | — | Required for `/admin` in production. Unset ⇒ the page 404s (and is open in dev) |
| `ANALYTICS_FILE` | `data/events.ndjson` | Where the durable log lives. `off` disables it |
| `ANALYTICS_DAYS` | `90` | Retention. Older rows are dropped at boot and every 6 h |
| `ANALYTICS_TZ` | `Asia/Jerusalem` | Which day and hour a timestamp falls in |

### Sinks — three, each answering a different question

1. **stdout**, one JSON line per event. The *stream*, and the portability
   guarantee: Railway, CloudWatch, Cloud Logging, Loki and `docker logs` all
   collect it with no configuration and no SDK. Analytics lines are bare JSON;
   everything else the server says is prefixed `[mg]`, so they separate with
   `grep '^{'`.
2. **a file**, at `ANALYTICS_FILE`. The *store*, so the dashboard survives a
   restart — which on Railway is every deploy and every wake from sleep.
3. **memory**. The *read model*: the dashboard aggregates from here and nowhere
   else, so there is one query path whether or not a file is configured. The
   file's only job is to refill it at boot.

### Making it survive a redeploy

The default path is inside the container and therefore ephemeral, which matches
the rest of this server — rooms are in memory too. stdout still has everything,
but the dashboard restarts empty. To keep it:

- **Railway** — add a volume mounted at `/app/data`. Nothing else changes.
- **AWS** (ECS/Fargate) — an EFS access point at `/app/data`, or set
  `ANALYTICS_FILE` to a path on an EBS-backed instance.
- **Google Cloud Run** — the filesystem is in-memory, so set `ANALYTICS_FILE=off`
  and read events out of Cloud Logging, which already has every line.
- **A box in Israel** ([`deploy/README.md`](../deploy/README.md)) — it is just a
  path on disk; nothing to do.

Nothing in this feature knows what it is running on. There is no SDK, no vendor
client and no outbound request — moving host changes one environment variable at
most.

## Adding an event

1. Add the name to `AnalyticsEventName` in
   [`packages/shared/src/analytics.ts`](../packages/shared/src/analytics.ts).
2. Record it with `analytics.record('name', { … })` from wherever the server
   observes it — usually `Room.ts`.
3. Count it in `summarize` and show it in `renderDashboard`.
4. Add a row to the table above.

Before doing any of that, check the server does not already know. It usually
does, and the best version of this log is the smallest one that answers the
question.

If the fact genuinely lives only in the browser, it goes through `ClientReport`
— a closed union, validated server-side, because the socket it arrives on is no
more trusted than any other.
