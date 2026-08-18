import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent, Identity } from '@mg/shared';
import { Analytics, analytics } from './Analytics';
import { Client } from './Client';
import { Room } from './Room';
import { RoomManager } from './RoomManager';
import { EMPTY_ROOM_TTL_MS } from './roster';
import { summarize } from './summary';
import { renderDashboard } from './dashboard';

const DAY_MS = 86_400_000;

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'mg-analytics-')), 'events.ndjson');
}

const temps: string[] = [];
function scratch(): string {
  const file = tempFile();
  temps.push(file);
  return file;
}

afterEach(() => {
  while (temps.length) rmSync(join(temps.pop()!, '..'), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The recorder
// ---------------------------------------------------------------------------

describe('Analytics', () => {
  it('records events in order and hands them back', () => {
    const log = new Analytics();
    log.configure({ file: null });

    log.record('visit', { visitor: 'v1', device: 'phone' });
    log.record('join', { room: 'ABCD', name: 'Ohad' });

    expect(log.all().map((event) => event.e)).toEqual(['visit', 'join']);
    expect(log.all()[0]).toMatchObject({ e: 'visit', visitor: 'v1', device: 'phone' });
    expect(typeof log.all()[0]!.t).toBe('string');
  });

  it('drops empty fields so a row carries only what happened', () => {
    const log = new Analytics();
    log.configure({ file: null });
    log.record('match_close', { room: 'ABCD', winner: undefined, pauses: undefined, ms: 1000 });

    expect(Object.keys(log.all()[0]!).sort()).toEqual(['e', 'ms', 'room', 't']);
  });

  it('cannot have its name or timestamp overwritten by a field bag', () => {
    const log = new Analytics();
    log.configure({ file: null });
    log.record('join', { e: 'match_open', t: 'not-a-time' } as Record<string, unknown>);

    expect(log.all()[0]!.e).toBe('join');
    expect(log.all()[0]!.t).not.toBe('not-a-time');
  });

  it('starts recording again after the clock steps backwards', () => {
    // The rate limiter rolls its window on `Date.now()`, which is not
    // monotonic — an NTP correction stepping it back is the whole reason
    // `serverClock.ts` exists. Rolling only on `>= 1000` left the difference
    // permanently negative after such a step, so the window never rolled, the
    // count stayed above the cap, and the usage log went quiet for good.
    const log = new Analytics();
    log.configure({ file: null });

    const start = Date.now();
    const now = vi.spyOn(Date, 'now');
    try {
      // Fill the window, then step the clock back a minute.
      now.mockReturnValue(start);
      for (let i = 0; i < 60; i += 1) log.record('ui', { what: 'tap' });
      const filled = log.all().length;

      now.mockReturnValue(start - 60_000);
      log.record('join', { room: 'ABCD', name: 'Ohad' });

      expect(log.all().length).toBe(filled + 1);
      expect(log.all().at(-1)).toMatchObject({ e: 'join' });
    } finally {
      now.mockRestore();
    }
  });

  it('survives a file it cannot write to', () => {
    // It complains on the way past, which is the point — but the complaint is
    // the assertion here, not test output.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = new Analytics();
    // A path whose parent is a file, not a directory.
    const file = scratch();
    writeFileSync(file, '');
    log.configure({ file: join(file, 'nested', 'events.ndjson') });

    expect(() => log.record('visit', { visitor: 'v' })).not.toThrow();
    // The in-memory read model still works, so the dashboard is not lost too.
    expect(log.all()).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rate limits so one misbehaving socket cannot flood the log', () => {
    const log = new Analytics();
    log.configure({ file: null });
    for (let i = 0; i < 500; i++) log.record('error', { code: 'BAD_MESSAGE' });

    expect(log.all().length).toBeLessThanOrEqual(50);
  });

  describe('durability', () => {
    it('writes NDJSON and reads it back on the next boot', () => {
      const file = scratch();

      const first = new Analytics();
      first.configure({ file });
      first.record('visit', { visitor: 'v1' });
      first.record('join', { room: 'ABCD', name: 'Ohad' });

      const lines = readFileSync(file, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toMatchObject({ e: 'visit', visitor: 'v1' });

      const second = new Analytics();
      second.configure({ file });
      expect(second.all().map((event) => event.e)).toEqual(['visit', 'join']);
    });

    it('drops events past the retention window and rewrites the file', () => {
      const file = scratch();
      const old = new Date(Date.now() - 40 * DAY_MS).toISOString();
      const fresh = new Date().toISOString();
      writeFileSync(
        file,
        `${JSON.stringify({ t: old, e: 'visit', visitor: 'gone' })}\n` +
          `${JSON.stringify({ t: fresh, e: 'visit', visitor: 'kept' })}\n`,
      );

      const log = new Analytics();
      log.configure({ file, retentionDays: 30 });

      expect(log.all()).toHaveLength(1);
      expect(log.all()[0]).toMatchObject({ visitor: 'kept' });
      expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(1);
    });

    it('skips a truncated line rather than refusing to boot', () => {
      // Exactly what a container killed mid-write leaves behind.
      const file = scratch();
      writeFileSync(
        file,
        `${JSON.stringify({ t: new Date().toISOString(), e: 'visit' })}\n{"t":"2026-0`,
      );

      const log = new Analytics();
      log.configure({ file });
      expect(log.all()).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// The aggregation
// ---------------------------------------------------------------------------

/** An event `minutesAgo` in the past, so the window arithmetic is exercised. */
function at(minutesAgo: number, event: Partial<AnalyticsEvent> & { e: AnalyticsEvent['e'] }): AnalyticsEvent {
  return { t: new Date(Date.now() - minutesAgo * 60_000).toISOString(), ...event } as AnalyticsEvent;
}

describe('summarize', () => {
  it('counts people by browser, not by page load', () => {
    const summary = summarize([
      at(10, { e: 'visit', visitor: 'a' }),
      at(9, { e: 'visit', visitor: 'a' }),
      at(8, { e: 'visit', visitor: 'b' }),
    ]);

    expect(summary.totals.visits).toBe(3);
    expect(summary.totals.visitors).toBe(2);
  });

  it('only calls a visitor new when they were never seen before the window', () => {
    const summary = summarize(
      [
        at(60 * 24 * 40, { e: 'visit', visitor: 'regular' }),
        at(10, { e: 'visit', visitor: 'regular' }),
        at(10, { e: 'visit', visitor: 'stranger' }),
      ],
      { days: 30 },
    );

    expect(summary.totals.visitors).toBe(2);
    expect(summary.totals.newVisitors).toBe(1);
  });

  it('measures bounce from visits that never reached a room', () => {
    const summary = summarize([
      at(10, { e: 'leave', ms: 4000, rooms: 0 }),
      at(9, { e: 'leave', ms: 900_000, rooms: 1 }),
    ]);

    expect(summary.totals.bounce).toBe(0.5);
  });

  it('separates a game being picked from a game being played', () => {
    const summary = summarize([
      at(20, { e: 'pick', room: 'AAAA', game: 'worms' }),
      at(19, { e: 'pick', room: 'AAAA', game: 'gunmayhem' }),
      at(18, { e: 'match_open', room: 'AAAA', game: 'gunmayhem', players: 4 }),
      at(10, { e: 'match_close', room: 'AAAA', game: 'gunmayhem', why: 'finished', ms: 480_000 }),
    ]);

    const worms = summary.games.find((row) => row.id === 'worms')!;
    const gunmayhem = summary.games.find((row) => row.id === 'gunmayhem')!;

    // Looked at and passed over: the signal a box art is selling something the
    // game does not deliver.
    expect(worms).toMatchObject({ picks: 1, plays: 0 });
    expect(gunmayhem).toMatchObject({ picks: 1, plays: 1, finished: 1, abandoned: 0 });
    expect(gunmayhem.avgMinutes).toBe(8);
    expect(gunmayhem.avgPlayers).toBe(4);
  });

  it('counts every way a match stops short as abandoned', () => {
    const summary = summarize([
      at(30, { e: 'match_close', game: 'tanks', why: 'finished', ms: 60_000 }),
      at(29, { e: 'match_close', game: 'tanks', why: 'short', ms: 10_000 }),
      at(28, { e: 'match_close', game: 'tanks', why: 'quit', ms: 20_000 }),
      at(27, { e: 'match_close', game: 'tanks', why: 'skipped', ms: 5_000 }),
    ]);

    expect(summary.games[0]).toMatchObject({ finished: 1, abandoned: 3 });
  });

  it('tells a connection that never came back from one that did', () => {
    const summary = summarize([
      at(10, { e: 'back', room: 'AAAA', name: 'Ohad', gap: 3200 }),
      at(9, { e: 'part', room: 'AAAA', name: 'Yoni', why: 'gone' }),
      at(8, { e: 'part', room: 'AAAA', name: 'Dana', why: 'left' }),
    ]);

    expect(summary.problems.reconnects).toBe(1);
    expect(summary.problems.lost).toBe(1);
  });

  it('reports the worst case, not the average, for connection quality', () => {
    const summary = summarize([
      at(10, { e: 'net', game: 'gunmayhem', rtt: 40, p90: 90, delay: 80 }),
      at(9, { e: 'net', game: 'gunmayhem', rtt: 45, p90: 600, delay: 200 }),
      at(8, { e: 'net', game: 'gunmayhem', rtt: 50, p90: 700, delay: 210 }),
    ]);

    expect(summary.problems.p90).toBe(600);
    // Two of the three matches were past a quarter second at the 90th.
    expect(summary.problems.roughShare).toBeCloseTo(2 / 3);
  });

  it('groups crashes by message with a count and a last-seen', () => {
    const summary = summarize([
      at(30, { e: 'crash', msg: 'x is not a function', at: 'a.js:1' }),
      at(10, { e: 'crash', msg: 'x is not a function', at: 'a.js:1' }),
      at(5, { e: 'crash', msg: 'other', at: 'b.js:2' }),
    ]);

    expect(summary.problems.crashes[0]).toMatchObject({ msg: 'x is not a function', count: 2 });
    expect(summary.problems.crashes).toHaveLength(2);
  });

  it('ignores everything outside the window', () => {
    const summary = summarize(
      [at(60 * 24 * 10, { e: 'visit', visitor: 'old' }), at(10, { e: 'visit', visitor: 'new' })],
      { days: 7 },
    );

    expect(summary.totals.visits).toBe(1);
  });

  it('keeps the days nobody played, because the gaps are the information', () => {
    const summary = summarize([at(10, { e: 'visit', visitor: 'a' })], { days: 7 });

    expect(summary.daily).toHaveLength(8);
    expect(summary.daily.filter((row) => row.visits > 0)).toHaveLength(1);
  });

  it('buckets hours in the players local time, not UTC', () => {
    // 21:30 UTC is half past midnight in Jerusalem — a different day, and the
    // whole reason the bucketing is not `getUTCHours`.
    const evening = new Date('2026-06-15T21:30:00Z').toISOString();
    const summary = summarize([{ t: evening, e: 'match_open', game: 'worms' } as AnalyticsEvent], {
      now: new Date('2026-06-16T12:00:00Z').getTime(),
      timeZone: 'Asia/Jerusalem',
    });

    expect(summary.hours[0]).toBe(1);
    expect(summary.hours[21]).toBe(0);
  });

  it('says it does not know rather than saying zero', () => {
    // A room that is still open tonight has played the matches it has played;
    // waiting for it to be swept before counting them would blank the number
    // exactly when somebody is looking at it.
    const summary = summarize([
      at(20, { e: 'join', room: 'AAAA', name: 'Ohad' }),
      at(19, { e: 'match_open', room: 'AAAA', game: 'worms', players: 2 }),
      at(18, { e: 'match_open', room: 'AAAA', game: 'worms', players: 2 }),
    ]);

    expect(summary.totals.matchesPerRoom).toBe(2);
    // Nothing has closed, so the length of an evening is genuinely unknown —
    // and 0 would read as "people open rooms and leave immediately".
    expect(summary.totals.medianRoomMinutes).toBeNull();
    expect(renderDashboard(summary, '')).toContain('—');
  });

  it('survives an empty log', () => {
    const summary = summarize([]);
    expect(summary.totals.visitors).toBe(0);
    expect(summary.totals.matchesPerRoom).toBeNull();
    expect(summary.games).toEqual([]);
    expect(() => renderDashboard(summary, '')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The dashboard
// ---------------------------------------------------------------------------

describe('renderDashboard', () => {
  it('escapes names and crash text, which are typed by other people', () => {
    const summary = summarize([
      at(10, { e: 'join', room: 'AAAA', name: '<img src=x onerror=alert(1)>' }),
      at(9, { e: 'crash', msg: '</script><script>alert(2)</script>', at: '' }),
    ]);
    const html = renderDashboard(summary, '');

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(2)');
    expect(html).toContain('&lt;img src=x');
  });

  it('carries the access key through its own links', () => {
    const html = renderDashboard(summarize([]), 'key=secret');
    expect(html).toContain('?key=secret&amp;days=7');
    expect(html).toContain('events.ndjson?key=secret');
  });
});

// ---------------------------------------------------------------------------
// What a real room actually writes
// ---------------------------------------------------------------------------

function identity(name: string, colorIndex: number): Identity {
  return { name, colorIndex, hat: 0, face: 0 };
}

function fakeClient(): Client {
  const socket = {
    OPEN: 1,
    readyState: 1,
    send() {},
    close() {},
    terminate() {},
  };
  return new Client(socket as never, { openedAt: 0, userAgent: '' });
}

/** Collect what the singleton records while `run` executes. */
function captured(run: () => void): AnalyticsEvent[] {
  const seen: AnalyticsEvent[] = [];
  const stop = analytics.subscribe((event) => seen.push(event));
  try {
    run();
  } finally {
    stop();
  }
  return seen;
}

describe('Room writes the lifecycle it alone can see', () => {
  it('logs a join, a pick, a match and a room summary', () => {
    const room = new Room('TEST');
    const events = captured(() => {
      const host = room.addPlayer(fakeClient(), identity('Ohad', 0))!;
      const guest = room.addPlayer(fakeClient(), identity('Yoni', 1))!;
      room.setGame('tanks');
      room.setReady(host, true);
      room.setReady(guest, true);
      room.start();
      room.rematch();
      room.dispose();
    });

    expect(events.map((event) => event.e)).toEqual([
      'join',
      'join',
      'pick',
      'match_open',
      'match_close',
      'room_close',
    ]);

    // Creating a room and joining one are the same event, told apart by `host`.
    expect(events[0]).toMatchObject({ e: 'join', name: 'Ohad', host: true, size: 1 });
    expect(events[1]).toMatchObject({ e: 'join', name: 'Yoni', size: 2 });
    expect(events[1]!.host).toBeUndefined();

    expect(events[3]).toMatchObject({ e: 'match_open', game: 'tanks', players: 2 });
    expect(events[3]!.names).toEqual(['Ohad', 'Yoni']);
    // The host's configuration rides along, so "nobody ever changes the stage"
    // is answerable.
    expect(events[3]!.cfg).toMatchObject({ game: 'tanks' });

    // Ending the match from the options menu is not the same as finishing it.
    expect(events[4]).toMatchObject({ e: 'match_close', why: 'quit', game: 'tanks' });

    expect(events[5]).toMatchObject({ e: 'room_close', peak: 2, matches: 1 });
    expect(events[5]!.people).toEqual(['Ohad', 'Yoni']);
    expect(events[5]!.games).toEqual(['tanks']);
  });

  it('does not log a pick for re-selecting the game already selected', () => {
    const room = new Room('TEST');
    const events = captured(() => {
      room.setGame('worms');
      room.setGame('worms');
      room.setGame('achtung');
    });

    expect(events.filter((event) => event.e === 'pick')).toHaveLength(2);
  });

  it('closes the running match when a restart begins the next one', () => {
    const room = new Room('TEST');
    const events = captured(() => {
      const host = room.addPlayer(fakeClient(), identity('Ohad', 0))!;
      const guest = room.addPlayer(fakeClient(), identity('Yoni', 1))!;
      room.setReady(host, true);
      room.setReady(guest, true);
      room.start();
      room.restart();
      room.dispose();
    });

    const matches = events.filter((event) => event.e === 'match_open' || event.e === 'match_close');
    // Without this the first match would simply never have been written down.
    expect(matches.map((event) => `${event.e}:${event.why ?? ''}`)).toEqual([
      'match_open:',
      'match_close:restart',
      'match_open:',
      'match_close:closed',
    ]);
  });

  it('reports how many played, not how many were left when it ended', () => {
    const room = new Room('TEST');
    const events = captured(() => {
      const host = room.addPlayer(fakeClient(), identity('Ohad', 0))!;
      const guest = room.addPlayer(fakeClient(), identity('Yoni', 1))!;
      room.setReady(host, true);
      room.setReady(guest, true);
      room.start();
      // Dropping below the minimum ends the match — but `removePlayer` splices
      // the leaver out first, so counting seats at close would say "1 player".
      room.removePlayer(guest.id);
    });

    const close = events.find((event) => event.e === 'match_close')!;
    expect(close).toMatchObject({ why: 'short', players: 2 });
    expect(close.winner).toBeUndefined();
  });

  it('tells a player who was thrown out from one whose connection died', () => {
    const room = new Room('TEST');
    const events = captured(() => {
      room.addPlayer(fakeClient(), identity('Host', 0));
      const kicked = room.addPlayer(fakeClient(), identity('Kicked', 1))!;
      const dropped = room.addPlayer(fakeClient(), identity('Dropped', 2))!;

      room.kick(kicked.id);
      dropped.client = null;
      dropped.disconnectedAt = Date.now() - 120_000;
      room.reapDisconnected(Date.now());
    });

    const parts = events.filter((event) => event.e === 'part');
    expect(parts).toMatchObject([
      { name: 'Kicked', why: 'kicked' },
      { name: 'Dropped', why: 'gone' },
    ]);
  });

  it('logs a reconnect with how long they were away', () => {
    const room = new Room('TEST');
    const events = captured(() => {
      const player = room.addPlayer(fakeClient(), identity('Ohad', 0))!;
      player.client = null;
      player.disconnectedAt = Date.now() - 5_000;
      room.resumePlayer(fakeClient(), player.id, player.token);
    });

    const back = events.find((event) => event.e === 'back')!;
    expect(back).toMatchObject({ name: 'Ohad' });
    expect(back.gap as number).toBeGreaterThanOrEqual(5_000);
  });

  it('does not log a reconnect for a plain reload', () => {
    const room = new Room('TEST');
    const events = captured(() => {
      const player = room.addPlayer(fakeClient(), identity('Ohad', 0))!;
      // Never marked as disconnected: the old socket has not been noticed yet.
      room.resumePlayer(fakeClient(), player.id, player.token);
    });

    expect(events.some((event) => event.e === 'back')).toBe(false);
  });

  it('writes the room summary when the sweeper tears an empty room down', () => {
    // The path production actually takes: everybody closes their tab, the room
    // sits empty past its TTL, and the sweeper disposes it. Server shutdown
    // reaches the same `dispose`, but nobody's evening ends that way.
    vi.useFakeTimers();
    try {
      const manager = new RoomManager();
      const events = captured(() => {
        const room = manager.create();
        room.addPlayer(fakeClient(), identity('Ohad', 0));
        room.removePlayer(room.players[0]!.id);
        // Empty for longer than a room is kept.
        room.emptySince = Date.now() - EMPTY_ROOM_TTL_MS - 1;
        vi.advanceTimersByTime(10_000);
      });

      expect(events.filter((event) => event.e === 'room_close')).toMatchObject([
        { room: expect.any(String), peak: 1, matches: 0 },
      ]);
      manager.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('records every error the server sends, by code', () => {
    const events = captured(() => {
      const client = fakeClient();
      client.roomCode = 'ABCD';
      client.sendError('NOT_ENOUGH_PLAYERS', 'needs more');
    });

    expect(events).toMatchObject([{ e: 'error', code: 'NOT_ENOUGH_PLAYERS', room: 'ABCD' }]);
  });
});
