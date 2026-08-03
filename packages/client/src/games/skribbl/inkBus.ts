import type { SkribblSnapshot } from '@mg/shared/skribbl';
import { useStore } from '../../store';

/**
 * Skribbl's append-only streams, delivered off the socket rather than through
 * the HUD mirror.
 *
 * Both the drawing ops and the chat lines are **drained** server-side as they
 * are sent: each one appears in exactly one snapshot and is gone. That rules
 * out the two paths the other games use.
 *
 * - Not `mirrorHud`, which returns early when it is inside its 120 ms throttle
 *   window (`HUD_INTERVAL_MS`). It bypasses that only for snapshots carrying
 *   events, and ink carries none — so most strokes would simply never be read.
 * - Not the render loop over `SnapshotFeed`, which keeps one second of history
 *   and discards the rest. `requestAnimationFrame` stops in a backgrounded tab,
 *   so a phone locked for two seconds would come back with a hole in the
 *   drawing that nothing can fill.
 *
 * So the socket hands every Skribbl snapshot here the moment it arrives, and
 * the canvas drains the queue whenever it next draws. A module-level queue like
 * `feed` — deliberately outside React, because thirty stroke batches a second
 * through component state would re-render the tree for no reason.
 */

let pending: number[] = [];

/** Called by the socket for every Skribbl snapshot, unthrottled. */
export function receiveSkribbl(snap: SkribblSnapshot): void {
  if (snap.ink.length > 0) pending.push(...snap.ink);
  // Chat is append-only history and belongs in React; the store dedupes on id,
  // which matters because a reconnecting client is replayed the last snapshot.
  if (snap.chat.length > 0) useStore.getState().pushChat(snap.chat);
}

/** Take everything queued since the last call. */
export function drainInk(): number[] {
  if (pending.length === 0) return pending;
  const out = pending;
  pending = [];
  return out;
}

/** Drop anything buffered — a new match, or a canvas being torn down. */
export function resetInk(): void {
  pending = [];
}
