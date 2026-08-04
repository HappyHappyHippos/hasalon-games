/**
 * Short-lived ICE configuration for authenticated room members.
 *
 * Direct STUN handles ordinary home networks. Cloudflare TURN is the reliable
 * path through carrier-grade NAT and restrictive Wi-Fi; its long-lived API
 * token never leaves this process. Anonymous public TURN relays are deliberately
 * not used: they have no availability promise and made a broken deployment look
 * intermittently healthy.
 */

export interface IceConfig {
  iceServers: RTCIceServerLike[];
  provider: 'cloudflare' | 'stun-only';
  expiresAt: number | null;
}
/** Structural copy of the DOM type, which the Node package does not include. */
export interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const STUN_ONLY_ICE: RTCIceServerLike[] = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
];

/** Longer than a normal family game, short enough to limit a leaked credential. */
export const CREDENTIAL_TTL_SECONDS = 8 * 60 * 60;
const FETCH_TIMEOUT_MS = 4_000;

type FetchLike = typeof fetch;
type IceEnvironment = {
  CF_TURN_KEY_ID?: string;
  CF_TURN_KEY_TOKEN?: string;
};

export async function getIceConfig(
  now = Date.now(),
  fetchImpl: FetchLike = fetch,
  environment: IceEnvironment = process.env,
): Promise<IceConfig> {
  const keyId = environment.CF_TURN_KEY_ID;
  const token = environment.CF_TURN_KEY_TOKEN;
  if (!keyId || !token) return fallback();

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
        signal: abort.signal,
      },
    );
    if (!response.ok) {
      console.warn(`[mg] cloudflare turn: HTTP ${response.status}; using STUN only`);
      return fallback();
    }

    const body = (await response.json()) as { iceServers?: unknown };
    const raw = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
    const servers = raw.filter(isIceServer);
    if (!servers.some(hasTurnUrl)) {
      console.warn('[mg] cloudflare turn: response had no valid TURN server; using STUN only');
      return fallback();
    }
    return {
      iceServers: [...STUN_ONLY_ICE, ...servers],
      provider: 'cloudflare',
      expiresAt: now + CREDENTIAL_TTL_SECONDS * 1_000,
    };
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'request failed';
    console.warn(`[mg] cloudflare turn: ${reason}; using STUN only`);
    return fallback();
  } finally {
    clearTimeout(timer);
  }
}

function fallback(): IceConfig {
  return { iceServers: STUN_ONLY_ICE, provider: 'stun-only', expiresAt: null };
}

function isIceServer(value: unknown): value is RTCIceServerLike {
  if (!value || typeof value !== 'object') return false;
  const item = value as { urls?: unknown; username?: unknown; credential?: unknown };
  const urls = typeof item.urls === 'string' ? [item.urls] : item.urls;
  if (!Array.isArray(urls) || urls.length === 0 || urls.some((url) => typeof url !== 'string')) {
    return false;
  }
  if (urls.some((url) => /^turns?:/i.test(url))) {
    return typeof item.username === 'string' && typeof item.credential === 'string';
  }
  return true;
}

function hasTurnUrl(server: RTCIceServerLike): boolean {
  const urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
  return urls.some((url) => /^turns?:/i.test(url));
}
