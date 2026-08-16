/**
 * Turning the event log into the six answers worth having.
 *
 * A pure function over the rows — no state, no I/O, no caching. It runs on
 * demand when somebody opens the dashboard, which is the reason the recorder
 * keeps no counters: a rollup maintained on write is a second copy of the truth
 * that goes stale the moment this file changes its mind about what "finished"
 * means, and re-deriving it from scratch is what makes that impossible.
 *
 * The events were designed so this is almost entirely *counting*. Nothing here
 * has to correlate a `match_open` with its `match_close` to find a duration or a
 * winner, because `match_close` carries both. That is deliberate: joins across
 * rows are where log analysis stops being readable.
 *
 * **Everything is bucketed in local time.** The people using this site are all
 * in one place and they play in the evening; an hour-of-day chart in UTC would
 * put Friday night on Saturday and be quietly wrong forever.
 */
import type { AnalyticsEvent } from '@mg/shared';

const DAY_MS = 86_400_000;

/** Where the players are. Overridable with `ANALYTICS_TZ`; see `analyticsTimeZone`. */
export const DEFAULT_TIME_ZONE = 'Asia/Jerusalem';

export interface DayRow {
  /** `YYYY-MM-DD`, local. */
  day: string;
  visits: number;
  visitors: number;
  matches: number;
  minutes: number;
}

export interface GameRow {
  id: string;
  /** Times the host selected it in the lobby. */
  picks: number;
  /** Matches actually started. */
  plays: number;
  /** Played to a real conclusion. */
  finished: number;
  /** Ended because the room fell below the minimum, or the host bailed out. */
  abandoned: number;
  avgMinutes: number;
  avgPlayers: number;
  /** Times someone opened the options menu while this game was up. See `UiAction`. */
  menu: number;
  /** Worst-case round trip reported during this game, median across reports. */
  p90: number;
}

export interface PersonRow {
  name: string;
  rooms: number;
  matches: number;
  /** ISO, local-formatted by the page. */
  last: string;
}

export interface CountRow {
  label: string;
  count: number;
}

export interface CrashRow {
  msg: string;
  at: string;
  count: number;
  last: string;
}

export interface Summary {
  days: number;
  from: string;
  to: string;
  timeZone: string;
  totals: {
    /** Sockets that said hello — one per page load. */
    visits: number;
    /** Distinct browsers. The honest answer to "how many people". */
    visitors: number;
    /** Of those, first seen inside the window. */
    newVisitors: number;
    /** Distinct names that took a seat in a room. */
    players: number;
    rooms: number;
    matches: number;
    matchMinutes: number;
    /** Share of visits that never joined a room at all, 0..1. */
    bounce: number;
    /** Median seconds a visit lasted. */
    medianVisitSeconds: number;
    /**
     * Median minutes a room stayed open — how long an evening actually is.
     *
     * Null until a room has actually closed, and the page renders that as a
     * dash. Zero would be a lie of exactly the kind a dashboard must not tell:
     * indistinguishable from "people open rooms and leave immediately".
     */
    medianRoomMinutes: number | null;
    /** Matches played per room. One means they tried a game and stopped. */
    matchesPerRoom: number | null;
  };
  daily: DayRow[];
  /** 24 buckets, local hour, counting match starts. */
  hours: number[];
  devices: CountRow[];
  /** Derived server-side from the User-Agent — the one thing that explains a Safari-only bug. */
  browsers: CountRow[];
  languages: CountRow[];
  entry: CountRow[];
  installed: number;
  /** Devices whose owner had to override the on-screen-controls guess. */
  controlsOverridden: number;
  games: GameRow[];
  people: PersonRow[];
  problems: {
    errors: CountRow[];
    crashes: CrashRow[];
    /** Players who dropped and came back. */
    reconnects: number;
    /** Players who dropped and never came back. */
    lost: number;
    /** Median of the reported 90th-percentile round trips. */
    p90: number;
    /** Share of match reports where the 90th percentile passed a quarter second. */
    roughShare: number;
  };
  ui: CountRow[];
  recent: AnalyticsEvent[];
}

export interface SummaryOptions {
  days?: number;
  now?: number;
  timeZone?: string;
  /** How many raw rows the page tails. */
  recent?: number;
}

/** `ANALYTICS_TZ`, or the living room this was built for. */
export function analyticsTimeZone(): string {
  return process.env.ANALYTICS_TZ?.trim() || DEFAULT_TIME_ZONE;
}

export function summarize(events: readonly AnalyticsEvent[], options: SummaryOptions = {}): Summary {
  const days = options.days ?? 30;
  const now = options.now ?? Date.now();
  const timeZone = options.timeZone ?? analyticsTimeZone();
  const recentCount = options.recent ?? 60;
  const cutoff = now - days * DAY_MS;

  const parts = localParts(timeZone);

  // First sighting per browser, over the *whole* retained log rather than the
  // window — otherwise everybody who played last month counts as new today.
  const firstSeen = new Map<string, number>();
  for (const event of events) {
    if (event.e !== 'visit') continue;
    const visitor = text(event.visitor);
    const at = Date.parse(event.t);
    if (!visitor || Number.isNaN(at)) continue;
    const previous = firstSeen.get(visitor);
    if (previous === undefined || at < previous) firstSeen.set(visitor, at);
  }

  const window = events.filter((event) => {
    const at = Date.parse(event.t);
    return !Number.isNaN(at) && at >= cutoff && at <= now;
  });

  const visitors = new Set<string>();
  const newVisitors = new Set<string>();
  const players = new Set<string>();
  const rooms = new Set<string>();
  const daily = new Map<string, DayRow>();
  const hours = new Array<number>(24).fill(0);
  const devices = new Counter();
  const browsers = new Counter();
  const languages = new Counter();
  const entry = new Counter();
  const errors = new Counter();
  const uiActions = new Counter();
  const crashes = new Map<string, CrashRow>();
  const games = new Map<string, GameAccumulator>();
  const people = new Map<string, PersonRow>();
  const p90s: number[] = [];
  const visitSeconds: number[] = [];
  const roomMinutes: number[] = [];

  let visits = 0;
  let installed = 0;
  let controlsOverridden = 0;
  let matches = 0;
  let matchMs = 0;
  let bounced = 0;
  let ended = 0;
  let reconnects = 0;
  let lost = 0;
  let rough = 0;
  let netReports = 0;

  for (const event of window) {
    const at = Date.parse(event.t);
    const { day, hour } = parts(at);
    const row = dayRow(daily, day);

    switch (event.e) {
      case 'visit': {
        const visitor = text(event.visitor);
        visits += 1;
        row.visits += 1;
        if (visitor) {
          visitors.add(visitor);
          if ((firstSeen.get(visitor) ?? at) >= cutoff) newVisitors.add(visitor);
        }
        devices.add(text(event.device) || 'unknown');
        browsers.add(`${text(event.browser) || 'unknown'} · ${text(event.os) || 'unknown'}`);
        languages.add(text(event.lang) || 'unknown');
        entry.add(text(event.entry) || 'direct');
        if (event.standalone === true) installed += 1;
        if (event.controls !== undefined && event.controls !== 'auto') controlsOverridden += 1;
        break;
      }

      case 'leave': {
        ended += 1;
        if (num(event.rooms) === 0) bounced += 1;
        visitSeconds.push(Math.round(num(event.ms) / 1000));
        break;
      }

      case 'join': {
        const name = text(event.name);
        const code = text(event.room);
        if (code) rooms.add(code);
        if (name) {
          players.add(name);
          person(people, name).rooms += 1;
          person(people, name).last = event.t;
        }
        break;
      }

      case 'part':
        if (event.why === 'gone') lost += 1;
        break;

      case 'room_close': {
        const code = text(event.room);
        // A room that opened before the window still counts as one played in
        // it; `rooms` is keyed by code, so this only adds the ones that started
        // out of view rather than double-counting the ones already there.
        if (code) rooms.add(code);
        roomMinutes.push(num(event.ms) / 60_000);
        break;
      }

      case 'back':
        reconnects += 1;
        break;

      case 'pick':
        game(games, text(event.game)).picks += 1;
        break;

      case 'match_open': {
        matches += 1;
        row.matches += 1;
        hours[hour] += 1;
        const entryFor = game(games, text(event.game));
        entryFor.plays += 1;
        entryFor.playerTotal += num(event.players);
        for (const name of names(event.names)) {
          person(people, name).matches += 1;
          person(people, name).last = event.t;
        }
        break;
      }

      case 'match_close': {
        const ms = num(event.ms);
        matchMs += ms;
        row.minutes += ms / 60_000;
        const entryFor = game(games, text(event.game));
        entryFor.ms += ms;
        entryFor.closed += 1;
        // 'finished' is a real conclusion; everything else is the match not
        // going the distance, which is the number worth watching per game.
        if (event.why === 'finished') entryFor.finished += 1;
        else entryFor.abandoned += 1;
        break;
      }

      case 'net': {
        netReports += 1;
        const p90 = num(event.p90);
        p90s.push(p90);
        if (p90 > 250) rough += 1;
        const id = text(event.game);
        if (id) game(games, id).p90s.push(p90);
        break;
      }

      case 'error':
        errors.add(text(event.code) || 'unknown');
        break;

      case 'crash': {
        const msg = text(event.msg) || 'unknown';
        const existing = crashes.get(msg);
        if (existing) {
          existing.count += 1;
          existing.last = event.t;
        } else {
          crashes.set(msg, { msg, at: text(event.at), count: 1, last: event.t });
        }
        break;
      }

      case 'ui': {
        const what = text(event.what);
        uiActions.add(what || 'unknown');
        if (what === 'menu') {
          const id = text(event.game);
          if (id) game(games, id).menu += 1;
        }
        break;
      }

      case 'series_open':
        // Counted only through the legs it produces, which are ordinary
        // matches. The row exists so the pool and pace choices are in the log.
        break;
    }
  }

  // Distinct visitors per day needs its own pass: a Set per day is the only way
  // to count them, and threading one through the switch above would put a map
  // of maps in the middle of the readable part.
  const perDay = new Map<string, Set<string>>();
  for (const event of window) {
    if (event.e !== 'visit') continue;
    const visitor = text(event.visitor);
    if (!visitor) continue;
    const { day } = parts(Date.parse(event.t));
    const set = perDay.get(day) ?? new Set<string>();
    set.add(visitor);
    perDay.set(day, set);
  }
  for (const [day, set] of perDay) dayRow(daily, day).visitors = set.size;

  return {
    days,
    from: parts(cutoff).day,
    to: parts(now).day,
    timeZone,
    totals: {
      visits,
      visitors: visitors.size,
      newVisitors: newVisitors.size,
      players: players.size,
      rooms: rooms.size,
      matches,
      matchMinutes: Math.round(matchMs / 60_000),
      bounce: ended > 0 ? bounced / ended : 0,
      medianVisitSeconds: Math.round(percentile(visitSeconds, 50)),
      medianRoomMinutes: roomMinutes.length > 0 ? Math.round(percentile(roomMinutes, 50)) : null,
      // From matches and rooms seen in the window, not from `room_close` — a
      // room still open tonight has already played the matches it played, and
      // waiting for it to be swept before counting them would make the number
      // useless exactly when somebody is looking at it.
      matchesPerRoom: rooms.size > 0 ? round1(matches / rooms.size) : null,
    },
    daily: fillDays(daily, cutoff, now, parts),
    hours,
    devices: devices.rows(),
    browsers: browsers.rows(),
    languages: languages.rows(),
    entry: entry.rows(),
    installed,
    controlsOverridden,
    games: [...games.entries()]
      .map(([id, acc]) => ({
        id,
        picks: acc.picks,
        plays: acc.plays,
        finished: acc.finished,
        abandoned: acc.abandoned,
        avgMinutes: acc.closed > 0 ? round1(acc.ms / acc.closed / 60_000) : 0,
        avgPlayers: acc.plays > 0 ? round1(acc.playerTotal / acc.plays) : 0,
        menu: acc.menu,
        p90: Math.round(percentile(acc.p90s, 50)),
      }))
      .sort((a, b) => b.plays - a.plays || b.picks - a.picks),
    people: [...people.values()].sort((a, b) => b.matches - a.matches || b.rooms - a.rooms),
    problems: {
      errors: errors.rows(),
      crashes: [...crashes.values()].sort((a, b) => b.count - a.count),
      reconnects,
      lost,
      p90: Math.round(percentile(p90s, 50)),
      roughShare: netReports > 0 ? rough / netReports : 0,
    },
    ui: uiActions.rows(),
    recent: window.slice(-recentCount).reverse(),
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

interface GameAccumulator {
  picks: number;
  plays: number;
  closed: number;
  finished: number;
  abandoned: number;
  ms: number;
  playerTotal: number;
  menu: number;
  p90s: number[];
}

class Counter {
  private counts = new Map<string, number>();

  add(label: string): void {
    this.counts.set(label, (this.counts.get(label) ?? 0) + 1);
  }

  rows(): CountRow[] {
    return [...this.counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }
}

function game(map: Map<string, GameAccumulator>, id: string): GameAccumulator {
  if (!id) id = 'unknown';
  let entry = map.get(id);
  if (!entry) {
    entry = {
      picks: 0,
      plays: 0,
      closed: 0,
      finished: 0,
      abandoned: 0,
      ms: 0,
      playerTotal: 0,
      menu: 0,
      p90s: [],
    };
    map.set(id, entry);
  }
  return entry;
}

function person(map: Map<string, PersonRow>, name: string): PersonRow {
  let entry = map.get(name);
  if (!entry) {
    entry = { name, rooms: 0, matches: 0, last: '' };
    map.set(name, entry);
  }
  return entry;
}

function dayRow(map: Map<string, DayRow>, day: string): DayRow {
  let entry = map.get(day);
  if (!entry) {
    entry = { day, visits: 0, visitors: 0, matches: 0, minutes: 0 };
    map.set(day, entry);
  }
  return entry;
}

/**
 * Every day in the window, including the empty ones.
 *
 * A bar chart that silently omits the days nobody played is a chart of when
 * people played, drawn as if it were a chart of time — the gaps *are* the
 * information.
 */
function fillDays(
  map: Map<string, DayRow>,
  from: number,
  to: number,
  parts: (at: number) => { day: string; hour: number },
): DayRow[] {
  const out: DayRow[] = [];
  for (let at = from; at <= to + DAY_MS; at += DAY_MS) {
    const { day } = parts(at);
    if (out.length > 0 && out[out.length - 1]!.day === day) continue;
    if (day > parts(to).day) break;
    const row = map.get(day);
    out.push(row ? { ...row, minutes: Math.round(row.minutes) } : dayRow(new Map(), day));
  }
  return out;
}

/**
 * Local day and hour, memoised per timestamp-minute.
 *
 * `Intl.DateTimeFormat` is not cheap and this runs once per row; formatting the
 * same minute repeatedly is the whole cost of a dashboard render on a busy
 * evening's worth of events.
 */
function localParts(timeZone: string): (at: number) => { day: string; hour: number } {
  // `en-CA` is the shortest route to `YYYY-MM-DD`, which is the only date format
  // that sorts as a string.
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const cache = new Map<number, { day: string; hour: number }>();

  return (at: number) => {
    if (Number.isNaN(at)) return { day: '', hour: 0 };
    const key = Math.floor(at / 60_000);
    const hit = cache.get(key);
    if (hit) return hit;

    const fields = format.formatToParts(new Date(at));
    const pick = (type: string): string => fields.find((part) => part.type === type)?.value ?? '';
    // Some locales render midnight as hour 24; both mean the same day's start.
    const hour = Number(pick('hour')) % 24;
    const value = {
      day: `${pick('year')}-${pick('month')}-${pick('day')}`,
      hour: Number.isFinite(hour) ? hour : 0,
    };
    cache.set(key, value);
    return value;
  };
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index]!;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
