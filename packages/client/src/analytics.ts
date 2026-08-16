/**
 * The client's half of the usage log, which is deliberately small.
 *
 * The server writes everything it can observe for itself — who joined, which
 * game, how the match ended — so this file exists only for the facts that never
 * reach it. There are four, and the bar for a fifth is high: it has to be
 * something the server genuinely cannot see. See `@mg/shared/analytics` for the
 * reasoning behind that split.
 *
 * Nothing here has a cadence. `hello` is one frame per connection, `net` is one
 * per match, and the other two fire on an event that already happened. There is
 * no timer in this file and there should never be one — a heartbeat would put
 * traffic on a wire whose whole design is about keeping snapshots timely.
 */
import type { ClientHello, ClientReport, UiAction } from '@mg/shared';
import { useStore } from './store';

/**
 * A random id per browser, kept in `localStorage` next to the identity.
 *
 * The one thing that separates "five people played" from "one person reloaded
 * five times", and the only way to recognise somebody coming back — names are
 * retyped and occasionally borrowed. It is a browser, not a person, and it
 * leaves this site only to reach our own server.
 *
 * In `localStorage` rather than `sessionStorage` precisely because it must
 * survive the tab: the session key next to it is per-tab on purpose (two tabs
 * are two players) and a visitor id with that property would count every reload
 * as a stranger.
 */
const VISITOR_KEY = 'mg.visitor';

function visitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, fresh);
    return fresh;
  } catch {
    // Private mode or storage disabled. A per-load id still makes the visit
    // countable; it just cannot be recognised on the next one.
    return 'anon';
  }
}

/**
 * Phone, tablet or desktop — decided here rather than from the User-Agent.
 *
 * The server sees the UA and derives the *browser* from it, which is the part a
 * UA is actually reliable for. Form factor it is not: an iPad reports itself as
 * a Mac, and every desktop browser's device-emulation mode lies on purpose.
 *
 * `pointer: coarse` and not `maxTouchPoints`, which is the obvious version and
 * is wrong on the machines that matter most here. Touchscreen laptops are
 * ordinary now, and a family with one would show up as a room full of tablets —
 * `maxTouchPoints` answers "is there a touchscreen", while the media query
 * answers "is a finger the *primary* way this is driven", which is the question.
 * `touch` below still carries the first fact separately.
 */
function deviceClass(): ClientHello['device'] {
  if (!window.matchMedia('(pointer: coarse)').matches) return 'desktop';
  // The physical panel, not the window — a phone cannot be resized, and a
  // half-width browser window on a desktop is not a phone.
  const shortest = Math.min(window.screen.width, window.screen.height);
  return shortest >= 600 ? 'tablet' : 'phone';
}

/** Everything the server cannot work out for itself, sent once on connect. */
export function helloPayload(): ClientHello {
  const state = useStore.getState();
  return {
    visitor: visitorId(),
    lang: state.lang,
    device: deviceClass(),
    touch: navigator.maxTouchPoints > 0,
    standalone: window.matchMedia('(display-mode: standalone)').matches,
    controls: state.touchControls,
    // The hash is the invite link. Read at connect time, before the join effect
    // has had a chance to clear it.
    entry: /^#\/room\//.test(location.hash) ? 'link' : 'direct',
    screen: `${window.innerWidth}x${window.innerHeight}`,
  };
}

/**
 * Where a report goes. Injected by `socket.ts` rather than imported from it,
 * for the same reason `voice.send` is: importing the socket here would close a
 * cycle, and whichever module loaded second would see half of the other.
 */
export let sendReport: (report: ClientReport) => void = () => {};

export function setReportSender(sender: (report: ClientReport) => void): void {
  sendReport = sender;
}

/** One of the three taps with no other trace. */
export function trackUi(what: UiAction): void {
  sendReport({ e: 'ui', what });
}

/**
 * How this player's connection behaved across one match.
 *
 * Reported once, when the match ends, from samples the HUD mirror is already
 * taking — so it costs one extra frame on the wire per match and no new
 * measurement machinery. The p90 is the number that matters: a median round trip
 * of 40 ms with a p90 of 400 is a match that felt awful, and an average would
 * report it as fine.
 */
export function trackNet(samples: readonly number[], delay: number): void {
  if (samples.length === 0) return;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  sendReport({ e: 'net', rtt: Math.round(at(0.5)), p90: Math.round(at(0.9)), delay: Math.round(delay) });
}

/**
 * Report uncaught errors and rejected promises.
 *
 * The highest-value thing in this file by a distance. Nobody in the family is
 * going to open devtools, so without this an exception that breaks a screen is
 * indistinguishable from the game being confusing — the report that arrives is
 * "it stopped working" and there is nothing to go on.
 *
 * Deduplicated by message, because a throw inside a render or an animation frame
 * repeats every frame and would otherwise be the only thing in the log.
 */
export function installCrashReporting(): void {
  const seen = new Set<string>();

  const report = (msg: string, at: string): void => {
    const key = `${msg}|${at}`;
    if (seen.has(key)) return;
    seen.add(key);
    sendReport({ e: 'crash', msg: msg.slice(0, 300), at: at.slice(0, 300) });
  };

  window.addEventListener('error', (event) => {
    // Two different shapes arrive on this one event: a script error has a
    // `message`, while a failed <img>/<audio> load has none and names the
    // element instead. The second is how a missing asset shows up, and it has
    // been a real bug here more than once — so it is reported, not filtered.
    if (event.message) {
      report(event.message, `${event.filename ?? ''}:${event.lineno ?? 0}`);
      return;
    }
    const target = event.target as { tagName?: string; src?: string } | null;
    if (target?.tagName) report(`failed to load ${target.tagName.toLowerCase()}`, target.src ?? '');
  }, true); // Capture: resource load failures do not bubble.

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: string; stack?: string } | string | undefined;
    const msg = typeof reason === 'string' ? reason : (reason?.message ?? 'unhandled rejection');
    const stack = typeof reason === 'object' ? (reason?.stack ?? '') : '';
    // The first frame below the message is where it came from; the rest is noise
    // in a minified bundle.
    report(msg, stack.split('\n')[1]?.trim() ?? '');
  });
}
