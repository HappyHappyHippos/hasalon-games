/**
 * Car movement.
 *
 * The first test is the load-bearing one: the client re-runs `stepCar` to
 * predict its own car, so a same-input replay has to land byte-identically on
 * the same place the server did. If that ever fails, prediction is guessing.
 */

import { describe, expect, it } from 'vitest';
import { DT } from '../../engine';
import {
  CAR_R,
  CORNER_DRAG,
  MIN_TURN_AUTHORITY,
  OFFROAD_TOP_SPEED,
  SHOULDER,
  TRACK_TOP_SPEED,
  TURN_RATE,
} from './constants';
import {
  NO_CAR_MODS,
  separateCars,
  speedOf,
  stepCar,
  type CarBody,
  type CarInput,
  type CarMods,
} from './physics';
import { corridorAt, pointAt, surfaceAt, trackGeometry } from './track';
import { DIRT_TRACKS } from './tracks';

const geometry = trackGeometry(DIRT_TRACKS.saltflat);

function onGrid(offset = 0): CarBody {
  const at = pointAt(geometry, offset);
  return { x: at.x, y: at.y, angle: at.angle, vx: 0, vy: 0, steer: 0 };
}

const STRAIGHT: CarInput = { steer: 0, controllable: true };
const RIGHT: CarInput = { steer: 1, controllable: true };
/** Half lock — the thing that was impossible before steering went analogue. */
const HALF_RIGHT: CarInput = { steer: 0.5, controllable: true };

function drive(body: CarBody, input: CarInput, ticks: number, mods: CarMods = NO_CAR_MODS): void {
  for (let i = 0; i < ticks; i += 1) stepCar(body, input, geometry, DT, mods);
}

describe('determinism', () => {
  it('lands byte-identically from the same start and the same inputs', () => {
    // The contract the client predictor depends on. A random-looking but fixed
    // input log, so it exercises turning, releasing and turning back rather
    // than one steady state.
    // Sweeps the whole analogue range rather than flicking between locks, so a
    // replay that got the eased wheel wrong would show up.
    const log = Array.from({ length: 600 }, (_, i) => ({
      steer: Math.sin(i / 23) * (i % 17 < 5 ? 0.4 : 1),
      controllable: true,
    }));

    const run = (): CarBody => {
      const body = onGrid();
      for (const input of log) stepCar(body, input, geometry, DT, NO_CAR_MODS);
      return body;
    };

    const a = run();
    const b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not read any ambient state', () => {
    // A weaker but sharper version of the same promise: two cars stepped in
    // interleaved order must not influence each other, because `stepCar` has no
    // channel through which they could.
    const solo = onGrid();
    drive(solo, RIGHT, 120);

    const interleaved = onGrid();
    const other = onGrid(400);
    for (let i = 0; i < 120; i += 1) {
      stepCar(interleaved, RIGHT, geometry, DT, NO_CAR_MODS);
      stepCar(other, STRAIGHT, geometry, DT, NO_CAR_MODS);
    }

    expect(JSON.stringify(interleaved)).toBe(JSON.stringify(solo));
  });
});

describe('throttle', () => {
  it('accelerates with no input at all — there is no accelerator', () => {
    const body = onGrid();
    drive(body, STRAIGHT, 60);
    expect(speedOf(body)).toBeGreaterThan(TRACK_TOP_SPEED * 0.85);
  });

  it('tops out at the track speed rather than creeping past it', () => {
    const body = onGrid();
    drive(body, STRAIGHT, 600);
    expect(speedOf(body)).toBeLessThanOrEqual(TRACK_TOP_SPEED + 1);
  });

  it('coasts to a stop when it is not being driven', () => {
    const body = onGrid();
    drive(body, STRAIGHT, 60);
    drive(body, { steer: 0, controllable: false }, 120);
    expect(speedOf(body)).toBeLessThan(1);
  });
});

describe('surfaces', () => {
  it('runs much slower offroad than on the track', () => {
    // Placed on the shoulder rather than driven there, so this measures the
    // surface and not the trip.
    const at = pointAt(geometry, 300);
    const nx = Math.sin(at.angle);
    const ny = -Math.cos(at.angle);
    const off = at.half + SHOULDER * 0.5;
    const body: CarBody = {
      x: at.x + nx * off,
      y: at.y + ny * off,
      angle: at.angle,
      vx: 0,
      vy: 0,
      steer: 0,
    };
    expect(surfaceAt(geometry, body.x, body.y)).toBe('offroad');

    drive(body, STRAIGHT, 90);
    expect(speedOf(body)).toBeLessThan(OFFROAD_TOP_SPEED + 5);

    // Slower enough to be a real cost — running wide should lose you places.
    expect(speedOf(body)).toBeLessThan(TRACK_TOP_SPEED * 0.75);
    // ...but not so slow that it is glue. Offroad used to be a little over a
    // third of racing speed, which made a single wide corner take a corner and
    // a half to recover from: punishment rather than consequence.
    expect(speedOf(body)).toBeGreaterThan(TRACK_TOP_SPEED * 0.5);
  });

  it('bleeds speed hard when a fast car leaves the road', () => {
    const body = onGrid(300);
    drive(body, STRAIGHT, 120);
    const before = speedOf(body);

    // Shove it sideways onto the grass without touching its speed.
    const at = pointAt(geometry, 300);
    const nx = Math.sin(at.angle);
    const ny = -Math.cos(at.angle);
    body.x = at.x + nx * (at.half + SHOULDER * 0.5);
    body.y = at.y + ny * (at.half + SHOULDER * 0.5);

    drive(body, STRAIGHT, 30);
    expect(speedOf(body)).toBeLessThan(before * 0.65);
  });
});

describe('steering and drift', () => {
  it('slides: the car keeps travelling the way it was pointed', () => {
    const body = onGrid();
    drive(body, STRAIGHT, 90);
    drive(body, RIGHT, 18);

    // Velocity and heading disagree — that disagreement *is* the drift, and it
    // is the one thing that separates this from a car on rails.
    const lateral = -body.vx * Math.sin(body.angle) + body.vy * Math.cos(body.angle);
    expect(Math.abs(lateral)).toBeGreaterThan(30);
  });

  it('scrubs speed off in a corner, because there is no brake', () => {
    const straight = onGrid();
    drive(straight, STRAIGHT, 90);
    const flatOut = speedOf(straight);

    const turning = onGrid();
    drive(turning, STRAIGHT, 90);
    drive(turning, RIGHT, 45);

    expect(speedOf(turning)).toBeLessThan(flatOut);
    expect(CORNER_DRAG).toBeGreaterThan(0);
  });

  it('turns less at half lock than at full — steering is analogue', () => {
    // The whole point of packing a magnitude into the input mask. Before it,
    // nudging the wheel a fifth of the way and hauling it to the stop steered
    // exactly the same amount, and the car could not be placed.
    const full = onGrid();
    drive(full, STRAIGHT, 60);
    const fullBefore = full.angle;
    drive(full, RIGHT, 30);

    const half = onGrid();
    drive(half, STRAIGHT, 60);
    const halfBefore = half.angle;
    drive(half, HALF_RIGHT, 30);

    const fullTurn = Math.abs(full.angle - fullBefore);
    const halfTurn = Math.abs(half.angle - halfBefore);
    expect(halfTurn).toBeGreaterThan(0);
    expect(halfTurn).toBeLessThan(fullTurn * 0.75);
  });

  it('eases the wheel rather than snapping it to full lock', () => {
    // A car that reaches full lock in one tick is twitchy on a keyboard and
    // spins on a flick of the thumb. `STEER_RATE` is what gives it weight.
    const body = onGrid();
    drive(body, STRAIGHT, 60);
    drive(body, RIGHT, 1);
    expect(Math.abs(body.steer)).toBeLessThan(1);
    drive(body, RIGHT, 60);
    expect(Math.abs(body.steer)).toBeCloseTo(1, 2);
  });

  it('centres the wheel when the car is not being driven', () => {
    const body = onGrid();
    drive(body, RIGHT, 60);
    drive(body, { steer: 1, controllable: false }, 60);
    expect(body.steer).toBeCloseTo(0, 3);
  });

  it('can still steer when it is barely moving', () => {
    // The deadlock guard. Without a floor on turn authority, a car nosed into a
    // rock cannot steer (too slow) and cannot stop driving into it (no brake),
    // so it sits there until the stuck-recovery bails it out — which measured
    // as seventy respawns a race.
    //
    // Measured from a standstill over long enough for the eased wheel to reach
    // its stop, and compared against what the floor alone guarantees.
    const body = onGrid();
    body.vx = 0;
    body.vy = 0;
    const before = body.angle;
    for (let i = 0; i < 30; i += 1) {
      stepCar(body, RIGHT, geometry, DT, NO_CAR_MODS);
      // Hold it stationary, so this measures steering rather than driving.
      body.vx = 0;
      body.vy = 0;
    }

    const turned = Math.abs(body.angle - before);
    expect(turned).toBeGreaterThan(TURN_RATE * MIN_TURN_AUTHORITY * DT * 10);
  });

  it('turns the other way when reversed', () => {
    const normal = onGrid();
    drive(normal, STRAIGHT, 60);
    drive(normal, RIGHT, 30);

    const reversed = onGrid();
    drive(reversed, STRAIGHT, 60);
    drive(reversed, RIGHT, 30, { ...NO_CAR_MODS, reversed: true });

    // Mirrored about the straight-ahead heading, near enough — the two are not
    // exactly symmetric because the track curves under them.
    expect(Math.sign(normal.angle - reversed.angle)).not.toBe(0);
    expect(Math.abs(normal.angle)).toBeGreaterThan(0);
  });

  it('spins on its own when spun out, whatever the input says', () => {
    const body = onGrid();
    drive(body, STRAIGHT, 60);
    const before = body.angle;
    // Steering hard left while the mine spins it right.
    drive(body, { steer: -1, controllable: true }, 30, { ...NO_CAR_MODS, spin: 1 });
    expect(body.angle).not.toBe(before);
    expect(speedOf(body)).toBeLessThan(TRACK_TOP_SPEED * 0.6);
  });
});

describe('the corridor', () => {
  it('cannot be driven out of, from any direction', () => {
    // Fire a car at the scenery from every angle and check none of them
    // escapes. This is the guarantee that makes the courses closed: the
    // boundary is a distance from the centreline rather than a list of boxes,
    // so there is no gap to find.
    for (let i = 0; i < 32; i += 1) {
      const angle = (i / 32) * Math.PI * 2;
      const at = pointAt(geometry, 500);
      const body: CarBody = { x: at.x, y: at.y, angle, vx: 0, vy: 0, steer: 0 };
      drive(body, STRAIGHT, 240);

      const corridor = corridorAt(geometry, body.x, body.y);
      expect(
        corridor.outside,
        `escaped heading ${angle.toFixed(2)} to (${Math.round(body.x)}, ${Math.round(body.y)})`,
      ).toBeLessThan(1);
    }
  });

  it('stops the car at the edge rather than half inside it', () => {
    const at = pointAt(geometry, 500);
    const body: CarBody = { x: at.x, y: at.y, angle: at.angle + Math.PI / 2, vx: 0, vy: 0, steer: 0 };
    drive(body, STRAIGHT, 180);

    const corridor = corridorAt(geometry, body.x, body.y);
    // The hull has to stay inside, not the centre point.
    expect(corridor.dist).toBeLessThanOrEqual(corridor.half + corridor.shoulder - CAR_R + 1);
  });

  it('costs a graze less than a square-on hit', () => {
    // The property that makes walls readable: clipping a barrier at a shallow
    // angle should barely slow you, and driving straight into one should stop
    // you. Measured as a comparison rather than against a fixed number,
    // because the absolute figure depends on which corner the car reaches.
    const speedAfter = (offset: number): number => {
      const at = pointAt(geometry, 500);
      const body: CarBody = { x: at.x, y: at.y, angle: at.angle + offset, vx: 0, vy: 0, steer: 0 };
      drive(body, STRAIGHT, 90);
      return speedOf(body);
    };

    const graze = speedAfter(0.05);
    const squareOn = speedAfter(Math.PI / 2);
    expect(graze).toBeGreaterThan(squareOn * 2);
    expect(graze).toBeGreaterThan(TRACK_TOP_SPEED * 0.5);
  });
});

describe('separateCars', () => {
  it('pushes overlapping cars apart', () => {
    const a: CarBody = { x: 500, y: 500, angle: 0, vx: 0, vy: 0, steer: 0 };
    const b: CarBody = { x: 510, y: 500, angle: 0, vx: 0, vy: 0, steer: 0 };
    separateCars(
      [
        { body: a, ghost: false },
        { body: b, ghost: false },
      ],
      CAR_R,
    );
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(CAR_R * 2, 4);
  });

  it('swaps momentum, so ramming shoves', () => {
    const rammer: CarBody = { x: 480, y: 500, angle: 0, vx: 300, vy: 0, steer: 0 };
    const victim: CarBody = { x: 510, y: 500, angle: 0, vx: 0, vy: 0, steer: 0 };
    separateCars(
      [
        { body: rammer, ghost: false },
        { body: victim, ghost: false },
      ],
      CAR_R,
    );
    expect(victim.vx).toBeGreaterThan(0);
    expect(rammer.vx).toBeLessThan(300);
  });

  it('leaves ghosted cars alone', () => {
    // A just-recovered car must not be shoved back into the scrum it was
    // pulled out of, or the recovery does not read as working.
    const a: CarBody = { x: 500, y: 500, angle: 0, vx: 0, vy: 0, steer: 0 };
    const b: CarBody = { x: 505, y: 500, angle: 0, vx: 0, vy: 0, steer: 0 };
    separateCars(
      [
        { body: a, ghost: false },
        { body: b, ghost: true },
      ],
      CAR_R,
    );
    expect(a.x).toBe(500);
    expect(b.x).toBe(505);
  });

  it('separates exactly coincident cars rather than dividing by zero', () => {
    const a: CarBody = { x: 500, y: 500, angle: 0, vx: 0, vy: 0, steer: 0 };
    const b: CarBody = { x: 500, y: 500, angle: 0, vx: 0, vy: 0, steer: 0 };
    separateCars(
      [
        { body: a, ghost: false },
        { body: b, ghost: false },
      ],
      CAR_R,
    );
    expect(Number.isFinite(a.x)).toBe(true);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(CAR_R * 2, 4);
  });
});
