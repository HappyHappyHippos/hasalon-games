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
    // Red rock and dry scrub: hot, dusty, high desert.
    palette: {
      scenery: '#6a3b28',
      sceneryDetail: '#5b3122',
      prop: '#8a4c33',
      propShade: '#6d3a25',
      offroad: '#9a6440',
      track: '#c08a55',
      trackWorn: '#b07c4b',
      solid: '#8d5136',
      solidTop: '#a9663f',
    },
    backdropUrl: '/stages/dirt/dirt_track_canyon.png',
    path: [
      // The main straight: the longest and widest thing on any of the four, so
      // a boost spent here is visible from the other end of it.
      { x: 560, y: 730, w: 132 },
      { x: 900, y: 730, w: 126 },
      { x: 1190, y: 704, w: 112 },
      // Fast right onto the back straight — takeable flat, and the first place
      // anyone finds out that flat is not the same as fastest.
      { x: 1384, y: 592, w: 90 },
      { x: 1438, y: 404, w: 84 },
      { x: 1330, y: 258, w: 84 },
      { x: 1126, y: 214, w: 100 },
      // The notch. The lap turns its back on the perimeter and dives into the
      // middle of the arena, which is what stops this being another ring road:
      // the apex is four hundred units from both straights, so the shape you
      // are driving is legible from anywhere on it.
      { x: 966, y: 330, w: 92 },
      { x: 818, y: 398, w: 86 },
      { x: 654, y: 322, w: 92 },
      { x: 516, y: 206, w: 104 },
      { x: 320, y: 184, w: 110 },
      // Long left onto the start straight. Opens on exit, so there is a run to
      // the line for whoever got it right.
      { x: 176, y: 322, w: 88 },
      { x: 158, y: 486, w: 96 },
      { x: 214, y: 634, w: 108 },
      { x: 356, y: 722, w: 126 },
    ],
    solids: [
      // Empty on purpose — see the note above `DIRT_TRACKS`. The rocks that
      // used to line this road are drawn scenery now, not collision.
    ],
    pads: [
      { at: 0.16, side: -0.55 },
      { at: 0.4, side: 0 },
      { at: 0.58, side: 0.5 },
      { at: 0.84, side: 0 },
    ],
  },

  // ---------------------------------------------------------------------
  // Pine Grove — the dumbbell. Two big lobes at either end of the arena, and a
  // neck between them the lap crosses twice in opposite directions with a
  // stand of pines down the middle.
  //
  // This is the shape the track was originally meant to have and could not: it
  // began as a figure of eight, which needs a crossing, and then as a neck so
  // narrow that its two sides were three units apart and the surfaces merged
  // into one unreadable blob. What makes it work now is simply giving the neck
  // room — the two runs are ~290 units apart, which after `clampShoulders` has
  // taken its cut still leaves a visible strip of forest between them. Anything
  // under about 270 and there is nothing left to draw.
  // ---------------------------------------------------------------------
  grove: {
    id: 'grove',
    name: 'Pine Grove',
    // Pine forest: deep green, cool shade, brown loam underfoot.
    palette: {
      scenery: '#22371f',
      sceneryDetail: '#1b2d19',
      prop: '#2f4a29',
      propShade: '#233c1e',
      offroad: '#4e6b32',
      track: '#a3784c',
      trackWorn: '#946c44',
      solid: '#35502c',
      solidTop: '#446435',
    },
    backdropUrl: '/stages/dirt/dirt_track_grove.png',
    path: [
      // Start along the bottom of the left lobe, running right into the lower
      // neck. Wide here and narrowing all the way in, so the field sorts itself
      // out before the trees rather than in them.
      { x: 336, y: 744, w: 122 },
      { x: 520, y: 716, w: 110 },
      { x: 672, y: 630, w: 94 },
      { x: 880, y: 612, w: 92 },
      { x: 1072, y: 654, w: 98 },
      // Round the right lobe.
      { x: 1244, y: 748, w: 110 },
      { x: 1404, y: 652, w: 94 },
      { x: 1446, y: 470, w: 92 },
      { x: 1392, y: 288, w: 94 },
      { x: 1230, y: 186, w: 110 },
      // Back through the upper neck, the other way. The pines between the two
      // runs are the only thing on this course you can see the rest of the race
      // through, which is most of why it is the one people remember.
      { x: 1048, y: 246, w: 98 },
      { x: 856, y: 314, w: 92 },
      { x: 664, y: 328, w: 94 },
      { x: 506, y: 234, w: 110 },
      // Round the left lobe and back to the line.
      { x: 320, y: 178, w: 122 },
      { x: 168, y: 300, w: 100 },
      { x: 150, y: 490, w: 100 },
      { x: 196, y: 664, w: 112 },
    ],
    shortcuts: [
      // A chord across the bottom corner of the right lobe. It cuts a *bend*,
      // never the neck — a cut across the neck would put the nearest point on
      // the far run, which `MAX_PROGRESS_JUMP` throws away as a teleport, so
      // the driver would lose the corner rather than gain it. See the note on
      // `TrackShortcut`.
      //
      // Worth about half a second of a ten-second lap — the most any route on
      // these four courses is allowed to be (`tracks.test.ts`) — and paid for
      // by being barely wider than a car, entered off the racing line, and
      // rejoining on the outside of the next corner.
      {
        path: [
          { x: 1160, y: 664, w: 48 },
          { x: 1300, y: 596, w: 44 },
          { x: 1420, y: 500, w: 48 },
        ],
      },
    ],
    solids: [
      // Empty on purpose; the pines are scenery. See canyon's note.
    ],
    pads: [
      { at: 0.1, side: -0.5 },
      { at: 0.3, side: 0 },
      { at: 0.52, side: 0.45 },
      { at: 0.72, side: 0 },
      { at: 0.9, side: -0.4 },
    ],
  },

  // ---------------------------------------------------------------------
  // The Quarry — the technical one, and the only course that spends part of
  // its lap inside its own infield. A short run off the line turns up into a
  // tongue that climbs into the middle of the arena, doubles back, and drops
  // onto the main straight facing the hairpin.
  //
  // The tongue is what makes this track, and its two legs are ~260 units apart
  // for a reason: that is the least that survives `clampShoulders` with a strip
  // of spoil left between them. Narrow it and the two runs merge into one wide
  // patch of nothing, which is the failure Pine Grove was rebuilt out of.
  //
  // Everything here is narrower than the other three. There is nowhere on this
  // lap where two cars are comfortable side by side, which is the point.
  // ---------------------------------------------------------------------
  quarry: {
    id: 'quarry',
    name: 'The Quarry',
    // Cut stone and grey spoil. The bleakest of the four, deliberately.
    palette: {
      scenery: '#3b3a3d',
      sceneryDetail: '#323134',
      prop: '#4d4b4f',
      propShade: '#3e3c40',
      offroad: '#6b6660',
      track: '#948c81',
      trackWorn: '#877f74',
      solid: '#59565a',
      solidTop: '#6e6a6d',
    },
    backdropUrl: '/stages/dirt/dirt_track_quarry.png',
    path: [
      { x: 268, y: 752, w: 104 },
      { x: 520, y: 758, w: 100 },
      // Up into the infield. Arriving here too fast is the single most common
      // way to lose this race, because the entry tightens and there is no room
      // to run wide — the spoil heap is right there.
      { x: 676, y: 694, w: 86 },
      { x: 716, y: 566, w: 78 },
      { x: 792, y: 482, w: 76 },
      { x: 936, y: 474, w: 76 },
      { x: 1036, y: 556, w: 78 },
      { x: 1076, y: 684, w: 88 },
      // Back out onto the main straight, pointed at the hairpin.
      { x: 1156, y: 752, w: 98 },
      { x: 1330, y: 744, w: 96 },
      { x: 1448, y: 606, w: 82 },
      { x: 1444, y: 404, w: 80 },
      { x: 1340, y: 252, w: 86 },
      // The top straight is the only place on the lap anybody rests.
      { x: 1140, y: 172, w: 92 },
      { x: 880, y: 164, w: 90 },
      { x: 620, y: 172, w: 90 },
      { x: 378, y: 190, w: 94 },
      { x: 196, y: 330, w: 88 },
      { x: 172, y: 530, w: 92 },
      { x: 200, y: 676, w: 100 },
    ],
    solids: [
      // Empty on purpose; the machinery is scenery. See canyon's note.
    ],
    pads: [
      { at: 0.12, side: -0.5 },
      { at: 0.3, side: 0 },
      { at: 0.5, side: 0.5 },
      { at: 0.78, side: 0 },
    ],
  },

  // ---------------------------------------------------------------------
  // Salt Flat — the fast one, and the only course that is not a ring. It is a
  // rounded triangle: three enormous sweepers taken flat out, meeting at three
  // corners of very different character — a long-radius kink, a wide open
  // double-apex, and one genuinely slow hairpin where the whole lap is decided.
  //
  // Wide everywhere, because there is nothing here to make anybody lift and the
  // race has to be decided by racing rather than by the road. This is the track
  // where powerups matter most, for exactly that reason.
  // ---------------------------------------------------------------------
  saltflat: {
    id: 'saltflat',
    name: 'Salt Flat',
    // Bleached salt and pale sand — bright, flat, and hard to judge distance on.
    palette: {
      scenery: '#cfc7ae',
      sceneryDetail: '#c2b9a0',
      prop: '#ded7c2',
      propShade: '#c9c1a8',
      offroad: '#d8d0b8',
      track: '#b79b6f',
      trackWorn: '#a98d62',
      solid: '#e6dfcc',
      solidTop: '#f2ecdd',
    },
    backdropUrl: '/stages/dirt/dirt_track_saltflat.png',
    path: [
      // The bottom edge of the triangle, and the fastest ground in the game.
      { x: 470, y: 728, w: 128 },
      { x: 780, y: 738, w: 128 },
      { x: 1090, y: 726, w: 126 },
      // Corner one: a long-radius kink onto the right-hand edge. Flat out, and
      // it does not feel like a corner until the exit runs out of room.
      { x: 1318, y: 672, w: 116 },
      { x: 1428, y: 508, w: 108 },
      { x: 1382, y: 356, w: 104 },
      // Corner two: the wide double-apex down off the top vertex. Two lines
      // through it, and they cross — which is the only place on the four
      // courses where the overtake and the defence are the same piece of road.
      { x: 1214, y: 236, w: 120 },
      { x: 1024, y: 186, w: 126 },
      { x: 846, y: 172, w: 126 },
      { x: 654, y: 206, w: 120 },
      // The long diagonal back down to the hairpin.
      { x: 470, y: 292, w: 124 },
      { x: 318, y: 404, w: 114 },
      // Corner three: the hairpin. The one slow corner on the course, at the
      // end of its longest run — so it is where a boost is worth spending and
      // where a mine is worth leaving.
      { x: 196, y: 540, w: 88 },
      { x: 228, y: 674, w: 96 },
      { x: 338, y: 734, w: 116 },
    ],
    shortcuts: [
      // Across the inside of the first corner, off the end of the main
      // straight. Wide open salt with nothing on it, which is the joke: the cut
      // is free to look at and expensive to get wrong, because it is entered at
      // the fastest point on the fastest course and there is no run-off on the
      // far side of it. Worth about a third of a second.
      {
        path: [
          { x: 1104, y: 718, w: 54 },
          { x: 1276, y: 592, w: 50 },
          { x: 1384, y: 398, w: 54 },
        ],
      },
    ],
    solids: [
      // Empty on purpose; the salt pillars are scenery. See canyon's note.
    ],
    pads: [
      { at: 0.14, side: 0 },
      { at: 0.36, side: -0.5 },
      { at: 0.6, side: 0 },
      { at: 0.82, side: 0.55 },
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
