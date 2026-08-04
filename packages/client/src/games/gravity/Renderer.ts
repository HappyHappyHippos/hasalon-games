import { colorFor } from '@mg/shared';
import {
  RUN_HALF_H,
  RUN_HALF_W,
  TILE,
  TRACK_HEIGHT,
  VIEW_WIDTH,
  buildTrack,
  isSolid,
  type GravitySnapshot,
  type RunnerBody,
  type Track,
} from '@mg/shared/gravity';
import { CanvasStage } from '../../game/CanvasStage';
import { feed } from '../../net/feed';
import { sfx } from '../../audio';
import { prefersReducedMotion } from '../../ui/motion';
import { GravityPredictor, advanceRunner, ticksBehind } from './predictor';

const LETTERBOX = '#0a0d14';
const SKY = '#141a29';
const BAND = '#1d2438';
const SOLID = '#efe9dc';
const SOLID_EDGE = '#8f8778';

/** Where the camera holds the pack, as a fraction across the view. */
const CAMERA_ANCHOR = 0.34;

export interface GravityRenderContext {
  mySeat: number;
  colorBySeat: Record<number, number>;
  nameBySeat: Record<number, string>;
  paused: boolean;
}

export class GravityRenderer {
  private readonly stage: CanvasStage;
  private raf = 0;
  private context: GravityRenderContext;

  private track: Track | null = null;
  private trackKey = -1;

  private readonly predictor = new GravityPredictor();
  private reduced = false;

  constructor(canvas: HTMLCanvasElement, context: GravityRenderContext) {
    // The track scrolls, so the stage is a fixed window onto it rather than the
    // whole world — unlike Tank Trouble, where the arena is the stage.
    this.stage = new CanvasStage(canvas, VIEW_WIDTH, TRACK_HEIGHT);
    this.context = context;
  }

  setContext(context: GravityRenderContext): void {
    this.context = context;
  }

  start(): void {
    this.reduced = prefersReducedMotion();
    this.stage.attach();
    this.predictor.reset();
    const loop = (now: number): void => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.stage.detach();
    this.predictor.reset();
  }

  private frame(now: number): void {
    const entry = feed.latest;
    if (!entry || entry.snap.game !== 'gravity') return;
    const snap: GravitySnapshot = entry.snap;

    const track = this.trackFor(snap);
    const { ctx } = this.stage;
    this.stage.begin(LETTERBOX);

    this.consumeEvents(snap);

    const controllable = snap.phase === 'playing' && !this.context.paused;
    const behind = ticksBehind(now, entry.serverAt);

    // Bodies first, because the camera follows them and drawing the world needs
    // to know where it is looking.
    const bodies = new Map<number, RunnerBody | null>();
    for (const player of snap.players) {
      bodies.set(
        player.s,
        player.s === this.context.mySeat
          ? this.predictor.update(now, track, player, snap.sp, controllable)
          : advanceRunner(player, track, behind, snap.sp, controllable),
      );
    }

    if (this.predictor.consumeFlip()) {
      const mine = bodies.get(this.context.mySeat);
      sfx.flip(mine ? mine.g === 1 : true);
    }

    const cameraX = this.cameraFor(snap, bodies);
    ctx.save();
    ctx.translate(-cameraX, 0);

    this.drawWorld(ctx, track, cameraX);

    for (const player of snap.players) {
      const body = bodies.get(player.s) ?? null;
      if (body) this.drawRunner(ctx, body, player.s, player.s === this.context.mySeat);
      else this.drawGhost(ctx, player.x, player.y, player.s);
    }

    ctx.restore();
  }

  /**
   * The camera is a pure function of the snapshot.
   *
   * Following the leader's *server* x rather than a locally smoothed one keeps
   * every client's view of the track identical, so nobody can be shown a gap a
   * moment before or after anyone else.
   */
  private cameraFor(snap: GravitySnapshot, bodies: Map<number, RunnerBody | null>): number {
    let lead = 0;
    for (const player of snap.players) {
      const body = bodies.get(player.s);
      const x = body ? body.x : player.x;
      if (player.al === 1 && x > lead) lead = x;
    }
    return Math.max(0, lead - VIEW_WIDTH * CAMERA_ANCHOR);
  }

  private trackFor(snap: GravitySnapshot): Track {
    if (this.track && this.trackKey === snap.tz) return this.track;
    this.track = buildTrack(snap.tz);
    this.trackKey = snap.tz;
    this.predictor.reset();
    return this.track;
  }

  private drawWorld(ctx: CanvasRenderingContext2D, track: Track, cameraX: number): void {
    ctx.fillStyle = SKY;
    ctx.fillRect(cameraX, 0, VIEW_WIDTH, TRACK_HEIGHT);

    if (!this.reduced) {
      // Parallax bands: the only cue that you are moving when the geometry
      // ahead happens to be flat.
      ctx.fillStyle = BAND;
      const drift = cameraX * 0.35;
      for (let i = -1; i < 6; i += 1) {
        const x = cameraX + ((i * 260 - (drift % 260)) % (VIEW_WIDTH + 520));
        ctx.fillRect(x, 0, 90, TRACK_HEIGHT);
      }
    }

    const first = Math.max(0, Math.floor(cameraX / TILE) - 1);
    const last = Math.min(track.cols - 1, Math.ceil((cameraX + VIEW_WIDTH) / TILE) + 1);
    for (let col = first; col <= last; col += 1) {
      for (let row = 0; row < track.rows; row += 1) {
        if (!isSolid(track, col, row)) continue;
        const x = col * TILE;
        const y = row * TILE;
        ctx.fillStyle = SOLID;
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = SOLID_EDGE;
        // A lip on the face that matters, so the surface reads as a surface
        // rather than a flat block of colour.
        if (!isSolid(track, col, row + 1)) ctx.fillRect(x, y + TILE - 6, TILE, 6);
        if (!isSolid(track, col, row - 1)) ctx.fillRect(x, y, TILE, 6);
      }
    }
  }

  private drawRunner(
    ctx: CanvasRenderingContext2D,
    body: RunnerBody,
    seat: number,
    mine: boolean,
  ): void {
    const color = colorFor(this.context.colorBySeat[seat] ?? seat);

    if (!this.reduced && !body.grounded) {
      // A short trail out of the surface you left, which is what makes someone
      // else's flip readable at a glance.
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = color;
      ctx.fillRect(
        body.x - RUN_HALF_W,
        body.y - body.g * 26 - RUN_HALF_H,
        RUN_HALF_W * 2,
        RUN_HALF_H * 2,
      );
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = '#000000';
    ctx.fillRect(body.x - RUN_HALF_W + 3, body.y - RUN_HALF_H + 3, RUN_HALF_W * 2, RUN_HALF_H * 2);
    ctx.fillStyle = color;
    ctx.fillRect(body.x - RUN_HALF_W, body.y - RUN_HALF_H, RUN_HALF_W * 2, RUN_HALF_H * 2);

    if (mine) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(body.x - RUN_HALF_W, body.y - RUN_HALF_H, RUN_HALF_W * 2, RUN_HALF_H * 2);
    }

    const name = this.context.nameBySeat[seat];
    if (name) {
      ctx.fillStyle = '#efe9dc';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(name, body.x, body.y - body.g * (RUN_HALF_H + 10));
    }
  }

  private drawGhost(ctx: CanvasRenderingContext2D, x: number, y: number, seat: number): void {
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = colorFor(this.context.colorBySeat[seat] ?? seat);
    ctx.fillRect(x - RUN_HALF_W, y - RUN_HALF_H, RUN_HALF_W * 2, RUN_HALF_H * 2);
    ctx.globalAlpha = 1;
  }

  /**
   * Your own flip is played the instant you press it, from the predictor, so it
   * is not gated behind half a round trip. The server's echo of your own flip is
   * therefore skipped — everyone else's is played on arrival.
   */
  private consumeEvents(snap: GravitySnapshot): void {
    for (const event of snap.events) {
      switch (event.t) {
        case 'flip':
          if (event.seat !== this.context.mySeat) sfx.flip(true);
          break;
        case 'land':
          sfx.land();
          break;
        case 'out':
          if (event.how === 'crushed') sfx.crush();
          else sfx.ringOut();
          break;
        case 'finish':
        case 'roundOver':
          sfx.win();
          break;
        default:
          break;
      }
    }
  }
}
