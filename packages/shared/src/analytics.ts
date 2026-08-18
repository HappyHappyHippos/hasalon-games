/**
 * The analytics vocabulary: every event the site can record, defined once.
 *
 * **One rule governs everything here, and it is what keeps the log free of
 * redundancy: the server is the only writer.** It already sees who connected,
 * which room they joined, which game the host picked, how long the match ran and
 * how it ended — so the client never reports any of that. A client that
 * duplicated it would give us two versions of the same fact that disagree the
 * moment one of them has a bug.
 *
 * The client therefore reports exactly three things, and only because the server
 * genuinely cannot see them:
 *
 * - `hello` — what kind of device this is, and which settings it arrived with.
 *   One frame per connection, sent before anything else, so `visit` can be a
 *   complete row rather than a stub the dashboard has to join against.
 * - `crash` — an uncaught error in the browser. The single best signal for
 *   "something is broken and nobody bothered to tell me".
 * - `net` — how the match actually felt from that sofa. Round-trip time is
 *   measured by the client against the server's clock; the server has no view of
 *   it at all, and "the game is laggy" is otherwise unfalsifiable.
 * - `ui` — the three taps that never reach the server: sharing an invite,
 *   opening the rules, installing the app.
 *
 * Everything else is derived server-side in `Room`/`app.ts`. If you find
 * yourself wanting to add a client event, check first whether the server already
 * knows — it usually does.
 *
 * The wire shape is deliberately terse (`t`, `e`, short field names) because
 * every event is one line of NDJSON that a human may end up reading in a
 * terminal. It is not compressed for size; it is compressed for eyeballs.
 */

/**
 * Every kind of event. A closed union rather than free-form strings, so the
 * dashboard's aggregation is exhaustive and a typo is a compile error.
 *
 * Read as three groups:
 *
 * - **Who and when** — `visit`, `leave`, `join`, `part`, `back`, `room_close`
 * - **What they played** — `pick`, `match_open`, `match_close`, `series_open`
 * - **What went wrong** — `error`, `crash`, `net`
 *
 * plus `ui` for the handful of taps that have no server-side consequence.
 */
export type AnalyticsEventName =
  /** A browser opened a socket and said hello. One per connection. */
  | 'visit'
  /** That socket closed. Carries how long it lasted and whether it played anything. */
  | 'leave'
  /** Someone took a seat in a room. `host: true` on the person who created it. */
  | 'join'
  /** Someone left a room for good — walked out, was kicked, or never came back. */
  | 'part'
  /**
   * A room was torn down. One row per evening: how long it lived, everyone who
   * passed through, and what they got through.
   *
   * The only event whose fields could in principle be rebuilt from other rows —
   * replaying every `join` and `part` in order would give you the peak, and the
   * timestamps would give you the length. It is written anyway because that
   * replay is a join across rows, and the whole reason this log is readable is
   * that nothing else needs one. It is still a single writer stating a fact it
   * alone observed: these are counters the room kept as it ran.
   */
  | 'room_close'
  /** A dropped player reconnected. The flakiness measure; `part` with `why: 'gone'` is the failure. */
  | 'back'
  /** The host selected a game in the lobby. Not the same as playing it — that is the point. */
  | 'pick'
  | 'match_open'
  | 'match_close'
  /** A roulette run was drawn. The legs themselves are ordinary matches. */
  | 'series_open'
  /** Any error the server sent to any client, by code. */
  | 'error'
  /** An uncaught error in someone's browser. Client-reported. */
  | 'crash'
  /** How one player's connection behaved across one match. Client-reported. */
  | 'net'
  /** Invite shared, rules opened, app installed. Client-reported. */
  | 'ui';

/**
 * One recorded event: a timestamp, a name, and whatever fields that name
 * carries.
 *
 * Flat on purpose. Nested objects are what turn `grep` and `jq` into a puzzle,
 * and the whole point of this format is that the raw file is readable without
 * either.
 */
export interface AnalyticsEvent {
  /** ISO 8601, UTC. Sorts lexicographically, which is why it is not a number. */
  t: string;
  e: AnalyticsEventName;
  [field: string]: unknown;
}

// ---------------------------------------------------------------------------
// What the client tells us
// ---------------------------------------------------------------------------

/** Coarse enough to be useful, coarse enough not to identify a device. */
export type DeviceClass = 'phone' | 'tablet' | 'desktop';

/** How this browser arrived: followed an invite link, or typed the address. */
export type EntryKind = 'link' | 'direct';

/**
 * The opening frame of every connection.
 *
 * Everything in here is a fact the server cannot obtain another way. Notably
 * *absent*: the player's name and room code — the server learns those from
 * `create`/`join` and stamping them here as well would be the exact duplication
 * this file exists to avoid.
 */
export interface ClientHello {
  /**
   * A random id in `localStorage`, stable across visits from this browser.
   *
   * The one thing that distinguishes "four people played" from "one person
   * reloaded four times", and the only way to see a returning player at all —
   * names are re-typed, editable and occasionally shared between siblings.
   * It identifies a browser, never a person, and is never linked to anything
   * outside this site.
   */
  visitor: string;
  /** The interface language actually in use, which is a setting, not the browser's locale. */
  lang: 'he' | 'en';
  device: DeviceClass;
  /** True where the browser reports a touchscreen — not the same as `device`. */
  touch: boolean;
  /** Running as an installed app rather than a browser tab. */
  standalone: boolean;
  /**
   * The on-screen-controls override.
   *
   * Anything other than `auto` means detection got it wrong on this device and
   * somebody had to go and find the setting — a bug report nobody filed.
   */
  controls: 'auto' | 'on' | 'off';
  entry: EntryKind;
  /** Viewport, `WIDTHxHEIGHT` at CSS pixels. Explains layout complaints. */
  screen: string;
}

/**
 * The three things a client may report after `hello`, and nothing else.
 *
 * A closed union, validated server-side by `parseClientReport` — this arrives
 * over the same untrusted socket as everything else, and "the client would never
 * send that" has never been a security model.
 */
export type ClientReport =
  | {
      e: 'crash';
      /** The error message, truncated. */
      msg: string;
      /** Where it came from: the top stack frame, or the file:line the browser gave us. */
      at: string;
    }
  | {
      e: 'net';
      /** Median round trip across the match, milliseconds. */
      rtt: number;
      /** 90th percentile round trip. The number that decides whether it felt bad. */
      p90: number;
      /** How far behind live this client ended up rendering. */
      delay: number;
    }
  | { e: 'ui'; what: UiAction };

/**
 * The taps with no server-side trace.
 *
 * Deliberately three, and the shortlist was longer. Every other button either
 * sends a message the server already logs (ready, start, pick, kick, pause,
 * leave) or changes a local setting that `hello` reports on the next visit
 * anyway (sound, language, on-screen controls). Installing the app was on this
 * list until `hello.standalone` turned out to answer it better — the outcome is
 * worth more than the prompt, and logging both would be exactly the duplication
 * this file is organised against.
 */
export type UiAction =
  /**
   * The invite was copied or handed to the native share sheet. How rooms fill
   * up, and the only visibility into it — the person who arrives is a `join`
   * with no trace of what brought them.
   */
  | 'invite'
  /**
   * The options menu was opened. Named for the menu and not for the rules
   * inside it, because that is honestly all this observes: sound, pause, how to
   * play and leave all live behind the same gear. Read per game it still says
   * something — one game sending people to that menu far more than the others
   * is a game that needs explaining.
   */
  | 'menu'
  /**
   * Fullscreen was entered. On a phone this is the difference between playing
   * and playing around the browser chrome, and the button that does it is easy
   * to miss — so the count is really a measure of whether it was found.
   */
  | 'fullscreen';

// ---------------------------------------------------------------------------
// Parsing — everything below arrives over the wire and is therefore hostile
// ---------------------------------------------------------------------------

const DEVICES: readonly DeviceClass[] = ['phone', 'tablet', 'desktop'];
const CONTROLS = ['auto', 'on', 'off'] as const;
const UI_ACTIONS: readonly UiAction[] = ['invite', 'menu', 'fullscreen'];

/** Long enough for a real stack line, short enough that nothing can flood the log. */
const MAX_TEXT = 300;
/** A UUID with room to spare. Anything longer is not an id. */
const MAX_ID = 64;

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** Finite, non-negative, rounded, and capped — so one bad number cannot skew a chart. */
function ms(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(60_000, Math.round(n)));
}

export function parseClientHello(raw: unknown): ClientHello | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;

  const visitor = str(value.visitor, MAX_ID);
  if (!visitor) return null;

  const device = DEVICES.find((d) => d === value.device) ?? 'desktop';
  const controls = CONTROLS.find((c) => c === value.controls) ?? 'auto';

  return {
    visitor,
    lang: value.lang === 'en' ? 'en' : 'he',
    device,
    touch: value.touch === true,
    standalone: value.standalone === true,
    controls,
    entry: value.entry === 'link' ? 'link' : 'direct',
    // Two integers and an `x`, or nothing. Free text here would end up in the
    // dashboard's device table verbatim.
    screen: /^\d{1,5}x\d{1,5}$/.test(str(value.screen, 12)) ? str(value.screen, 12) : '',
  };
}

export function parseClientReport(raw: unknown): ClientReport | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;

  switch (value.e) {
    case 'crash': {
      const msg = str(value.msg, MAX_TEXT);
      // An empty message is the browser's cross-origin placeholder ("Script
      // error."), which tells us a script failed and nothing else. Recorded as
      // that rather than dropped, because the *count* is still a signal.
      return { e: 'crash', msg: msg || 'unknown', at: str(value.at, MAX_TEXT) };
    }
    case 'net':
      return { e: 'net', rtt: ms(value.rtt), p90: ms(value.p90), delay: ms(value.delay) };
    case 'ui': {
      const what = UI_ACTIONS.find((action) => action === value.what);
      return what ? { e: 'ui', what } : null;
    }
    default:
      return null;
  }
}
