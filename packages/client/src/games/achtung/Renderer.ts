import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  POWERUPS,
  POWERUP_RADIUS,
  SCOPE_COLORS,
  advanceMotion,
  turnRateFor,
  type AchtungConfig,
  type AchtungSnapshot,
  type Motion,
  type SnapshotPlayer,
  type TurnDir,
} from '@mg/shared/achtung';
import { SNAPSHOT_EVERY, TICK_MS, colorFor } from '@mg/shared';
import { feed } from '../../net/feed';
import { CanvasStage } from '../../game/CanvasStage';
import { drawHat } from '../../game/appearance';
import { bracket, clamp, lerp, shortestAngle } from '../../game/interpolation';
import { localInput } from './input';
import { trailOps, type Point } from './trail';

/**
 * How far behind real time remote curves are drawn. One snapshot interval plus
 * a little slack, so ordinary network jitter never leaves us with nothing to
 * interpolate towards.
 */
const INTERP_DELAY_MS = SNAPSHOT_EVERY * TICK_MS + 22;

/** Never predict further ahead than this, however bad the connection is. */
const MAX_PREDICT_TICKS = 22;

/** The persistent trail layer is rendered at this multiple of arena units. */
const TRAIL_SCALE = 2;

const ARENA_FILL = '#12141c';
const ARENA_EDGE = '#2b3245';

interface DeathBurst {
  x: number;
  y: number;
  at: number;
  color: string;
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

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  private frame(now: number): void {
    const renderTime = now - INTERP_DELAY_MS;
    this.bake(renderTime);

    const { ctx } = this.stage;
    this.stage.begin(ARENA_FILL);

    ctx.fillStyle = ARENA_FILL;
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

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

    const view = this.interpolate(renderTime);
    if (view) {
      this.drawPickups(view.snap, now);
      this.drawHeads(view, now);
    }

    this.drawBursts(now);

    ctx.lineWidth = 2;
    ctx.strokeStyle = ARENA_EDGE;
    ctx.strokeRect(1, 1, ARENA_WIDTH - 2, ARENA_HEIGHT - 2);
  }

  // -------------------------------------------------------------------------
  // Trail baking
  // -------------------------------------------------------------------------

  /**
   * Copy stamped points from snapshots into the trail layer.
   *
   * Remote curves are baked only once render time has caught up with them, so
   * a curve's head and its own trail always agree. The local curve is baked
   * immediately, because its head is drawn *ahead* of the server via prediction.
   */
  private bake(renderTime: number): void {
    for (const entry of feed.entries) {
      const snap = entry.snap;
      if (snap.game !== 'achtung') continue;

      // Entries from a previous epoch describe trail that has already been
      // wiped. Skip them — re-processing would clear the layer every frame.
      if (snap.trailEpoch < this.trailEpoch) continue;

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

      const isReady = entry.at <= renderTime;
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

  private interpolate(
    renderTime: number,
  ): { snap: AchtungSnapshot; heads: Map<number, Motion> } | null {
    const found = bracket(feed.entries, renderTime);
    if (!found) return null;

    const fromSnap = found.from.snap;
    const toSnap = found.to?.snap;
    if (fromSnap.game !== 'achtung') return null;

    const heads = new Map<number, Motion>();
    for (const player of fromSnap.players) {
      const next =
        toSnap && toSnap.game === 'achtung'
          ? toSnap.players.find((p) => p.s === player.s)
          : undefined;

      if (!next || found.alpha === 0) {
        heads.set(player.s, { x: player.x, y: player.y, angle: player.a });
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
    const latest = feed.latest?.snap;
    const snap = latest && latest.game === 'achtung' ? latest : fromSnap;
    return { snap, heads };
  }

  private drawHeads(
    data: { snap: AchtungSnapshot; heads: Map<number, Motion> },
    now: number,
  ): void {
    const { ctx } = this.stage;
    const { snap, heads } = data;
    const showNames = snap.phase === 'countdown';

    for (const player of snap.players) {
      if (player.l !== 1) continue;

      const isLocal = player.s === this.context.mySeat;
      const head = isLocal ? this.drawLocalTip(player, now) : heads.get(player.s);
      if (!head) continue;

      const color = this.colorFor(player.s);
      const ghost = player.fx.includes('ghost');

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = isLocal ? 18 : 10;
      ctx.beginPath();
      ctx.arc(head.x, head.y, player.r * 1.7, 0, Math.PI * 2);
      if (ghost) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.restore();

      if (isLocal) {
        // A ring so you can always pick yourself out of eight curves.
        ctx.beginPath();
        ctx.arc(head.x, head.y, player.r * 3.4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // A hat on a head this small only reads at all if it is drawn well over
      // life size and without an outline; even then it is a silhouette, which
      // is enough to tell eight curves apart at a glance.
      const hat = this.context.hatBySeat[player.s] ?? 0;
      if (hat !== 0 && !ghost) {
        ctx.save();
        ctx.translate(head.x, head.y);
        drawHat(ctx, hat, color, Math.max(5, player.r * 2.4), false);
        ctx.restore();
      }

      if (snap.phase === 'countdown') this.drawHeadingArrow(head, color);

      if (showNames) {
        const name = this.context.nameBySeat[player.s];
        if (name) {
          ctx.font = '700 13px Rubik Variable, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
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
   * Draw the local curve's predicted tip and return the predicted head.
   *
   * The server-confirmed part of our trail is already baked; this bridges the
   * gap between the newest snapshot and where we actually are right now, which
   * is what makes turning feel instant instead of a round-trip late.
   */
  private drawLocalTip(player: SnapshotPlayer, now: number): Motion {
    const latest = feed.latest;
    const latestSnap = latest?.snap;
    const base =
      latestSnap && latestSnap.game === 'achtung'
        ? latestSnap.players.find((p) => p.s === player.s)
        : undefined;
    if (!latest || !base) return { x: player.x, y: player.y, angle: player.a };

    // Paused, the server is not advancing anyone — so neither should we.
    const leadMs = this.context.paused ? 0 : now - latest.at + feed.rttMs / 2;
    const ticks = clamp(Math.round(leadMs / TICK_MS), 0, MAX_PREDICT_TICKS);
    const turnRate = turnRateFor(this.context.settings);
    const inverted = base.fx.includes('invert');
    const turn = (inverted ? -localInput.turn : localInput.turn) as TurnDir;

    const motion: Motion = { x: base.x, y: base.y, angle: base.a };
    const path: Motion[] = [{ ...motion }];
    for (let i = 0; i < ticks; i++) {
      advanceMotion(motion, turn, base.v, turnRate);
      path.push({ ...motion });
    }

    if (base.d === 1 && base.l === 1 && path.length > 1) {
      const ctx = this.stage.ctx;
      ctx.save();
      ctx.strokeStyle = this.colorFor(player.s);
      ctx.lineWidth = base.r * 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(path[0]!.x, path[0]!.y);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i]!.x, path[i]!.y);
      ctx.stroke();
      ctx.restore();
    }

    return motion;
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

      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10, 12, 18, 0.85)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle = color;
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
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = burst.color;
      ctx.lineWidth = 3 * (1 - t) + 0.5;
      ctx.beginPath();
      ctx.arc(burst.x, burst.y, 6 + t * 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private colorFor(seat: number): string {
    return colorFor(this.context.colorBySeat[seat] ?? seat);
  }
}
