# Self-hosting in Israel

Why this directory exists: **every player is in Israel, and Railway has no
Middle East region.** The EU West deploy measures ~114 ms median round trip
(min 95, p95 153). A box in Israel measures ~10–20 ms.

That difference is worth more than any netcode change. Client-side prediction,
clock sync, jitter buffering and extrapolation all exist to hide distance —
they cost complexity and they cannot give the distance back. Deploying near the
players is the only thing that actually removes it.

Nothing in the app is host-specific: rooms are in memory, there is no database,
and the `Dockerfile` at the repo root builds everywhere.

## Picking a box

| Option | Region | Cost | Notes |
|---|---|---|---|
| **Oracle Cloud Always Free** | `il-jerusalem-1` | Free, permanently | Ampere ARM (2 OCPU / 12 GB since the June 2026 limit change), or the always-free AMD micro. A1.Flex capacity in Jerusalem is often exhausted — if `Out of host capacity` keeps coming back, take the AMD micro. |
| **Vultr** | Tel Aviv | ~$5/mo | The fallback when Oracle capacity does not come through. |

1 GB of RAM is ample. This is a Node process holding a handful of in-memory
rooms; the tick loop is the only real work and it is a few percent of one core
per match.

The `node:22-alpine` base image is multi-arch, so ARM and x86 both build with no
changes.

## Standing it up

Ports 80 and 443 must reach the box from the internet. On Oracle that means
**both** an ingress rule on the VCN security list *and* opening them in the
instance firewall — Oracle images ship with `iptables` rules that silently drop
everything else, which is the single most common reason a new OCI box appears
dead.

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker "$USER" && newgrp docker
```

Point your DNS A record at the box's public IP **before** starting Caddy — it
requests a certificate on boot, and a failed ACME challenge backs off before it
retries.

```bash
git clone https://github.com/HappyHappyHippos/hasalon-games.git ~/hasalon-games
```

```bash
echo "SITE_ADDRESS=play.example.com" > ~/hasalon-games/deploy/.env
```

```bash
cd ~/hasalon-games && docker compose -f deploy/docker-compose.yml up -d --build
```

## Deploying after that

`.github/workflows/deploy.yml` restores push-to-deploy: it runs typecheck and
the full test suite, then SSHes in, fast-forwards to `origin/main`, rebuilds and
restarts. It needs four repository secrets:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | the box's IP or hostname for SSH |
| `DEPLOY_USER` | the SSH user (`ubuntu` on Oracle images) |
| `DEPLOY_SSH_KEY` | a private key whose public half is in that user's `authorized_keys` |
| `DEPLOY_HOST_NAME` | the public hostname, for the post-deploy health check |

The deploy job is **skipped until you set the repository variable
`DEPLOY_ENABLED` to `true`** (Settings → Secrets and variables → Actions →
Variables). Until then every push still runs typecheck and tests, and simply
does not try to reach a box that is not there yet.

Manually, it is the same one-liner as the initial build:

```bash
cd ~/hasalon-games && git pull && docker compose -f deploy/docker-compose.yml up -d --build
```

The build runs on the box. That is slower than building in CI and pulling from a
registry, but it needs no registry, no credentials and no cross-architecture
build — and this is a party game site, not a service with a deploy budget.

## Things that will bite

**One replica, always.** Rooms are in memory with nothing shared between
processes, so a second instance means two friends who typed the same code land
on different servers and never see each other. Never pass `--scale app=`, and do
not put a second box behind a load balancer without solving room affinity first.

**Verifying a deploy with `/healthz` proves nothing about which build is
running.** It returns byte-identical JSON across every version — a previous
session spent an hour watching a stale instance answer `ok` happily. Probe the
protocol version instead, which is what `npm run smoke` does:

```bash
npm run smoke -- https://play.example.com
```

**No app sleeping here, and that is an upgrade.** Railway's `sleepApplication`
scaled to zero when idle, and every wake wiped every room code — a link shared
and left for an hour was dead. A always-on container has no such behaviour.

**Caddy needs its `caddy_data` volume.** That is where the certificate lives.
Delete it casually and you will re-request from Let's Encrypt, which is
rate-limited to a handful of failures per hour per domain.

**Keep the Railway service alive for a week** after cutting over, so there is
somewhere to point people if the new box misbehaves. Then tear it down —
`railway.json` and `fly.toml` at the repo root both become dead config once
this is the real deployment.

## Confirming it was worth it

The whole justification is the round-trip number, so measure it rather than
assuming. From a few players' homes, on different ISPs:

```bash
npm run smoke -- https://play.example.com
```

It reports min / median / p95 / jitter, plus how evenly the server is pacing
its snapshots. Expect median well under 30 ms and jitter in the low single
digits. If some ISP routes badly and comes back above ~30 ms, say so before
simplifying the client's netcode — the adaptive machinery is earning its keep
at that point.
