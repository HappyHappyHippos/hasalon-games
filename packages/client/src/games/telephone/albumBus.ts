import type { TelephoneRevealStep, TelephoneSnapshot } from '@mg/shared/telephone';

/**
 * Every chain of the match, kept so the end card's "look back at the chains"
 * button has something to show.
 *
 * **Why the client keeps this rather than the server sending it.** The obvious
 * shape is Meme Machine's: put the whole album on the `matchOver` snapshot and
 * let `sendCatchUp` replay it. Meme Machine can afford that because a meme is a
 * template id and two short strings. A telephone chain is *drawings*, and the
 * arithmetic is brutal — eight players is eight chains of eight steps, half of
 * them drawings, and at a realistic 800 points each that is a 375 KB frame;
 * at `MAX_POINTS_PER_ROUND` it is 2.7 MB. Per socket. In the single frame the
 * match ends on. `Room.broadcastSnapshot` encodes once and pushes to everyone,
 * so that is the whole room's connection spent on a button nobody may press.
 *
 * None of it needs to be sent, because it has already been sent. The reveal
 * walks every chain past every connected client, one at a time, and this just
 * declines to throw them away — so the album costs nothing on the wire and the
 * bytes are the same ones the player already watched.
 *
 * The trade is honest and worth naming: this lives in memory in one tab, so
 * somebody who reloads on the end screen gets the champion card back (that
 * rides `matchEnded`, which `sendCatchUp` replays) but not the album. A reload
 * is rare, the loss is a nice-to-have rather than the result, and the
 * alternative costs every player megabytes every match.
 */
let chains: TelephoneRevealStep[][] = [];

/**
 * Record whatever this snapshot is revealing.
 *
 * Called for every telephone snapshot, before the HUD throttle — a chain's last
 * step lands in one snapshot and the throttle drops four in five, so reading
 * this off the mirrored HUD would lose chains at random. Later snapshots of the
 * same chain hold strictly more steps, so overwriting by index converges on the
 * complete chain without needing to know which snapshot is the last.
 */
export function receiveTelephoneChains(snap: TelephoneSnapshot): void {
  if (snap.revealed.length === 0) return;
  const index = snap.revealChainIndex;
  if (index < 0) return;
  const known = chains[index]?.length ?? 0;
  if (snap.revealed.length < known) return;
  chains[index] = snap.revealed;
}

/** Every chain seen this match, in reveal order. */
export function telephoneAlbum(): TelephoneRevealStep[][] {
  return chains;
}

export function resetTelephoneAlbum(): void {
  chains = [];
}
