import { describe, expect, it } from 'vitest';
import { TICK_MS } from '@mg/shared';
import { IN_RIGHT, getLevel, type GmSnapshotPlayer } from '@mg/shared/gunmayhem';
import { GunMayhemPredictor } from './predictor';

const level = getLevel('salon');

function server(overrides: Partial<GmSnapshotPlayer> = {}): GmSnapshotPlayer {
  return {
    s: 0,
    x: 600,
    y: 400,
    vx: 0,
    vy: 0,
    f: 1,
    g: 1,
    d: 0,
    k: 3,
    st: 0,
    iv: 0,
    rt: 0,
    j: 2,
    jp: 0,
    w: 'pistol',
    am: 0,
    bo: 3,
    p: 0,
    ack: 0,
    ...overrides,
  };
}

/** Run `frames` at `hz`, one snapshot arriving at `serverAt`. */
function play(
  predictor: GunMayhemPredictor,
  opts: {
    frames: number;
    hz: number;
    start: number;
    snap: GmSnapshotPlayer;
    serverAt: number;
    bits?: number;
    controllable?: boolean;
  },
): { x: number; y: number } | null {
  const step = 1000 / opts.hz;
  let out: { x: number; y: number } | null = null;
  for (let i = 1; i <= opts.frames; i++) {
    const body = predictor.update(
      opts.start + i * step,
      level,
      opts.snap,
      opts.serverAt,
      60,
      opts.bits ?? 0,
      opts.controllable ?? true,
    );
    out = body ? { x: body.x, y: body.y } : null;
  }
  return out;
}

describe('GunMayhemPredictor', () => {
  it('hands control back to the server during hitstun, respawn and elimination', () => {
    for (const state of [{ st: 8 }, { rt: 40 }, { k: 0 }]) {
      const predictor = new GunMayhemPredictor();
      expect(
        predictor.update(1000, level, server(state), 1000, 60, IN_RIGHT, true),
      ).toBeNull();
      expect(predictor.active).toBe(false);
    }
  });

  it('runs while you hold a direction', () => {
    const predictor = new GunMayhemPredictor();
    const snap = server();
    predictor.recordInput(IN_RIGHT, 1000);

    const body = play(predictor, {
      frames: 30,
      hz: 60,
      start: 1000,
      snap,
      serverAt: 1000,
      bits: IN_RIGHT,
    });

    expect(body).not.toBeNull();
    expect(body!.x).toBeGreaterThan(snap.x + 20);
  });

  it('ignores every button outside the playing phase', () => {
    // The server's `stepBodies` zeroes the whole input during the countdown and
    // the round-over freeze. Predicting a sprint through those disagreed with it
    // by half the stage, and resynced — visibly — at every round boundary.
    const predictor = new GunMayhemPredictor();
    const snap = server();
    predictor.recordInput(IN_RIGHT, 1000);

    const body = play(predictor, {
      frames: 30,
      hz: 60,
      start: 1000,
      snap,
      serverAt: 1000,
      bits: IN_RIGHT,
      controllable: false,
    });

    expect(body!.x).toBeCloseTo(snap.x, 5);
  });

  it('corrects the same error by the same amount at 60 Hz and at 144 Hz', () => {
    // Reconciling per frame rather than per snapshot made the correction
    // strength a property of the monitor: a fast display pulled at one stale
    // error several times over and oscillated around it.
    const drift = 30;

    const settle = (hz: number): number => {
      const predictor = new GunMayhemPredictor();
      const snap = server();
      // Seed, then let it build a little history at this refresh rate.
      play(predictor, { frames: hz / 4, hz, start: 1000, snap, serverAt: 1000 });
      // One new snapshot, disagreeing by `drift`.
      const moved = server({ x: snap.x + drift });
      const body = play(predictor, {
        frames: hz / 4,
        hz,
        start: 1000 + 250,
        snap: moved,
        serverAt: 1000 + 300,
      });
      return body!.x - snap.x;
    };

    const slow = settle(60);
    const fast = settle(144);
    expect(slow).toBeGreaterThan(0);
    expect(Math.abs(fast - slow)).toBeLessThan(1);
  });

  it('does not drag the body backwards when history is too short to compare', () => {
    // `positionAt` used to answer with a *newer* sample when nothing reached
    // back far enough, so the frame after every resync measured a bogus error
    // — half a round trip of travel — and pulled against it.
    const predictor = new GunMayhemPredictor();
    const snap = server();
    predictor.recordInput(IN_RIGHT, 0);

    // First update seeds from the snapshot; the only history is stamped then.
    const seeded = predictor.update(1000, level, snap, 1000, 60, IN_RIGHT, true);
    expect(seeded).not.toBeNull();
    const x = seeded!.x;

    // A frame later, against the same snapshot, it must keep running forwards.
    const next = predictor.update(1000 + TICK_MS, level, snap, 1000, 60, IN_RIGHT, true);
    expect(next!.x).toBeGreaterThanOrEqual(x);
  });

  it('takes on velocity the server applied that we never predicted', () => {
    // Recoil, the knife lunge and a shield popping all change your velocity with
    // no hitstun to announce it, so prediction stays engaged and drifts until it
    // teleports. Adopting the difference keeps it engaged and correct instead.
    const predictor = new GunMayhemPredictor();
    const snap = server();
    play(predictor, { frames: 20, hz: 60, start: 1000, snap, serverAt: 1000 });

    const shoved = server({ vx: -260 });
    const body = predictor.update(1000 + 340, level, shoved, 1000 + 340, 60, 0, true);

    expect(body!.vx).toBeLessThan(-100);
  });
});
