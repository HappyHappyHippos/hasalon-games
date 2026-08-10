import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  POWERUPS,
  POWERUP_RADIUS,
  SCOPE_COLORS,
  turnRateFor,
  type AchtungConfig,
  type AchtungSnapshot,
  type Motion,
  type SnapshotPlayer,
  type TurnDir,
} from '@mg/shared/achtung';
import { DT, SNAPSHOT_EVERY, TICK_MS } from '@mg/shared';
import { clock } from '../../net/clock';
import { feed } from '../../net/feed';
import { isPredicting } from '../../net/playbackMode';
import { CanvasStage } from '../../game/CanvasStage';
import { drawHat } from '../../game/appearance';
import { bracket, lerp, shortestAngle } from '../../game/interpolation';
import { advanceCurve, ticksBehind, type TurnSource } from './advance';
import { localInput, turnAt } from './input';
import { trailOps, type Point } from './trail';

/**
 * How far a buffered curve may coast past the newest snapshot it has, in the
 * `interpolate` model only. Separate from `MAX_ADVANCE_TICKS` because it covers
 * a different failure — a late packet rather than a stale connection — and can
 * afford to be more generous.
 */
const MAX_COAST_TICKS = 22;

/** The persistent trail layer is rendered at this multiple of arena units. */
const TRAIL_SCALE = 2;

/**
 * The arena is paper, like the rest of the site — same `--paper` and `--ink` as
 * `tokens.css`, kept as literals here because the canvas has no cascade to read
 * a custom property out of.
 */
const ARENA_FILL = '#fdf6e8';
const INK = '#14110f';

/** Faint wallpaper dots, matching the ones behind the rest of the site. */
const ARENA_DOT = 'rgba(20, 17, 15, 0.07)';
const DOT_SPACING = 28;

/**
 * Seat colours, darkened for a cream background.
 *
 * `PLAYER_COLORS` is an Apple-system palette picked for a dark screen. On paper
 * the light end of it disappears — `#ffd60a` yellow on `#fdf6e8` cream is very
 * nearly invisible, and a curve you cannot see is a curve you cannot avoid.
 * These hold each seat's hue so the swatch in the lobby still reads as "yours",
 * and only move lightness and saturation far enough to sit on the paper.
 *
 * Local to Achtung on purpose: the shared palette still owns avatars, the HUD
 * and Gun Mayhem, none of which are drawn on cream.
 */
const PAPER_COLORS = [
  '#e02d1f', // red
  '#1a9e3a', // green
  '#0a5fd6', // blue
  '#c98f00', // yellow
  '#e06c00', // orange
  '#8b32c9', // purple
  '#0f8fb5', // cyan
  '#e0335c', // pink
] as const;

function paperColor(colorIndex: number): string {
  return PAPER_COLORS[colorIndex % PAPER_COLORS.length]!;
}

/**
 * Which way a curve was last seen steering, recovered from the angle it swept
 * between two snapshots.
 *
 * Half a snapshot's worth of turn is the threshold: below that the player is
 * near enough to straight that guessing a direction would bend the curve the
 * wrong way, and a straight guess is the safer error.
 *
 * Note the `* DT`. Without it the threshold is a turn *rate* compared against a
 * swept *angle* — 60x too large, so the test never failed and this function
 * silently returned 0 for every player, for its entire life. Everything the
 * paragraph above describes was dead code until that was fixed.
 */
function inferTurn(
  previous: AchtungSnapshot | null,
  player: SnapshotPlayer,
  turnRate: number,
): TurnDir {
  if (!previous || turnRate <= 0) return 0;
  const before = previous.players.find((p) => p.s === player.s);
  if (!before || before.l !== 1) return 0;

  const swept = shortestAngle(before.a, player.a);
  const threshold = (turnRate * SNAPSHOT_EVERY * DT) / 2;
  if (Math.abs(swept) < threshold) return 0;
  return swept > 0 ? 1 : -1;
}

interface DeathBurst {
  x: number;
  y: number;
  at: number;
  color: string;
}

/**
 * One frame's worth of positions.
 *
 * `paths` carries the ticks each curve has been carried forward past the
 * snapshot, so the renderer can stroke that stretch of line as well as place the
 * head. Without it a curve's head floats detached from its own trail by however
 * far it was extrapolated.
 */
interface CurveView {
  snap: AchtungSnapshot;
  heads: Map<number, Motion>;
  paths: Map<number, Motion[]>;
}

export interface AchtungRenderContext {
  /** Seat of the local player, or -1 when spectating. */
  mySeat: number;
  colorBySeat: Record<number, number>;
  nameBySeat: Record<number, string>;
  hatBySeat: Record<number, number>;
  settings: AchtungConfig;
  /** The server has frozen the tick; predicting through that only drifts. */
  paused: boolean;
}

export class AchtungRenderer {
  private stage: CanvasStage;

  /** Persistent trail layer — only ever added to, never redrawn per frame. */
  private trail: HTMLCanvasElement;
  private trailCtx: CanvasRenderingContext2D;

  private raf = 0;
  private context: AchtungRenderContext;

  private trailEpoch = -1;
  /** Last tick baked into the trail layer, per seat. */
  private bakedTick = new Map<number, number>();
  /** Where each curve's stroke currently ends, so strokes join up. */
  private penPos = new Map<number, Point>();
  private seenEventTick = -1;
  private bursts: DeathBurst[] = [];

  constructor(canvas: HTMLCanvasElement, context: AchtungRenderContext) {
    this.stage = new CanvasStage(canvas, ARENA_WIDTH, ARENA_HEIGHT);
    this.context = context;

    this.trail = document.createElement('canvas');
    this.trail.width = ARENA_WIDTH * TRAIL_SCALE;
    this.trail.height = ARENA_HEIGHT * TRAIL_SCALE;
    const trailCtx = this.trail.getContext('2d');
    if (!trailCtx) throw new Error('Canvas 2D is not available in this browser.');
    this.trailCtx = trailCtx;
    this.trailCtx.scale(TRAIL_SCALE, TRAIL_SCALE);
    this.trailCtx.lineCap = 'round';
    this.trailCtx.lineJoin = 'round';
  }

  setContext(context: AchtungRenderContext): void {
    this.context = context;
  }

  start(): void {
    this.stage.attach();
    this.reset();
    const loop = (now: number): void => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.stage.detach();
  }

  /** Reset all persistent trail layer state (canvas, epoch, ticks, pen positions, bursts). */
  reset(): void {
    this.trailCtx.clearRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    this.penPos.clear();
    this.bakedTick.clear();
    this.bursts = [];
    this.trailEpoch = -1;
    this.seenEventTick = -1;
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  private frame(now: number): void {
    // Always sampled, whichever playback model is running: `renderTime` is what
    // adapts the feed's delay to measured jitter, and that number is also what
    // the connection badge reports.
    const renderTime = feed.renderTime(now);
    this.bake(renderTime);

    const { ctx } = this.stage;
    this.stage.begin(ARENA_FILL);

    ctx.fillStyle = ARENA_FILL;
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    this.drawWallpaper();

    ctx.drawImage(
      this.trail,
      0,
      0,
      this.trail.width,
      this.trail.height,
      0,
      0,
      ARENA_WIDTH,
      ARENA_HEIGHT,
    );

    const view = isPredicting ? this.presentView(now) : this.interpolate(renderTime, now);
    if (view) {
      this.drawPickups(view.snap, now);
      this.drawHeads(view);
    }

    this.drawBursts(now);

    // The wall you die on, drawn as an ink outline like every other edge on the
    // site. Inset by half its own width so the stroke sits inside the arena
    // rather than straddling the boundary the sim actually tests against.
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.strokeRect(1.5, 1.5, ARENA_WIDTH - 3, ARENA_HEIGHT - 3);
  }

  /**
   * The same dotted wallpaper the page has behind it, so the arena reads as a
   * surface rather than a void. Cheap enough to redraw per frame at this
   * spacing, and it gives the eye something to judge speed against — on flat
   * cream a curve at 122 u/s looks oddly weightless.
   */
  private drawWallpaper(): void {
    const { ctx } = this.stage;
    ctx.fillStyle = ARENA_DOT;
    for (let y = DOT_SPACING; y < ARENA_HEIGHT; y += DOT_SPACING) {
      for (let x = DOT_SPACING; x < ARENA_WIDTH; x += DOT_SPACING) {
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Trail baking
  // -------------------------------------------------------------------------

  /**
   * Copy stamped points from snapshots into the trail layer.
   *
   * A curve's head and its own trail have to agree, so when the trail is baked
   * depends on which instant the head is drawn at:
   *
   * - Predicting, every head is at the present, so every trail is baked the
   *   moment it arrives and the extrapolated tip bridges the remainder.
   * - Interpolating, remote heads sit at `renderTime`, so their trails wait for
   *   the timeline to reach them. The test is on `serverAt` — when the server
   *   *authored* the snapshot. It used to be on `at`, arrival time, which
   *   `feed.ts` says in as many words never to render off: at one-way latency
   *   later than it should be, it left a stretch of trail behind every remote
   *   curve that was lethal in the server's grid and not on screen.
   */
  private bake(renderTime: number): void {
    for (const entry of feed.entries) {
      const snap = entry.snap;
      if (snap.game !== 'achtung') continue;

      if (snap.trailEpoch < this.trailEpoch || snap.tick < this.seenEventTick) {
        // A new match has started or state was reset. Reset renderer state.
        this.reset();
      }

      if (snap.trailEpoch > this.trailEpoch) {
        // New round, or someone grabbed "clear trails".
        this.trailCtx.clearRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
        this.penPos.clear();
        this.bakedTick.clear();
        this.bursts = [];
        this.trailEpoch = snap.trailEpoch;
      }

      if (snap.tick > this.seenEventTick) {
        this.collectEvents(snap);
        this.seenEventTick = snap.tick;
      }

      const isReady = isPredicting || entry.serverAt <= renderTime;
      for (const player of snap.players) {
        const isLocal = player.s === this.context.mySeat;
        if (!isLocal && !isReady) continue;
        if ((this.bakedTick.get(player.s) ?? -1) >= snap.tick) continue;
        this.bakedTick.set(player.s, snap.tick);
        this.bakePlayer(player);
      }
    }
  }

  private bakePlayer(player: SnapshotPlayer): void {
    const { ops, pen } = trailOps(
      player.tr ?? [],
      player.tb ?? [],
      this.penPos.get(player.s) ?? null,
    );
    if (ops.length === 0) return;

    const ctx = this.trailCtx;
    ctx.strokeStyle = this.colorFor(player.s);
    ctx.lineWidth = player.r * 2;

    ctx.beginPath();
    for (const op of ops) {
      if (op.type === 'dot') {
        // A zero-length stroke with a round cap draws a dot.
        ctx.moveTo(op.x, op.y);
        ctx.lineTo(op.x, op.y);
      } else {
        ctx.moveTo(op.from.x, op.from.y);
        ctx.lineTo(op.to.x, op.to.y);
      }
    }
    ctx.stroke();

    if (pen) this.penPos.set(player.s, pen);
  }

  private collectEvents(snap: AchtungSnapshot): void {
    for (const event of snap.events) {
      if (event.t !== 'death') continue;
      const player = snap.players.find((p) => p.s === event.seat);
      if (!player) continue;
      this.bursts.push({
        x: player.x,
        y: player.y,
        at: performance.now(),
        color: this.colorFor(event.seat),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Heads
  // -------------------------------------------------------------------------

  /**
   * Everyone, drawn at the present.
   *
   * The whole point: one horizon, applied to every curve on the board. Your own
   * steering is known exactly (it is in your hand), everyone else's is inferred
   * from the last two snapshots — but the *distance* each curve is carried is
   * identical, so relative positions are right even where absolute ones are a
   * guess. Blocking someone is a question about relative position, which is why
   * this is the fix for "everyone thinks they are in front".
   */
  private presentView(now: number): CurveView | null {
    const latest = feed.latest;
    const snap = latest?.snap;
    if (!latest || !snap || snap.game !== 'achtung') return null;

    const previous = feed.entries[feed.entries.length - 2];
    const previousSnap = previous?.snap.game === 'achtung' ? previous.snap : null;
    const turnRate = turnRateFor(this.context.settings);

    // Paused, the server is not advancing anyone — so neither do we.
    const ticks = this.context.paused ? 0 : ticksBehind(now, latest.serverAt);

    const heads = new Map<number, Motion>();
    const paths = new Map<number, Motion[]>();

    for (const player of snap.players) {
      const base: Motion = { x: player.x, y: player.y, angle: player.a };
      if (player.l !== 1) {
        heads.set(player.s, base);
        continue;
      }

      const isLocal = player.s === this.context.mySeat;
      const inverted = player.fx.includes('invert');
      const turn: TurnSource = isLocal
        ? this.localTurnAt(latest.serverAt, inverted)
        : inferTurn(previousSnap, player, turnRate);

      const path = advanceCurve(base, turn, player.v, turnRate, ticks);
      heads.set(player.s, path[path.length - 1]!);
      paths.set(player.s, path);
    }

    return { snap, heads, paths };
  }

  /**
   * The local steering, replayed across the extrapolation window.
   *
   * The snapshot at `serverAt` already reflects everything the server had
   * received by then, which is everything sent before roughly one uplink ago.
   * So extrapolated tick `i` — which stands for server time
   * `serverAt + i * TICK_MS` — should be steered the way the player was steering
   * at `serverAt + i * TICK_MS - uplink`, translated onto our own clock.
   *
   * Half the *minimum* round trip is the uplink estimate, for the same reason
   * `clock` uses the min sample for its offset: the floor is the real path and
   * anything above it is queueing on one particular packet.
   */
  private localTurnAt(serverAt: number, inverted: boolean): TurnSource {
    const uplink = clock.minRttMs / 2;
    const startedAt = clock.toClientTime(serverAt, performance.now()) - uplink;
    return (tick: number): TurnDir => {
      const turn = turnAt(startedAt + tick * DT * 1000);
      return (inverted ? -turn : turn) as TurnDir;
    };
  }

  /**
   * The `?playback=interpolate` model, kept intact: remote curves buffered a
   * fixed delay behind the present, the local curve still carried to now.
   *
   * This is what the game did before everyone moved onto one clock, and it stays
   * reachable so the two can be compared back to back in the same build rather
   * than against a memory of last week.
   */
  private interpolate(renderTime: number, now: number): CurveView | null {
    const found = bracket(feed.entries, renderTime);
    if (!found) return null;

    const fromSnap = found.from.snap;
    const toSnap = found.to?.snap;
    if (fromSnap.game !== 'achtung') return null;

    // Nothing newer to interpolate towards — the next packet is late. Curves
    // are the easiest thing in either game to carry forward: constant speed, a
    // fixed turn rate, no collision to get wrong. Replaying the sim's own
    // `advanceMotion` for the missing ticks lands very close to what the server
    // will turn out to have done, and beats freezing the head and snapping it
    // forward when the packet finally lands.
    //
    // Which way they are steering is *not* on the wire, so it is recovered from
    // how far they turned between the previous snapshot and this one. Holding
    // the last angle instead would straighten out anyone mid-turn — exactly the
    // players whose position is hardest to guess.
    const coastTicks = Math.min(found.overshootMs / TICK_MS, MAX_COAST_TICKS);
    const previous = coastTicks > 0 ? feed.entries[found.index - 1] : undefined;
    const previousSnap = previous?.snap.game === 'achtung' ? previous.snap : null;
    const turnRate = turnRateFor(this.context.settings);

    const heads = new Map<number, Motion>();
    for (const player of fromSnap.players) {
      const next =
        toSnap && toSnap.game === 'achtung'
          ? toSnap.players.find((p) => p.s === player.s)
          : undefined;

      if (!next || found.alpha === 0) {
        const base: Motion = { x: player.x, y: player.y, angle: player.a };
        if (coastTicks > 0 && player.l === 1) {
          const turn = inferTurn(previousSnap, player, turnRate);
          const path = advanceCurve(base, turn, player.v, turnRate, coastTicks);
          heads.set(player.s, path[path.length - 1]!);
        } else {
          heads.set(player.s, base);
        }
      } else {
        heads.set(player.s, {
          x: lerp(player.x, next.x, found.alpha),
          y: lerp(player.y, next.y, found.alpha),
          angle: player.a + shortestAngle(player.a, next.a) * found.alpha,
        });
      }
    }

    // The newest snapshot carries the authoritative scores and effects; use it
    // for everything except positions.
    const latestEntry = feed.latest;
    const latest = latestEntry?.snap;
    const snap = latest && latest.game === 'achtung' ? latest : fromSnap;

    // Your own curve stays on the present even here — steering that waits a
    // round trip to show up is not a playback model anyone wants to compare
    // against, it is just lag.
    const paths = new Map<number, Motion[]>();
    const me =
      latestEntry && latest?.game === 'achtung'
        ? latest.players.find((p) => p.s === this.context.mySeat)
        : undefined;
    if (latestEntry && me && me.l === 1) {
      const inverted = me.fx.includes('invert');
      const path = advanceCurve(
        { x: me.x, y: me.y, angle: me.a },
        (inverted ? -localInput.turn : localInput.turn) as TurnDir,
        me.v,
        turnRate,
        this.context.paused ? 0 : ticksBehind(now, latestEntry.serverAt),
      );
      heads.set(me.s, path[path.length - 1]!);
      paths.set(me.s, path);
    }

    return { snap, heads, paths };
  }

  private drawHeads(data: CurveView): void {
    const { ctx } = this.stage;
    const { snap, heads, paths } = data;
    const showNames = snap.phase === 'countdown';

    for (const player of snap.players) {
      if (player.l !== 1) continue;

      const isLocal = player.s === this.context.mySeat;
      const head = heads.get(player.s);
      if (!head) continue;

      // The stretch between the last stamped point and where the curve has been
      // carried to. Drawn before the head so the head sits on top of it.
      const path = paths.get(player.s);
      if (path && player.d === 1) this.drawTip(player, path);

      const color = this.colorFor(player.s);
      const ghost = player.fx.includes('ghost');

      // Flat fill, hard ink outline, no glow. The glow this replaced was what
      // made the arena read as a neon CRT while the rest of the site is flat
      // ink-on-paper — and `tokens.css` is explicit that a soft shadow is the
      // one thing the look does not allow.
      ctx.beginPath();
      ctx.arc(head.x, head.y, player.r * 1.7, 0, Math.PI * 2);
      if (ghost) {
        ctx.strokeStyle = color;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (isLocal) {
        // A ring so you can always pick yourself out of eight curves.
        ctx.beginPath();
        ctx.arc(head.x, head.y, player.r * 3.4, 0, Math.PI * 2);
        ctx.strokeStyle = INK;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // A hat on a head this small only reads at all if it is drawn well over
      // life size; on paper it now gets the outline too, since a silhouette in
      // a light seat colour would otherwise vanish into the background.
      const hat = this.context.hatBySeat[player.s] ?? 0;
      if (hat !== 0 && !ghost) {
        ctx.save();
        ctx.translate(head.x, head.y);
        drawHat(ctx, hat, color, Math.max(5, player.r * 2.4), true);
        ctx.restore();
      }

      if (snap.phase === 'countdown') this.drawHeadingArrow(head, color);

      if (showNames) {
        const name = this.context.nameBySeat[player.s];
        if (name) {
          ctx.font = '700 13px Rubik Variable, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = INK;
          ctx.fillText(name, head.x, head.y - 16);
        }
      }
    }
  }

  private drawHeadingArrow(head: Motion, color: string): void {
    const { ctx } = this.stage;
    const length = 26;
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(head.angle);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(length, 0);
    ctx.moveTo(length - 6, -4);
    ctx.lineTo(length, 0);
    ctx.lineTo(length - 6, 4);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw the stretch of curve between the newest snapshot and now.
   *
   * The server-confirmed part of a trail is already baked into the trail layer;
   * this bridges the rest, so a head never floats detached from its own line.
   * For your own curve it is what makes turning feel instant instead of a round
   * trip late; for everyone else's it is the visible half of drawing them where
   * they actually are.
   *
   * Drawn live rather than baked, and recomputed from the newest snapshot every
   * frame — so a tip that guessed wrong is simply replaced 33 ms later, never
   * accumulated. The caller skips this entirely while a curve's pen is up: a tip
   * stroked across somebody's gap would make a passable hole look blocked, and
   * the holes are the only way through.
   */
  private drawTip(player: SnapshotPlayer, path: Motion[]): void {
    if (path.length < 2) return;

    const ctx = this.stage.ctx;
    ctx.save();
    ctx.strokeStyle = this.colorFor(player.s);
    ctx.lineWidth = player.r * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(path[0]!.x, path[0]!.y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i]!.x, path[i]!.y);
    ctx.stroke();
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Decoration
  // -------------------------------------------------------------------------

  private drawPickups(snap: AchtungSnapshot, now: number): void {
    const { ctx } = this.stage;
    const pulse = 1 + Math.sin(now / 320) * 0.06;

    for (const pickup of snap.pickups) {
      const def = POWERUPS[pickup.kind];
      const color = SCOPE_COLORS[def.scope];
      const radius = POWERUP_RADIUS * pulse;

      ctx.save();
      ctx.translate(pickup.x, pickup.y);

      // A sticker on the floor: the scope colour as the fill, a hard ink
      // outline, and its offset shadow solid and unblurred — the same
      // vocabulary as every card in the lobby.
      //
      // No image variant. Achtung's kinds are `speedSelf`, `thickOthers`,
      // `clearAll` and friends; `public/powerups/` holds the Tank Trouble set,
      // so a `/powerups/powerup_<kind>.png` lookup here can only ever 404.
      ctx.beginPath();
      ctx.arc(2.5, 2.5, radius, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = INK;
      ctx.stroke();

      ctx.fillStyle = INK;
      ctx.font = '700 15px Rubik Variable, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, 0, 1);
      ctx.restore();
    }
  }

  private drawBursts(now: number): void {
    const { ctx } = this.stage;
    const duration = 450;

    this.bursts = this.bursts.filter((burst) => now - burst.at < duration);
    for (const burst of this.bursts) {
      const t = (now - burst.at) / duration;
      const radius = 6 + t * 34;
      ctx.save();
      ctx.globalAlpha = 1 - t;

      // Ink ring under the colour one, so the pop still lands on cream where a
      // single mid-tone ring would wash out as it fades.
      ctx.strokeStyle = INK;
      ctx.lineWidth = 5 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(burst.x, burst.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = burst.color;
      ctx.lineWidth = 3 * (1 - t) + 0.5;
      ctx.beginPath();
      ctx.arc(burst.x, burst.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private colorFor(seat: number): string {
    return paperColor(this.context.colorBySeat[seat] ?? seat);
  }
}
