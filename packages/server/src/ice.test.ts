import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { CREDENTIAL_TTL_SECONDS, STUN_ONLY_ICE, getIceConfig } from './ice';

const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

afterEach(() => {
  warn.mockClear();
});
afterAll(() => {
  warn.mockRestore();
});

function response(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

/** TURN is the difference between a convenient feature and one that works on cellular. */
describe('Cloudflare ICE configuration', () => {
  it('falls back honestly to STUN when credentials are absent', async () => {
    await expect(getIceConfig(1, response({}), {})).resolves.toEqual({
      iceServers: STUN_ONLY_ICE,
      provider: 'stun-only',
      expiresAt: null,
    });
  });

  it('accepts a valid TURN response and never sends the long-lived token to a client', async () => {
    const fetchImpl = response({
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        {
          urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443'],
          username: 'short-user',
          credential: 'short-secret',
        },
      ],
    });
    const config = await getIceConfig(10_000, fetchImpl, {
      CF_TURN_KEY_ID: 'key-id',
      CF_TURN_KEY_TOKEN: 'long-lived-secret',
    });

    expect(config.provider).toBe('cloudflare');
    expect(config.expiresAt).toBe(10_000 + CREDENTIAL_TTL_SECONDS * 1_000);
    expect(config.iceServers.some((server) => JSON.stringify(server).includes('turn.cloudflare.com'))).toBe(true);
    expect(JSON.stringify(config)).not.toContain('long-lived-secret');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/key-id/credentials/generate-ice-servers'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer long-lived-secret' }),
        body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
      }),
    );
  });

  it('rejects malformed or credential-free TURN entries instead of advertising a fake relay', async () => {
    const config = await getIceConfig(
      1,
      response({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478'] }] }),
      { CF_TURN_KEY_ID: 'key', CF_TURN_KEY_TOKEN: 'secret' },
    );
    expect(config).toMatchObject({ provider: 'stun-only', iceServers: STUN_ONLY_ICE });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0])).not.toContain('secret');
  });

  it('turns upstream failures into a visible STUN-only state without throwing', async () => {
    const config = await getIceConfig(1, response({}, 503), {
      CF_TURN_KEY_ID: 'key',
      CF_TURN_KEY_TOKEN: 'secret',
    });
    expect(config.provider).toBe('stun-only');
    expect(config.expiresAt).toBeNull();
  });

  it('bounds a hung credential request instead of holding voice startup forever', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    ) as unknown as typeof fetch;
    const pending = getIceConfig(1, fetchImpl, {
      CF_TURN_KEY_ID: 'key',
      CF_TURN_KEY_TOKEN: 'secret',
    });
    await vi.advanceTimersByTimeAsync(4_000);
    await expect(pending).resolves.toMatchObject({ provider: 'stun-only', expiresAt: null });
    vi.useRealTimers();
  });
});
