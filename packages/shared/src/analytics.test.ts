import { describe, expect, it } from 'vitest';
import { parseClientHello, parseClientReport } from './analytics';

/**
 * These two parsers are the only place the usage log touches the wire, so they
 * are held to the same standard as the rest of the protocol: nothing off a
 * socket is trusted, and a client that lies produces a defaulted row rather than
 * a poisoned dashboard.
 */

describe('parseClientHello', () => {
  const good = {
    visitor: 'abc-123',
    lang: 'en',
    device: 'phone',
    touch: true,
    standalone: true,
    controls: 'on',
    entry: 'link',
    screen: '390x844',
  };

  it('keeps a well-formed hello intact', () => {
    expect(parseClientHello(good)).toEqual(good);
  });

  it('rejects anything without a visitor id', () => {
    expect(parseClientHello({ ...good, visitor: '' })).toBeNull();
    expect(parseClientHello({ ...good, visitor: 42 })).toBeNull();
    expect(parseClientHello(null)).toBeNull();
    expect(parseClientHello('hello')).toBeNull();
  });

  it('defaults every field it does not recognise', () => {
    const parsed = parseClientHello({ visitor: 'v' });
    expect(parsed).toEqual({
      visitor: 'v',
      lang: 'he',
      device: 'desktop',
      touch: false,
      standalone: false,
      controls: 'auto',
      entry: 'direct',
      screen: '',
    });
  });

  it('refuses a screen size that is not two numbers', () => {
    // Otherwise this lands in the dashboard's device table verbatim.
    expect(parseClientHello({ ...good, screen: '<script>' })?.screen).toBe('');
    expect(parseClientHello({ ...good, screen: '390x844x2' })?.screen).toBe('');
  });

  it('caps the visitor id rather than storing whatever arrived', () => {
    const parsed = parseClientHello({ ...good, visitor: 'x'.repeat(500) });
    expect(parsed?.visitor.length).toBe(64);
  });
});

describe('parseClientReport', () => {
  it('accepts the three known reports', () => {
    expect(parseClientReport({ e: 'crash', msg: 'boom', at: 'app.js:3' })).toEqual({
      e: 'crash',
      msg: 'boom',
      at: 'app.js:3',
    });
    expect(parseClientReport({ e: 'net', rtt: 40, p90: 310, delay: 90 })).toEqual({
      e: 'net',
      rtt: 40,
      p90: 310,
      delay: 90,
    });
    expect(parseClientReport({ e: 'ui', what: 'invite' })).toEqual({ e: 'ui', what: 'invite' });
  });

  it('rejects an unknown event name or ui action', () => {
    expect(parseClientReport({ e: 'match_open', game: 'worms' })).toBeNull();
    expect(parseClientReport({ e: 'ui', what: 'something-else' })).toBeNull();
    expect(parseClientReport({})).toBeNull();
  });

  it('clamps timings so one bad number cannot skew a chart', () => {
    const parsed = parseClientReport({ e: 'net', rtt: -5, p90: 1e9, delay: Number.NaN });
    expect(parsed).toEqual({ e: 'net', rtt: 0, p90: 60_000, delay: 0 });
  });

  it('keeps an empty crash message as a countable unknown', () => {
    // Safari's cross-origin placeholder arrives with nothing in it. The count
    // still says a script failed, which is more than we would otherwise know.
    expect(parseClientReport({ e: 'crash' })).toEqual({ e: 'crash', msg: 'unknown', at: '' });
  });

  it('truncates a long stack rather than letting it into the log whole', () => {
    const parsed = parseClientReport({ e: 'crash', msg: 'x'.repeat(9000), at: '' });
    expect(parsed).toMatchObject({ e: 'crash' });
    expect((parsed as { msg: string }).msg.length).toBe(300);
  });
});
