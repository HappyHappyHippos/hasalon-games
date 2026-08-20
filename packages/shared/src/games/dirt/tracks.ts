/**
 * The courses.
 *
 * Each one is a closed centreline of control points, a width at each of them,
 * the solid objects scattered around it, and where the powerup pads sit. Read
 * the note at the top of `track.ts` before changing any of it — every other
 * thing the game knows about a track is derived from these numbers, so this is
 * the only place a course exists.
 *
 * ## What the numbers mean
 *
 * - `x`/`y` are arena units in a 1600×900 field, and the **order is the
 *   direction of travel**. The start line is at the first control point.
 * - `w` is the half-width of the racing surface there. 130 is a straight two
 *   cars can race side by side down, 78 is a corner where one of them has to
 *   give way. Varying it is the main tool these tracks have: **wide where you
 *   want a fight, narrow where you want a decision.**
 * - `solids` are objects lining the road — **on the shoulder, never on the
 *   racing surface**. They punish running wide; they are not chicanes to thread.
 *   A box is the object's whole drawn silhouette, not its ground footprint, the
 *   same convention as `tanks/stages.ts`, so the rectangle the car is stopped by
 *   is the one the renderer draws. They also stay small enough to fit in the
 *   shoulder: everything past it is already solid by construction, so a bigger
 *   boulder is one nobody can ever see or hit. See the note on `SHOULDER`.
 * - `pads` are `{ at, side }`: fraction of the lap, and lateral offset as a
 *   fraction of the half-width. On the track by construction.
 *
 * ## The rules every course here follows
 *
 * One loop, no forks, no dead ends and no crossings — a driver should never
 * have to decide which way the track goes, only how to take it. Straights long
 * enough to catch someone, at least one wide sweeper to try it on, and at least
 * one corner tight enough that arriving too fast costs more than the overtake
 * won. Shortcuts cut corners rather than necks (see `TrackShortcut`) and are
 * narrow enough to be a commitment.
 *
 * The rule that used to be hardest to keep — **no cutting from one part of the
 * lap to another** — is not kept here at all any more. It is structural: the
 * shoulder is clamped at build time so two parts of the lap never share
 * drivable ground (`track.ts:clampShoulders`). That is worth knowing before
 * moving a corner, because it means widening a track somewhere can quietly
 * narrow its shoulder somewhere else.
 *
 * `tracks.test.ts` holds the rest to account — every pad reachable, every grid
 * slot on the tarmac, no solid sitting in the middle of the racing line, no
 * stretch of course pinched down to no shoulder at all, and no route across
 * the middle that beats driving round.
 */

import type { DirtTrackDef } from './track';
import type { DirtTrackId } from './types';

export const DIRT_TRACK_IDS: DirtTrackId[] = ['canyon', 'grove', 'quarry', 'saltflat'];

export const DIRT_TRACKS: Record<DirtTrackId, DirtTrackDef> = {
  // ---------------------------------------------------------------------
  // Canyon Run — the tutorial. A big kidney with one hairpin at the far end
  // and a long enough main straight that a boost used on it is obvious.
  // ---------------------------------------------------------------------
  canyon: {
    id: 'canyon',
    name: 'Canyon Run',
    backdropUrl: '/stages/dirt/dirt_track_canyon.png',
    path: [
      { x: 300, y: 686, w: 124 },
      { x: 620, y: 686, w: 124 },
      { x: 980, y: 686, w: 124 },
      { x: 1280, y: 698, w: 112 },
      // The hairpin. Narrow on entry, so committing to the inside is a choice.
      { x: 1420, y: 540, w: 84 },
      { x: 1360, y: 372, w: 80 },
      { x: 1160, y: 316, w: 96 },
      { x: 980, y: 352, w: 104 },
      // A wide sweeper across the top — the overtaking place.
      { x: 800, y: 300, w: 124 },
      { x: 560, y: 214, w: 124 },
      { x: 340, y: 236, w: 120 },
      { x: 208, y: 380, w: 100 },
      { x: 198, y: 560, w: 108 },
    ],
    solids: [
      // **Off the road, never on it.** Each box's near face is pushed just past
      // the edge of the racing surface, so it lines the road rather than
      // standing in it: a car on the racing line never meets one, and a car
      // that runs wide onto the shoulder does. Boxes are kept small enough to
      // sit inside the shoulder — anything bigger ends up buried in the scenery,
      // which is already solid, and is then an obstacle nobody can ever see or
      // hit. `tracks.test.ts` fails on any box that touches the surface.
      { x: 867, y: 481, w: 68, h: 68 },
      { x: 1146, y: 427, w: 68, h: 68 },
      { x: 528, y: 364, w: 68, h: 68 },
      { x: 311, y: 423, w: 68, h: 68 },
      { x: 1411, y: 753, w: 68, h: 68 },
    ],
    pads: [
      { at: 0.14, side: -0.55 },
      { at: 0.14, side: 0.55 },
      { at: 0.42, side: 0 },
      { at: 0.63, side: -0.5 },
      { at: 0.63, side: 0.5 },
      { at: 0.86, side: 0 },
    ],
  },

  // ---------------------------------------------------------------------
  // Pine Grove — a fast perimeter loop with an S-bend spliced into the top
  // straight, so the quickest way round is a rhythm rather than a line. The
  // one shortcut cuts the inside of the long left-hand sweep.
  //
  // Everything stays on the perimeter on purpose. This track began as a figure
  // of eight joined by a neck, which is not a shape a 1600×900 arena can hold:
  // the two sides of the neck ended up three units apart, so the surfaces were
  // one blob and the "route" was unreadable. A loop that doubles back through
  // the middle needs the two lanes far enough apart to leave scenery between
  // them, and there is not room for both that and the loop.
  // ---------------------------------------------------------------------
  grove: {
    id: 'grove',
    name: 'Pine Grove',
    backdropUrl: '/stages/dirt/dirt_track_grove.png',
    path: [
      { x: 350, y: 690, w: 124 },
      { x: 660, y: 686, w: 124 },
      { x: 1000, y: 686, w: 124 },
      { x: 1290, y: 702, w: 108 },
      // Tight right-hander at the end of the main straight.
      { x: 1426, y: 566, w: 84 },
      { x: 1422, y: 388, w: 88 },
      // The S: down, then up. Narrow through both halves.
      { x: 1330, y: 258, w: 100 },
      { x: 1130, y: 292, w: 104 },
      { x: 910, y: 228, w: 104 },
      { x: 690, y: 214, w: 124 },
      { x: 470, y: 214, w: 124 },
      { x: 272, y: 214, w: 118 },
      { x: 196, y: 412, w: 108 },
      { x: 214, y: 574, w: 118 },
    ],
    shortcuts: [
      // Straight down the inside of the left sweep. Narrow, entered off the
      // racing line, and threaded by a pine halfway along — quick if you get
      // it, a stopped car if you arrive sideways.
      {
        path: [
          { x: 300, y: 268, w: 44 },
          { x: 292, y: 400, w: 42 },
          { x: 300, y: 530, w: 44 },
          { x: 330, y: 648, w: 46 },
        ],
      },
    ],
    solids: [
      // Pines lining the road, never in it. See the note on canyon's list.
      { x: 878, y: 821, w: 68, h: 68 },
      { x: 1211, y: 515, w: 68, h: 68 },
      { x: 1029, y: 406, w: 68, h: 68 },
      { x: 1450, y: 144, w: 68, h: 68 },
      { x: 807, y: 26, w: 68, h: 68 },
    ],
    pads: [
      { at: 0.06, side: -0.5 },
      { at: 0.06, side: 0.5 },
      { at: 0.26, side: 0 },
      { at: 0.46, side: -0.45 },
      { at: 0.46, side: 0.45 },
      { at: 0.68, side: 0 },
      { at: 0.86, side: -0.4 },
      { at: 0.86, side: 0.4 },
    ],
  },

  // ---------------------------------------------------------------------
  // Quarry — the technical one. A deep hairpin, a chicane on the top straight,
  // and machinery to hit. Narrow throughout, so contact is constant.
  // ---------------------------------------------------------------------
  quarry: {
    id: 'quarry',
    name: 'The Quarry',
    backdropUrl: '/stages/dirt/dirt_track_quarry.png',
    path: [
      { x: 340, y: 702, w: 108 },
      { x: 700, y: 698, w: 112 },
      { x: 1040, y: 706, w: 104 },
      { x: 1310, y: 718, w: 92 },
      // The hairpin, and the only place on any of these courses where the lap
      // doubles back on itself. It is a *turn*, not an out-and-back excursion,
      // and that distinction is what keeps it honest: going round costs about
      // as much distance as cutting across would, so there is nothing to gain
      // by trying. An excursion would need a barrier down its neck.
      { x: 1432, y: 590, w: 78 },
      { x: 1434, y: 400, w: 76 },
      { x: 1330, y: 268, w: 86 },
      { x: 1120, y: 190, w: 96 },
      // A chicane on the top straight: down, then up, both at speed.
      { x: 900, y: 258, w: 86 },
      { x: 700, y: 178, w: 88 },
      { x: 460, y: 198, w: 108 },
      { x: 250, y: 210, w: 100 },
      { x: 182, y: 430, w: 92 },
      { x: 190, y: 650, w: 100 },
    ],
    solids: [
      // Machinery and spoil lining the road, never in it. See canyon's note.
      { x: 1214, y: 549, w: 68, h: 68 },
      { x: 767, y: 513, w: 68, h: 64 },
      { x: 1100, y: 305, w: 68, h: 68 },
      { x: 527, y: 305, w: 68, h: 68 },
      { x: 284, y: 467, w: 68, h: 68 },
    ],
    pads: [
      { at: 0.1, side: -0.5 },
      { at: 0.1, side: 0.5 },
      { at: 0.3, side: 0 },
      { at: 0.46, side: -0.5 },
      { at: 0.46, side: 0.5 },
      { at: 0.68, side: 0 },
      { at: 0.86, side: 0 },
    ],
  },

  // ---------------------------------------------------------------------
  // Salt Flat — the fast one. Wide everywhere, two enormous sweepers, almost
  // nothing solid. This is the track where powerups decide the race, because
  // there is nowhere anyone is forced to slow down.
  // ---------------------------------------------------------------------
  saltflat: {
    id: 'saltflat',
    name: 'Salt Flat',
    backdropUrl: '/stages/dirt/dirt_track_saltflat.png',
    path: [
      { x: 300, y: 686, w: 124 },
      { x: 640, y: 686, w: 124 },
      { x: 1000, y: 686, w: 124 },
      { x: 1300, y: 686, w: 124 },
      { x: 1394, y: 520, w: 116 },
      // One genuinely tight corner, at the far end of the fastest straight.
      { x: 1400, y: 340, w: 86 },
      { x: 1200, y: 270, w: 104 },
      { x: 1000, y: 300, w: 124 },
      { x: 760, y: 268, w: 124 },
      { x: 500, y: 214, w: 124 },
      { x: 260, y: 226, w: 124 },
      { x: 212, y: 400, w: 122 },
      { x: 214, y: 570, w: 124 },
    ],
    shortcuts: [
      // Straight across the inside of the long left-hander. Wide open salt,
      // no rocks — but it is offroad either side, so getting the entry wrong
      // costs more than the cut saves.
      {
        path: [
          { x: 250, y: 300, w: 52 },
          { x: 196, y: 420, w: 50 },
          { x: 214, y: 560, w: 52 },
          { x: 292, y: 664, w: 54 },
        ],
      },
    ],
    solids: [
      // Salt pillars lining the road, never in it. See canyon's note.
      { x: 1077, y: 485, w: 68, h: 68 },
      { x: 1530, y: 463, w: 68, h: 68 },
      { x: 671, y: 40, w: 68, h: 68 },
      { x: 1121, y: 407, w: 68, h: 68 },
    ],
    pads: [
      { at: 0.12, side: -0.6 },
      { at: 0.12, side: 0 },
      { at: 0.12, side: 0.6 },
      { at: 0.34, side: -0.5 },
      { at: 0.34, side: 0.5 },
      { at: 0.62, side: 0 },
      { at: 0.84, side: -0.55 },
      { at: 0.84, side: 0.55 },
    ],
  },
};

/**
 * The track for a config value, resolving `random` against a seed.
 *
 * The seed is the race seed, so a match set to `random` gets a different course
 * every race rather than the same one drawn once.
 */
export function getDirtTrack(id: DirtTrackId | 'random', seed = 0): DirtTrackDef {
  if (id === 'random' || !DIRT_TRACKS[id]) {
    const chosen = DIRT_TRACK_IDS[Math.abs(seed) % DIRT_TRACK_IDS.length]!;
    return DIRT_TRACKS[chosen];
  }
  return DIRT_TRACKS[id];
}
