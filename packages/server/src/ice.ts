/**
 * ICE configuration for voice chat, served to clients over plain HTTP.
 *
 * ## Why this exists at all
 *
 * The voice mesh used to ship a hardcoded list of public STUN servers. STUN is
 * enough for two home routers to find each other, and nothing else: a player
 * behind carrier-grade NAT — the norm on Israeli mobile networks, and this game
 * does get played phone-only — has no route a STUN candidate can describe. Those
 * peers connected to nobody while everyone on wifi was fine.
 *
 * The fix is a TURN relay, and the reason it lives server-side is that a decent
 * TURN service wants credentials, and credentials must not be baked into a
 * public JavaScript bundle.
 *
 * ## Cloudflare, and why it is free
 *
 * Cloudflare Realtime mints short-lived TURN credentials from a long-lived key.
 * The free allowance is 1000 GB of relayed traffic a month; a voice stream is
 * about 40 kbps, so a full eight-player room relaying *every* leg — which never
 * happens, TURN is the last resort — would need roughly a thousand hours of
 * continuous play to reach it. It is also anycast, so the relay a player in
 * Israel gets is in Israel rather than wherever we happen to host.
 *
 * Set `CF_TURN_KEY_ID` and `CF_TURN_KEY_TOKEN` to enable it.
 *
 * ## It never fails
 *
 * Missing credentials, a non-200, a timeout, garbage JSON — every path returns
 * {@link FALLBACK_ICE} rather than throwing. That list is public STUN *plus* the
 * Open Relay Project's free TURN servers, which need no signup. So this is an
 * improvement over the old behaviour the moment it merges, with nothing
 * configured, and a bigger one once the key exists.
 *
 * Note the fallback relays are reached on TCP and TLS **port 443**. That is
 * deliberate and it is most of their value: a network that blocks outbound UDP
 * to strange ports — hotel wifi, corporate guest networks, some mobile carriers
 * — cannot tell a TURN/TLS connection on 443 from an ordinary HTTPS one.
 */

export interface IceConfig {
  iceServers: RTCIceServerLike[];
}

/** Structural copy of the DOM's `RTCIceServer`, which node has no types for. */
export interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * What every failure path returns, and what an unconfigured deployment serves.
 *
 * The Open Relay credentials are not secret — they are published as the point of
 * the project. Treat them as best-effort: no SLA, and if the service goes away
 * this degrades to the STUN-only behaviour we started with rather than breaking.
 */
export const FALLBACK_ICE: RTCIceServerLike[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  {
    urls: [
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

/**
 * Credentials are minted with a 24 h TTL and cached for half of it.
 *
 * Half-life rather than the full term because the cached copy is handed to a
 * client that then holds it for the length of a session — refreshing at 23 h
 * would occasionally issue a credential with a minute left on it.
 */
const CACHE_MS = 12 * 60 * 60 * 1000;
const CREDENTIAL_TTL_SECONDS = 24 * 60 * 60;
/** Voice is optional; nobody should wait on a slow third party to get it. */
const FETCH_TIMEOUT_MS = 4000;

let cached: { config: IceConfig; until: number } | null = null;

/** Testing seam — lets a test force the next call to re-fetch. */
export function resetIceCache(): void {
  cached = null;
}

export async function getIceConfig(now = Date.now()): Promise<IceConfig> {
  if (cached && cached.until > now) return cached.config;

  const config: IceConfig = { iceServers: await fetchCloudflareIce() };
  cached = { config, until: now + CACHE_MS };
  return config;
}

async function fetchCloudflareIce(): Promise<RTCIceServerLike[]> {
  const keyId = process.env.CF_TURN_KEY_ID;
  const token = process.env.CF_TURN_KEY_TOKEN;
  if (!keyId || !token) return FALLBACK_ICE;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
        signal: abort.signal,
      },
    );

    if (!response.ok) {
      console.warn(`[mg] cloudflare turn: HTTP ${response.status}, using fallback ICE`);
      return FALLBACK_ICE;
    }

    // The documented shape is a single `iceServers` object, but an array is the
    // more natural reading of the name and costs one line to accept.
    const body = (await response.json()) as { iceServers?: RTCIceServerLike | RTCIceServerLike[] };
    const servers = body.iceServers
      ? Array.isArray(body.iceServers)
        ? body.iceServers
        : [body.iceServers]
      : [];
    if (servers.length === 0) {
      console.warn('[mg] cloudflare turn: empty iceServers, using fallback ICE');
      return FALLBACK_ICE;
    }

    // Keep the public STUN entries alongside the relay. A host or server-reflexive
    // candidate is always preferable when one works, and ICE will pick it — the
    // relay is there for the pairs where nothing else does.
    return [FALLBACK_ICE[0]!, ...servers];
  } catch (error) {
    console.warn('[mg] cloudflare turn: request failed, using fallback ICE', error);
    return FALLBACK_ICE;
  } finally {
    clearTimeout(timer);
  }
}
