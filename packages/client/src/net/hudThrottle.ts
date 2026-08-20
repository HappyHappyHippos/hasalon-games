/**
 * When a snapshot is allowed to reach the React HUD.
 *
 * Snapshots arrive at 30 Hz and almost none of them change anything a person
 * can read, so `socket.ts` mirrors at most one every `HUD_INTERVAL_MS` into the
 * zustand store. That throttle is why the tree does not re-render thirty times
 * a second — and it is also a trapdoor, because a value that appears in exactly
 * one snapshot has a four-in-five chance of being thrown away.
 *
 * Meme Machine's end-of-match gallery fell through it. `matchOver` is the last
 * phase the tick loop broadcasts, and if its snapshot landed inside the window
 * the gallery never reached the store — so the "look through them all again"
 * button was not rendered at all, on any device, most of the time.
 *
 * Hence two escapes, and the rule lives here rather than inline so it can be
 * pinned by `hudThrottle.test.ts`:
 *
 * - **an events burst**, which is how the games that have one say "something
 *   just happened"; and
 * - **a phase change**, which no game has to opt into. The first snapshot of a
 *   phase is the only one carrying whatever that phase turned on, so it is
 *   never the one to drop.
 *
 * A game that needs something stronger than "not usually dropped" must not use
 * this path at all — see the note at the top of `socket.ts` about Skribbl's ink.
 */
export interface HudMirrorState {
  /** `performance.now()` when a snapshot last reached the store. */
  lastAt: number;
  /** Phase of that snapshot, or '' before the first one of a match. */
  lastPhase: string;
}

export const HUD_INTERVAL_MS = 120;

export function shouldMirrorHud(
  state: HudMirrorState,
  snapshot: { phase: string; events?: readonly unknown[] },
  now: number,
): boolean {
  if (snapshot.phase !== state.lastPhase) return true;
  if (snapshot.events !== undefined && snapshot.events.length > 0) return true;
  return now - state.lastAt >= HUD_INTERVAL_MS;
}
