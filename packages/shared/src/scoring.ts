/**
 * Cross-game standings — one running total per player, F1-style, so a room
 * that plays three different games in a row still has a single leaderboard.
 *
 * Each game keeps its own scoring shape (Gun Mayhem round-wins, Achtung
 * survival order, Skribbl guess/draw points) via `GameInstance.scores()`, and
 * those are only ever comparable *within* one match. Placement is the one
 * thing every game's finishing order means the same way regardless of what
 * produced it, so that's what carries across a game switch.
 */

/** Points for 1st, 2nd, 3rd, ... Same table regardless of player count. */
export const PLACEMENT_POINTS = [25, 18, 15, 12, 10, 8, 6, 4];

/** Anyone finishing outside the table still gets on the board. */
const PARTICIPATION_POINTS = 1;

function pointsForRank(rank: number): number {
  return PLACEMENT_POINTS[rank] ?? PARTICIPATION_POINTS;
}

/**
 * Points for every seated player, keyed by id, from their finishing
 * `score` for the match that just ended (already game-appropriate — highest
 * is always best, ties share the points of the ranks they occupy).
 */
export function placementPoints(finishers: ReadonlyArray<{ id: string; score: number }>): Record<string, number> {
  const sorted = [...finishers].sort((a, b) => b.score - a.score);
  const out: Record<string, number> = {};

  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j]!.score === sorted[i]!.score) j += 1;
    // Tied players split the points of the ranks they collectively occupy —
    // e.g. two people tied for 2nd/3rd each get (18 + 15) / 2.
    let pool = 0;
    for (let rank = i; rank < j; rank++) pool += pointsForRank(rank);
    const share = pool / (j - i);
    for (let rank = i; rank < j; rank++) out[sorted[rank]!.id] = share;
    i = j;
  }

  return out;
}
