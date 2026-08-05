/**
 * The authored track pieces.
 *
 * Chunks are ASCII on a 7×8 tile grid so that editing the level design is
 * editing the picture. `#` is solid, `.` is air. Row 0 is the ceiling, row 6 the
 * floor.
 *
 * One invariant makes joining them safe, and it is checked by
 * `track.ts:validateChunk`:
 *
 *   **The first and last column of every chunk are exactly a solid ceiling and
 *   a solid floor with clear air between them.**
 *
 * That is the whole seam rule. Any chunk can follow any other, every join is a
 * spot where both surfaces exist, and each chunk is independently survivable —
 * so a track assembled from valid chunks is valid however the RNG orders them.
 * The alternative, matching entry and exit profiles pairwise, buys nothing here
 * and makes every new chunk a compatibility question.
 *
 * The design rule inside a chunk: a floor gap and a ceiling gap never overlap,
 * and there is at least one column with both surfaces between them, so there is
 * always somewhere to be standing when the other side runs out.
 */

export type ChunkTier = 'easy' | 'medium' | 'hard';

export interface Chunk {
  id: string;
  tier: ChunkTier;
  /** 7 strings of 8 characters. */
  art: string[];
}

export const CHUNKS: Chunk[] = [
  {
    id: 'flat',
    tier: 'easy',
    art: [
      '########',
      '........',
      '........',
      '........',
      '........',
      '........',
      '########',
    ],
  },
  {
    id: 'floorGap',
    tier: 'easy',
    art: [
      '########',
      '........',
      '........',
      '........',
      '........',
      '........',
      '####..##',
    ],
  },
  {
    id: 'ceilGap',
    tier: 'easy',
    art: [
      '####..##',
      '........',
      '........',
      '........',
      '........',
      '........',
      '########',
    ],
  },
  {
    id: 'floorNick',
    tier: 'easy',
    art: [
      '########',
      '........',
      '........',
      '........',
      '........',
      '........',
      '#####.##',
    ],
  },
  {
    id: 'floorThenCeil',
    tier: 'medium',
    art: [
      '#####..#',
      '........',
      '........',
      '........',
      '........',
      '........',
      '##..####',
    ],
  },
  {
    id: 'ceilThenFloor',
    tier: 'medium',
    art: [
      '##..####',
      '........',
      '........',
      '........',
      '........',
      '........',
      '######.#',
    ],
  },
  {
    id: 'floorBlock',
    tier: 'medium',
    art: [
      '########',
      '........',
      '........',
      '........',
      '........',
      '....##..',
      '########',
    ],
  },
  {
    id: 'ceilBlock',
    tier: 'medium',
    art: [
      '########',
      '..##....',
      '........',
      '........',
      '........',
      '........',
      '########',
    ],
  },
  {
    id: 'doubleNick',
    tier: 'medium',
    art: [
      '########',
      '........',
      '........',
      '........',
      '........',
      '........',
      '##.##.##',
    ],
  },
  {
    id: 'zigzag',
    tier: 'hard',
    art: [
      '####.###',
      '........',
      '........',
      '........',
      '........',
      '........',
      '##.###.#',
    ],
  },
  {
    id: 'pinch',
    tier: 'hard',
    art: [
      '########',
      '.....##.',
      '........',
      '........',
      '........',
      '..##....',
      '########',
    ],
  },
  {
    id: 'longFloorGap',
    tier: 'hard',
    art: [
      '########',
      '........',
      '........',
      '........',
      '........',
      '........',
      '##....##',
    ],
  },
  {
    id: 'longCeilGap',
    tier: 'hard',
    art: [
      '##....##',
      '........',
      '........',
      '........',
      '........',
      '........',
      '########',
    ],
  },
  {
    id: 'alternate',
    tier: 'hard',
    art: [
      '###.####',
      '........',
      '........',
      '........',
      '........',
      '........',
      '#.###.##',
    ],
  },
  {
    id: 'staircase',
    tier: 'hard',
    // Three floor gaps climbing in from the right, each one column closer to
    // the last, so the flips needed to clear them come faster and faster.
    art: [
      '########',
      '........',
      '........',
      '........',
      '........',
      '........',
      '##.#.#.#',
    ],
  },
  {
    id: 'staircaseCeil',
    tier: 'hard',
    // Same climbing rhythm, mirrored onto the ceiling — a ceiling-runner gets
    // the same accelerating cadence of flips.
    art: [
      '#.#.#.##',
      '........',
      '........',
      '........',
      '........',
      '........',
      '########',
    ],
  },
  {
    id: 'tightZigzag',
    tier: 'hard',
    // Two floor nicks in a row, then one ceiling nick: a flip up to clear the
    // pair, then a flip back down before the ceiling closes.
    art: [
      '######.#',
      '........',
      '........',
      '........',
      '........',
      '........',
      '##.#.###',
    ],
  },
  {
    id: 'longAlternatingCorridor',
    tier: 'hard',
    // A steady back-and-forth spanning the whole chunk: floor nick, ceiling
    // nick, floor nick, ceiling nick, each offset from the last.
    art: [
      '##.##.##',
      '........',
      '........',
      '........',
      '........',
      '........',
      '#.##.###',
    ],
  },
  {
    id: 'pinchPair',
    tier: 'hard',
    // Two narrow blocks in sequence, one hanging from the ceiling and one
    // rising from the floor, each requiring its own flip to clear.
    art: [
      '########',
      '..##....',
      '........',
      '........',
      '........',
      '.....##.',
      '########',
    ],
  },
];

export const CHUNKS_BY_TIER: Record<ChunkTier, Chunk[]> = {
  easy: CHUNKS.filter((c) => c.tier === 'easy'),
  medium: CHUNKS.filter((c) => c.tier === 'medium'),
  hard: CHUNKS.filter((c) => c.tier === 'hard'),
};

/** The opening piece is always flat, so nobody dies during the countdown. */
export const OPENING_CHUNK = CHUNKS[0]!;
