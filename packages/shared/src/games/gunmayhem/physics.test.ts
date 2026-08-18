import { describe, expect, it } from 'vitest';
import { DT } from '../../engine';
import {
  COYOTE_TICKS,
  DOUBLE_JUMP_DELAY_TICKS,
  JETPACK_FUEL_TICKS,
  JETPACK_MAX_RISE,
  JUMP_BUFFER_TICKS,
  KB_BASE,
  KB_PER_DAMAGE,
  MAX_JUMPS,
  PLAYER_HALF_H,
  RUN_SPEED,
} from './constants';
import {
  calculateKnockback,
  segmentHitsBox,
  stepMovement,
  type MoveBody,
  type MoveInput,
  type MoveMods,
} from './physics';
import type { Level } from './types';

/** A deliberately plain stage, so each test asserts one thing about physics. */
const GROUND_TOP = 500;
const LEDGE_TOP = 400;

const TEST_LEVEL: Level = {
  id: 'candyland',
  name: 'Test',
  platforms: [
    { x: 0, y: GROUND_TOP, w: 800, h: 40, oneWay: false },
    { x: 200, y: LEDGE_TOP, w: 200, h: 20, oneWay: true },
    { x: 600, y: 300, w: 40, h: 200, oneWay: false },
  ],
  spawns: [{ x: 100, y: 400 }],
  palette: {
    sky: '#000',
    far: '#000',
    near: '#000',
    platform: '#000',
    platformTop: '#000',
    accent: '#000',
  },
};

/** Standing on a platform puts the body's centre half a height above its top. */
const standingY = (platformTop: number): number => platformTop - PLAYER_HALF_H;

function body(overrides: Partial<MoveBody> = {}): MoveBody {
  return {
    x: 100,
    y: standingY(GROUND_TOP),
    vx: 0,
    vy: 0,
    facing: 1,
    onGround: true,
    jumpsLeft: MAX_JUMPS,
    coyote: COYOTE_TICKS,
    jumpBuffer: 0,
    dropThrough: 0,
    jetpack: 0,
    airJumpDelay: 0,
    ...overrides,
  };
}

function input(overrides: Partial<MoveInput> = {}): MoveInput {
  return {
    left: false,
    right: false,
    down: false,
    jumpPressed: false,
    jumpHeld: false,
    controllable: true,
    ...overrides,
  };
}

function run(b: MoveBody, ticks: number, i: MoveInput = input(), mods?: MoveMods): void {
  for (let t = 0; t < ticks; t++) stepMovement(b, i, TEST_LEVEL, DT, mods);
}

describe('ground and gravity', () => {
  it('falls onto solid ground and stays there', () => {
    const b = body({ y: 100, onGround: false });
    run(b, 120);
    expect(b.onGround).toBe(true);
    expect(b.y).toBeCloseTo(standingY(GROUND_TOP), 3);
    expect(b.vy).toBe(0);
  });

  it('accelerates up to run speed and no further', () => {
    // Stop well before the pillar at x=600 so this measures acceleration only.
    const b = body();
    run(b, 30, input({ right: true }));
    expect(b.vx).toBeCloseTo(RUN_SPEED, 1);
    expect(b.facing).toBe(1);
  });

  it('stops when the stick is released', () => {
    const b = body({ vx: RUN_SPEED });
    run(b, 60);
    expect(Math.abs(b.vx)).toBeLessThan(1);
  });

  it('is blocked sideways by solid geometry', () => {
    const b = body({ x: 500 });
    run(b, 120, input({ right: true }));
    // The pillar starts at x=600; we should be stopped against it, not inside.
    expect(b.x).toBeLessThanOrEqual(600);
    expect(b.x).toBeGreaterThan(540);
  });
});

describe('jumping', () => {
  it('leaves the ground and comes back down', () => {
    const b = body();
    stepMovement(b, input({ jumpPressed: true }), TEST_LEVEL, DT);
    expect(b.onGround).toBe(false);
    expect(b.vy).toBeLessThan(0);

    run(b, 200);
    expect(b.onGround).toBe(true);
    expect(b.y).toBeCloseTo(standingY(GROUND_TOP), 3);
  });

  it('allows exactly two jumps before landing again', () => {
    const b = body();
    stepMovement(b, input({ jumpPressed: true }), TEST_LEVEL, DT);
    expect(b.jumpsLeft).toBe(MAX_JUMPS - 1);

    run(b, 10);
    stepMovement(b, input({ jumpPressed: true }), TEST_LEVEL, DT);
    expect(b.jumpsLeft).toBe(0);

    // A third press in the air does nothing.
    run(b, 5);
    const before = b.vy;
    stepMovement(b, input({ jumpPressed: true }), TEST_LEVEL, DT);
    expect(b.vy).toBeGreaterThan(before);
  });

  it('refills the jumps on landing', () => {
    const b = body();
    stepMovement(b, input({ jumpPressed: true }), TEST_LEVEL, DT);
    run(b, 10);
    stepMovement(b, input({ jumpPressed: true }), TEST_LEVEL, DT);
    expect(b.jumpsLeft).toBe(0);

    run(b, 200);
    expect(b.onGround).toBe(true);
    expect(b.jumpsLeft).toBe(MAX_JUMPS);
  });

  it('still lets you jump just after walking off a ledge', () => {
    // Coyote time. Without it, running off a platform and pressing jump a
    // frame later silently does nothing, which feels broken.
    const b = body({ x: 760, vx: RUN_SPEED });
    for (let t = 0; t < 30 && b.onGround; t++) {
      stepMovement(b, input({ right: true }), TEST_LEVEL, DT);
    }
    expect(b.onGround).toBe(false);
    expect(b.coyote).toBeGreaterThan(0);

    stepMovement(b, input({ right: true, jumpPressed: true }), TEST_LEVEL, DT);
    expect(b.vy).toBeLessThan(0);
    // A ground jump, so the air jump is still in hand.
    expect(b.jumpsLeft).toBe(MAX_JUMPS - 1);
  });

  it('does not give coyote jumps forever', () => {
    // Out past the right edge of the ground, so there is nothing to land on.
    const b = body({ x: 900, onGround: false, coyote: 0, jumpsLeft: 0 });
    run(b, COYOTE_TICKS + 4);
    expect(b.onGround).toBe(false);

    const before = b.vy;
    stepMovement(b, input({ jumpPressed: true }), TEST_LEVEL, DT);
    // Still falling faster, i.e. no jump was granted.
    expect(b.vy).toBeGreaterThan(before);
  });

  it('remembers a jump pressed just before landing', () => {
    // Jump buffering: pressing slightly early should still jump on touchdown.
    // Five units up is about four ticks of fall, inside the buffer window.
    const b = body({ y: standingY(GROUND_TOP) - 5, onGround: false, jumpsLeft: 0, coyote: 0 });
    stepMovement(b, input({ jumpPressed: true }), TEST_LEVEL, DT);
    expect(b.jumpBuffer).toBeGreaterThan(0);
    expect(b.vy).toBeGreaterThan(0);

    let jumped = false;
    for (let t = 0; t < JUMP_BUFFER_TICKS; t++) {
      stepMovement(b, input(), TEST_LEVEL, DT);
      if (b.vy < 0) jumped = true;
    }
    expect(jumped).toBe(true);
  });

  it('enforces a cooldown delay before double jumping', () => {
    const b = body();
    stepMovement(b, input({ jumpPressed: true }), TEST_LEVEL, DT);
    expect(b.airJumpDelay).toBe(DOUBLE_JUMP_DELAY_TICKS);

    // Attempting air jump immediately on next tick fails while airJumpDelay > 0
    const res1 = stepMovement(b, input({ jumpPressed: true }), TEST_LEVEL, DT);
    expect(res1.jumped).toBeNull();
    expect(b.airJumpDelay).toBe(1);

    // On following tick, airJumpDelay reaches 0 and buffered jump executes
    const res2 = stepMovement(b, input(), TEST_LEVEL, DT);
    expect(res2.jumped).toBe('air');
    expect(b.jumpsLeft).toBe(MAX_JUMPS - 2);
  });
});

describe('one-way platforms', () => {
  it('lands on a ledge when falling onto it', () => {
    const b = body({ x: 300, y: 200, onGround: false });
    run(b, 120);
    expect(b.onGround).toBe(true);
    expect(b.y).toBeCloseTo(standingY(LEDGE_TOP), 3);
  });

  it('passes up through a ledge from below', () => {
    const b = body({ x: 300 });
    stepMovement(b, input({ jumpPressed: true }), TEST_LEVEL, DT);
    run(b, 8);
    stepMovement(b, input({ jumpPressed: true }), TEST_LEVEL, DT);

    run(b, 200);
    expect(b.onGround).toBe(true);
    // Ended up on the ledge, having risen through it rather than bonking.
    expect(b.y).toBeCloseTo(standingY(LEDGE_TOP), 3);
  });

  it('drops through when you hold Down', () => {
    const b = body({ x: 300, y: standingY(LEDGE_TOP) });
    run(b, 1);
    expect(b.onGround).toBe(true);

    stepMovement(b, input({ down: true }), TEST_LEVEL, DT);
    expect(b.onGround).toBe(false);
    expect(b.dropThrough).toBeGreaterThan(0);

    run(b, 200);
    // Fell all the way to the ground below rather than catching the ledge.
    expect(b.y).toBeCloseTo(standingY(GROUND_TOP), 3);
  });

  it('does not drop through solid ground', () => {
    const b = body({ x: 100 });
    run(b, 30, input({ down: true }));
    expect(b.onGround).toBe(true);
    expect(b.y).toBeCloseTo(standingY(GROUND_TOP), 3);
  });
});

describe('the countdown control gate', () => {
  it('keeps momentum but ignores the controls', () => {
    const b = body({ vx: -700, onGround: false, y: 200 });
    run(b, 6, input({ right: true, jumpPressed: true, controllable: false }));
    // Still travelling the way it was launched, and no jump came out.
    expect(b.vx).toBeLessThan(-500);
    expect(b.jumpsLeft).toBe(MAX_JUMPS);
  });
});

describe('turning around', () => {
  it('reverses faster than it accelerates from rest', () => {
    // The point of TURN_ACCEL. Acceleration is deliberately slow enough to see,
    // which would feel unresponsive if pivoting were equally slow.
    //
    // Five ticks is not nearly enough to build a run from a standstill, but it
    // is enough to shed a full run and already be moving the other way.
    const fromRest = body();
    run(fromRest, 5, input({ left: true }));
    expect(fromRest.vx).toBeGreaterThan(-RUN_SPEED * 0.5);

    const reversing = body({ vx: RUN_SPEED });
    run(reversing, 5, input({ left: true }));
    expect(reversing.vx).toBeLessThanOrEqual(0);

    // TURN_ACCEL only applies until the velocity crosses zero, after which it
    // is ordinary acceleration again — so this ratio is well under TURN_ACCEL
    // over GROUND_ACCEL, and that is expected.
    const restDelta = Math.abs(fromRest.vx);
    const turnDelta = Math.abs(reversing.vx - RUN_SPEED);
    expect(turnDelta).toBeGreaterThan(restDelta * 1.5);
  });

  it('still takes a moment to reach full speed', () => {
    // Guards the other half of the feel: acceleration must stay *visible*. Four
    // ticks in, we should be well short of a full run.
    const b = body();
    run(b, 4, input({ right: true }));
    expect(b.vx).toBeLessThan(RUN_SPEED * 0.75);
    expect(b.vx).toBeGreaterThan(0);
  });
});

describe('jetpack', () => {
  it('lifts you while jump is held and burns fuel doing it', () => {
    const b = body({ y: 200, onGround: false, jetpack: JETPACK_FUEL_TICKS, vy: 0 });
    run(b, 30, input({ jumpHeld: true }));

    expect(b.vy).toBeLessThan(0); // rising
    expect(b.vy).toBeGreaterThanOrEqual(-JETPACK_MAX_RISE - 1); // but capped
    expect(b.jetpack).toBe(JETPACK_FUEL_TICKS - 30);
  });

  it('burns no fuel when the button is not held', () => {
    // Ten ticks, not thirty — any longer and it lands, which zeroes vy and
    // makes the "still falling" half of this test vacuous.
    const b = body({ y: 200, onGround: false, jetpack: JETPACK_FUEL_TICKS });
    run(b, 10, input({ jumpHeld: false }));
    expect(b.jetpack).toBe(JETPACK_FUEL_TICKS);
    expect(b.vy).toBeGreaterThan(0); // falling normally
  });

  it('does nothing on the ground, or once the tank is empty', () => {
    const grounded = body({ jetpack: JETPACK_FUEL_TICKS });
    run(grounded, 10, input({ jumpHeld: true }));
    expect(grounded.jetpack).toBe(JETPACK_FUEL_TICKS);

    const empty = body({ y: 200, onGround: false, jetpack: 0 });
    run(empty, 10, input({ jumpHeld: true }));
    expect(empty.vy).toBeGreaterThan(0);
  });
});

describe('movement mods', () => {
  it('raises top speed', () => {
    const plain = body();
    const fast = body();
    run(plain, 60, input({ right: true }));
    run(fast, 60, input({ right: true }), {
      speedMul: 1.5,
      accelMul: 1,
      gravityMul: 1,
      extraJumps: 0,
    });
    expect(fast.vx).toBeGreaterThan(plain.vx * 1.4);
  });

  it('grants extra jumps', () => {
    const mods: MoveMods = { speedMul: 1, accelMul: 1, gravityMul: 1, extraJumps: 1 };
    const b = body();

    // Ground jump, then keep jumping until the air jumps run out.
    let jumps = 0;
    for (let t = 0; t < 60; t++) {
      const result = stepMovement(b, input({ jumpPressed: t % 10 === 0 }), TEST_LEVEL, DT, mods);
      if (result.jumped) jumps++;
    }
    expect(jumps).toBe(MAX_JUMPS + 1);
  });

  it('slows the fall', () => {
    const plain = body({ y: 100, onGround: false });
    const floaty = body({ y: 100, onGround: false });
    run(plain, 10);
    run(floaty, 10, input(), { speedMul: 1, accelMul: 1, gravityMul: 0.5, extraJumps: 0 });
    expect(floaty.vy).toBeLessThan(plain.vy * 0.6);
  });
});

describe('determinism', () => {
  it('produces identical results for identical input logs', () => {
    // Client-side prediction replays inputs through this exact function, so
    // any divergence here shows up as your character teleporting.
    const script: MoveInput[] = [];
    for (let t = 0; t < 600; t++) {
      script.push(
        input({
          left: t % 7 === 0,
          right: t % 3 === 0,
          down: t % 23 === 0,
          jumpPressed: t % 31 === 0,
          jumpHeld: t % 31 === 0 || t % 13 === 0,
        }),
      );
    }

    // Fuel in the tank so the jetpack branch is exercised by the replay too.
    const a = body({ y: 200, onGround: false, jetpack: 90 });
    const b = body({ y: 200, onGround: false, jetpack: 90 });
    for (const step of script) {
      stepMovement(a, step, TEST_LEVEL, DT);
      stepMovement(b, step, TEST_LEVEL, DT);
    }

    expect(a).toEqual(b);
    expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
  });
});

describe('segmentHitsBox', () => {
  // A 30x44 box centred on (100, 100), the size of a player.
  const box = [85, 78, 115, 122] as const;
  const hit = (x0: number, y0: number, x1: number, y1: number): number | null =>
    segmentHitsBox(x0, y0, x1, y1, ...box);

  it('catches a segment that steps clean over the box', () => {
    // The actual bug: a sniper round covers 45 units a tick against a 30-wide
    // body, so neither endpoint is inside it and a point test finds nothing.
    expect(hit(70, 100, 130, 100)).not.toBeNull();
    expect(hit(70, 100, 130, 100)).toBeCloseTo((85 - 70) / 60, 5);
  });

  it('reports where along the segment the box starts, not just that it does', () => {
    // Halfway to the near face.
    expect(hit(55, 100, 115, 100)).toBeCloseTo(0.5, 5);
  });

  it('returns 0 for a segment that begins inside', () => {
    expect(hit(100, 100, 400, 100)).toBe(0);
  });

  it('misses when the segment passes above, below or short', () => {
    expect(hit(70, 50, 130, 50)).toBeNull(); // over the top
    expect(hit(70, 200, 130, 200)).toBeNull(); // under it
    expect(hit(0, 100, 60, 100)).toBeNull(); // stops short
    expect(hit(130, 100, 200, 100)).toBeNull(); // starts past it
  });

  it('handles a segment with no length on an axis', () => {
    // Dividing by a zero delta produces infinities that quietly poison the
    // interval arithmetic, so each axis is special-cased. Purely vertical,
    // purely horizontal, and a segment of no length at all.
    expect(hit(100, 0, 100, 300)).toBeCloseTo(78 / 300, 5);
    expect(hit(200, 0, 200, 300)).toBeNull();
    expect(hit(0, 100, 300, 100)).toBeCloseTo(85 / 300, 5);
    expect(hit(100, 100, 100, 100)).toBe(0);
    expect(hit(0, 0, 0, 0)).toBeNull();
  });

  it('catches a diagonal that clips a corner', () => {
    // Enters through the top face near the right edge. A per-axis test that
    // did not intersect the two intervals would call this a hit anywhere.
    expect(hit(80, 60, 120, 100)).not.toBeNull();
    // Same slope, shifted so it passes the corner outside: the x interval and
    // the y interval each overlap the box, but never at the same time.
    expect(hit(40, 60, 80, 100)).toBeNull();
  });
});

describe('calculateKnockback', () => {
  it('starts at full strength at 0% damage', () => {
    expect(calculateKnockback(0)).toBe(KB_BASE);
    expect(calculateKnockback(0, 2)).toBe(KB_BASE * 2);
  });

  it('applies KB_PER_DAMAGE per point of damage, whole and unscaled', () => {
    // Derived rather than written out, because `KB_PER_DAMAGE` is a tuning
    // value — it moved for issue #32 and this test went stale with it.
    expect(calculateKnockback(100)).toBe(KB_BASE + 100 * KB_PER_DAMAGE);
    expect(calculateKnockback(50, 1.5)).toBe((KB_BASE + 50 * KB_PER_DAMAGE) * 1.5);
  });

  it('has no constant factor hiding between the tuning value and the result', () => {
    // The regression this exists for: an extra `* 0.5` folded into the
    // formula. The ratio test in `sim.test.ts` cannot catch that — it patches
    // `KB_PER_DAMAGE` on both sides of its comparison, so any constant factor
    // divides out. Reading the slope back off the function does catch it.
    const slope = (calculateKnockback(80) - calculateKnockback(0)) / 80;
    expect(slope).toBeCloseTo(KB_PER_DAMAGE, 10);
  });
});

