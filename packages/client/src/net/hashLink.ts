import { isValidRoomCode } from '@mg/shared';

/**
 * Shareable `#/room/CODE` links.
 *
 * Its own module, with no dependencies beyond the room-code rule, for the same
 * reason `hudThrottle.ts` and `canvasView.ts` are: it is a pure function whose
 * correctness is worth pinning, and reaching it through `socket.ts` drags in
 * the store, the voice mesh and `window`.
 */

/**
 * The room code out of a `#/room/CODE` link, or null if there isn't a valid one.
 *
 * What counts as a code is `roomTypes.ts`'s business, not this file's. This
 * used to match `\d{4}` inline, which duplicated both halves of a shape that
 * has already changed once — codes were 24 letters plus 8 digits before they
 * became four digits. Change `ROOM_CODE_LENGTH` or the alphabet again and the
 * generator, the join field and the server all follow; a hardcoded regex would
 * not, and it fails in the worst way available: every invite link anyone has
 * shared quietly stops joining. `App.tsx` reads this on mount, gets null, and
 * leaves the visitor on the home screen with nothing to explain why.
 *
 * `hash` is a parameter so this is testable without a DOM.
 */
export function readHashCode(hash: string = location.hash): string | null {
  const match = /^#\/room\/(.+)$/u.exec(hash);
  const code = match?.[1];
  return code !== undefined && isValidRoomCode(code) ? code : null;
}

export function setHashCode(code: string | null): void {
  const next = code ? `#/room/${code}` : '';
  if (location.hash === next) return;
  history.replaceState(null, '', next || location.pathname + location.search);
}
