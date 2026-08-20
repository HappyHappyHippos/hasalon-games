/**
 * The courses, held to the rules `tracks.ts` claims they follow.
 *
 * Everything here is a property of the *shape*, checked by sampling the real
 * geometry rather than by eyeballing coordinates — because the coordinates are
 * control points and what matters is the curve they produce. Each of these
 * caught something real while the tracks were being authored, and the notes say
 * what.
 */

import { describe, expect, it } from 'vitest';
import {
  CAR_R,
  OFFROAD_TOP_SPEED,
  PAD_R,
  PROGRESS_WINDOW,
  TRACK_TOP_SPEED,
  TURN_RATE,
} from './constants';
import { DIRT_TRACKS, DIRT_TRACK_IDS, getDirtTrack } from './tracks';
import {
  corridorAt,
  gridSlots,
  insideSolid,
  loopDelta,
  pointAt,
  surfaceAt,
  trackGeometry,
} from './track';
import { MAX_PLAYERS } from './constants';

const TRACKS = DIRT_TRACK_IDS.map((id) => [id, trackGeometry(DIRT_TRACKS[id])] as const);

/**
 * How much time any alternative route may save, in seconds.
 *
 * A lap is about ten seconds, so this is roughly a twentieth of one — enough
 * for an authored shortcut to be worth taking, nowhere near enough for a route
 * that skips the driving.
 */
const MAX_SHORTCUT_SECONDS = 0.6;

describe.each(TRACKS)('%s', (id, geometry) => {
  it('is a closed loop of a sensible length', () => {
    // Short enough that three laps is a race, long enough to have a shape.
    expect(geometry.length).toBeGreaterThan(2400);
    expect(geometry.length).toBeLessThan(6000);

    const first = geometry.outline[0]!;
    const last = geometry.outline[geometry.outline.length - 1]!;
    // The ribbon is the closed centreline, so its ends must meet — an open one
    // would leave the renderer drawing a seam and `loopDelta` measuring across
    // a gap that is not there.
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeLessThan(60);
  });

  it('never runs its racing line through a solid', () => {
    for (let u = 0; u < geometry.length; u += 6) {
      const at = pointAt(geometry, u);
      expect(
        insideSolid(geometry, at.x, at.y, CAR_R),
        `centreline blocked at (${Math.round(at.x)}, ${Math.round(at.y)})`,
      ).toBe(false);
    }
  });

  it('puts every grid slot on the track', () => {
    // The grid is derived from the centreline, so this is really a check that
    // the start/finish straight is wide enough and long enough for a full field.
    for (const [index, slot] of gridSlots(geometry, MAX_PLAYERS).entries()) {
      expect(
        surfaceAt(geometry, slot.x, slot.y),
        `grid slot ${index} at (${Math.round(slot.x)}, ${Math.round(slot.y)})`,
      ).toBe('track');
    }
  });

  it('keeps every solid object off the racing surface', () => {
    // Obstacles line the road, they do not stand in it. A rock on the racing
    // line is not a hazard to drive around, it is a wall in the middle of the
    // only place you are allowed to be.
    for (const [index, box] of geometry.solids.entries()) {
      for (let sx = 0; sx <= 8; sx += 1) {
        for (let sy = 0; sy <= 8; sy += 1) {
          const x = box.x + (box.w * sx) / 8;
          const y = box.y + (box.h * sy) / 8;
          const hit = corridorAt(geometry, x, y);
          expect(
            hit.dist > hit.half,
            `solid ${index} covers the surface at (${Math.round(x)}, ${Math.round(y)})`,
          ).toBe(true);
        }
      }
    }
  });

  it('keeps every solid object somewhere a car can actually reach it', () => {
    // The mirror image: a box entirely past the shoulder is buried in scenery
    // that is already solid, so it is decoration nobody can ever hit.
    for (const [index, box] of geometry.solids.entries()) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      expect(
        corridorAt(geometry, cx, cy).outside,
        `solid ${index} is buried in the scenery`,
      ).toBeLessThan(box.w);
    }
  });

  it('puts every powerup pad somewhere a car can reach', () => {
    for (const [index, pad] of geometry.pads.entries()) {
      expect(surfaceAt(geometry, pad.x, pad.y), `pad ${index} surface`).toBe('track');
      // Not merely *on* the track — reachable without scraping a rock to get
      // there, which is what "sensible placement" has to mean.
      expect(insideSolid(geometry, pad.x, pad.y, PAD_R + CAR_R), `pad ${index} blocked`).toBe(false);
    }
  });

  it('leaves a shoulder everywhere', () => {
    // A zero shoulder means two parts of the lap are so close that the clamp
    // ran out of room — the surfaces themselves are nearly touching, which is
    // an authoring error rather than a tight corner. See `clampShoulders`.
    for (const seg of geometry.main.segments) {
      expect(seg.shoulder, `shoulder at (${Math.round(seg.x0)}, ${Math.round(seg.y0)})`)
        .toBeGreaterThan(20);
    }
  });

  /**
   * The one that matters most, and the one that was hardest to satisfy.
   *
   * Every pair of points far enough apart along the lap to be worth cutting
   * between is checked: if the straight line between them is drivable at all,
   * how much time does taking it save?
   *
   * The bound rather than zero, because **shortcuts are a feature**. An authored
   * shortcut is by definition a drivable route between two parts of the lap, so
   * a zero-tolerance version of this test forbids the thing `tracks.ts` sets out
   * to provide. What must not exist is a route that makes driving the course
   * optional — so the assertion is that the best alternative anywhere on any
   * track is worth a fraction of a lap, not most of one.
   *
   * Before the shoulder clamp existed every track failed this badly: Canyon Run
   * had fifty-one distinct crossings of its own infield, and the ceiling below
   * is roughly a twentieth of a lap.
   */
  it('has no route that beats driving the course', () => {
    let best = { saved: 0, from: '', to: '' };

    for (let u = 0; u < geometry.length; u += 14) {
      const a = pointAt(geometry, u);
      for (let v = 0; v < geometry.length; v += 14) {
        // The signed *shortest* arc: progress measures the short way round, so
        // a point "most of a lap ahead" is really just behind, and jumping to
        // it loses progress rather than gaining it.
        const ahead = loopDelta(u, v, geometry.length);
        if (ahead < PROGRESS_WINDOW) continue;

        const b = pointAt(geometry, v);
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        // Generous to the cheat: assume the whole crossing is taken at offroad
        // speed with no time lost turning into it or rejoining.
        const saved = ahead / TRACK_TOP_SPEED - gap / OFFROAD_TOP_SPEED;
        if (saved <= best.saved) continue;
        if (!drivableLine(geometry, a, b)) continue;

        best = {
          saved,
          from: `(${Math.round(a.x)},${Math.round(a.y)})`,
          to: `(${Math.round(b.x)},${Math.round(b.y)})`,
        };
      }
    }

    expect(
      best.saved,
      `best alternative route ${best.from} → ${best.to} saves ${best.saved.toFixed(2)}s`,
    ).toBeLessThan(MAX_SHORTCUT_SECONDS);
  });

  it('has no corner too tight for a car to get round', () => {
    // A car at full speed sweeps `TRACK_TOP_SPEED / TURN_RATE`. Corners tighter
    // than that are taken by scrubbing speed off (see `CORNER_DRAG`), but a
    // *kink* — a curvature spike from two control points crowding each other —
    // is not a corner, it is a wall the car cannot avoid. Half the full-speed
    // radius is the line between the two.
    const floor = TRACK_TOP_SPEED / TURN_RATE / 2;
    let tightest = { r: Infinity, x: 0, y: 0 };

    for (let u = 0; u < geometry.length; u += 10) {
      const r = radiusAt(geometry, u);
      if (r < tightest.r) {
        const at = pointAt(geometry, u);
        tightest = { r, x: at.x, y: at.y };
      }
    }

    expect(
      tightest.r,
      `tightest corner is r=${tightest.r.toFixed(0)} at (${Math.round(tightest.x)}, ${Math.round(tightest.y)})`,
    ).toBeGreaterThan(floor);
  });

  it('spends most of itself on track rather than on scenery', () => {
    // A sanity check on proportions: a course that is 20% racing surface has
    // become a corridor, and one that is 80% has lost its shoulders.
    let track = 0;
    let total = 0;
    for (let y = 8; y < 900; y += 16) {
      for (let x = 8; x < 1600; x += 16) {
        if (surfaceAt(geometry, x, y) === 'track') track += 1;
        total += 1;
      }
    }
    const fraction = track / total;
    expect(fraction).toBeGreaterThan(0.3);
    expect(fraction).toBeLessThan(0.75);
  });

  it('agrees with its own id', () => {
    expect(geometry.id).toBe(id);
    expect(DIRT_TRACKS[id].path.length).toBeGreaterThanOrEqual(8);
  });
});

describe('getDirtTrack', () => {
  it('returns the named track', () => {
    for (const id of DIRT_TRACK_IDS) expect(getDirtTrack(id).id).toBe(id);
  });

  it('resolves random from the seed, and covers the whole roster', () => {
    const seen = new Set(
      Array.from({ length: 64 }, (_, i) => getDirtTrack('random', i).id),
    );
    expect([...seen].sort()).toEqual([...DIRT_TRACK_IDS].sort());
  });

  it('falls back rather than throwing on an unknown id', () => {
    expect(DIRT_TRACK_IDS).toContain(getDirtTrack('nope' as never, 3).id);
  });
});

// ---------------------------------------------------------------------------

/** Can a car drive this straight line without meeting scenery? */
function drivableLine(
  geometry: ReturnType<typeof trackGeometry>,
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  const steps = Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / 8);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    if (surfaceAt(geometry, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) === 'solid') return false;
  }
  return true;
}

/** Menger curvature radius from three points spaced along the arc. */
function radiusAt(geometry: ReturnType<typeof trackGeometry>, u: number): number {
  const step = 24;
  const a = pointAt(geometry, u - step);
  const b = pointAt(geometry, u);
  const c = pointAt(geometry, u + step);
  const ab = Math.hypot(b.x - a.x, b.y - a.y);
  const bc = Math.hypot(c.x - b.x, c.y - b.y);
  const ca = Math.hypot(a.x - c.x, a.y - c.y);
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  return area < 1e-6 ? Infinity : (ab * bc * ca) / (4 * area);
}
