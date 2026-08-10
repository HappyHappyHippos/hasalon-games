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



/**
 * Points for every seated player, keyed by id, from their finishing
 * `score` for the match that just ended (already game-appropriate — highest
 * is always best, ties share the points of the ranks they occupy).
 *
 * The table is one point per place, counting down from the size of the field:
 * with five players the winner takes 5 and last place takes 1. Two properties
 * are worth stating, because both are load-bearing for a roulette series and
 * neither was true of the version this replaces:
 *
 * - **Nobody ever loses points.** Finishing last in a leg is worth less than
 *   winning it, not worth less than not playing. A table that goes negative
 *   makes a bad leg feel like a punishment and, in a two-player room, made the
 *   running total capable only of going down.
 * - **A bigger field is worth more.** Winning a six-player leg beats winning a
 *   three-player one, which is what keeps the totals honest when somebody
 *   drops out partway through a series.
 */
export function placementPoints(finishers: ReadonlyArray<{ id: string; score: number }>): Record<string, number> {
  const sorted = [...finishers].sort((a, b) => b.score - a.score);
  const out: Record<string, number> = {};
  const playerCount = sorted.length;

  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j]!.score === sorted[i]!.score) j += 1;
    // Tied players split the points of the ranks they collectively occupy —
    // e.g. in a field of four, two tied for 2nd/3rd each get (3 + 2) / 2.
    let pool = 0;
    for (let rank = i; rank < j; rank++) pool += (playerCount - rank);
    const share = pool / (j - i);
    for (let rank = i; rank < j; rank++) out[sorted[rank]!.id] = share;
    i = j;
  }

  return out;
}
