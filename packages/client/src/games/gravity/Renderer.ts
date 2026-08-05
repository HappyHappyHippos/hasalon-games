import { colorFor } from '@mg/shared';
import {
  RUN_HALF_H,
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
import { drawFace, drawHat } from '../../game/appearance';
import { feed } from '../../net/feed';
import { sfx } from '../../audio';
import { prefersReducedMotion } from '../../ui/motion';
import { GravityPredictor, advanceRunner, ticksBehind } from './predictor';

const LETTERBOX = '#0a0d14';
const BAND = '#1d2438';
const SOLID_EDGE = '#8f8778';

/** Where the camera holds the pack, as a fraction across the view. */
const CAMERA_ANCHOR = 0.34;

export interface GravityRenderContext {
  mySeat: number;
  colorBySeat: Record<number, number>;
  nameBySeat: Record<number, string>;
  hatBySeat: Record<number, number>;
  faceBySeat: Record<number, number>;
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
  private animPhase = 0;

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
    this.animPhase = (cameraX / 80) % 1;

    ctx.save();
    ctx.translate(-cameraX, 0);

    this.drawBackground(ctx, cameraX);
    this.drawTerrain(ctx, track, cameraX);

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

  // ---------------------------------------------------------------------------
  // Background — multi-layer parallax cityscape
  // ---------------------------------------------------------------------------

  private drawBackground(ctx: CanvasRenderingContext2D, cameraX: number): void {
    // Base sky gradient
    const skyGrad = ctx.createLinearGradient(cameraX, 0, cameraX, TRACK_HEIGHT);
    skyGrad.addColorStop(0, '#0b0e1a');
    skyGrad.addColorStop(0.5, '#141a29');
    skyGrad.addColorStop(1, '#1a1f33');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(cameraX, 0, VIEW_WIDTH, TRACK_HEIGHT);

    if (this.reduced) return;

    // Layer 0 — stars (very slow parallax)
    ctx.fillStyle = '#ffffff';
    const starDrift = cameraX * 0.03;
    for (let i = 0; i < 30; i += 1) {
      const sx = cameraX + ((i * 37 + 11 - (starDrift % VIEW_WIDTH) + VIEW_WIDTH) % VIEW_WIDTH);
      const sy = ((i * 53 + 7) % (TRACK_HEIGHT - 40)) + 10;
      const sr = i % 3 === 0 ? 1.5 : 1;
      ctx.globalAlpha = 0.3 + (i % 5) * 0.1;
      ctx.fillRect(sx, sy, sr, sr);
    }
    ctx.globalAlpha = 1;

    // Layer 1 — far city silhouettes (slow parallax)
    const farDrift = cameraX * 0.08;
    ctx.fillStyle = '#1a2035';
    for (let i = -1; i < 8; i += 1) {
      const bx = cameraX + (((i * 160 - (farDrift % 160) + 160) % (VIEW_WIDTH + 320)) - 160);
      const bh = 40 + (((i * 7 + 3) & 0x1f) % 60);
      const bw = 30 + (((i * 13 + 5) & 0x1f) % 40);
      ctx.fillRect(bx, TRACK_HEIGHT - bh, bw, bh);
      // Windows — tiny lit dots
      ctx.fillStyle = '#2a3a5a';
      for (let wy = TRACK_HEIGHT - bh + 8; wy < TRACK_HEIGHT - 6; wy += 12) {
        for (let wx = bx + 6; wx < bx + bw - 4; wx += 10) {
          if (((wx * 7 + wy * 3) & 3) !== 0) ctx.fillRect(wx, wy, 4, 5);
        }
      }
      ctx.fillStyle = '#1a2035';
    }

    // Layer 2 — mid city (medium parallax)
    const midDrift = cameraX * 0.18;
    ctx.fillStyle = '#1e2640';
    for (let i = -1; i < 6; i += 1) {
      const bx = cameraX + (((i * 210 + 50 - (midDrift % 210) + 210) % (VIEW_WIDTH + 420)) - 210);
      const bh = 60 + (((i * 11 + 7) & 0x1f) % 80);
      const bw = 40 + (((i * 17 + 2) & 0x1f) % 50);
      ctx.fillRect(bx, TRACK_HEIGHT - bh, bw, bh);
      // Windows
      ctx.fillStyle = '#3a4a6a';
      for (let wy = TRACK_HEIGHT - bh + 10; wy < TRACK_HEIGHT - 8; wy += 14) {
        for (let wx = bx + 8; wx < bx + bw - 6; wx += 12) {
          if (((wx * 11 + wy * 5) & 3) !== 0) ctx.fillRect(wx, wy, 5, 6);
        }
      }
      ctx.fillStyle = '#1e2640';
    }

    // Layer 3 — near bands (existing style, faster)
    ctx.fillStyle = BAND;
    const drift = cameraX * 0.35;
    for (let i = -1; i < 6; i += 1) {
      const x = cameraX + ((i * 260 - (drift % 260)) % (VIEW_WIDTH + 520));
      ctx.fillRect(x, 0, 90, TRACK_HEIGHT);
    }
  }

  // ---------------------------------------------------------------------------
  // Terrain — gradient tiles with rounded corners and edge highlights
  // ---------------------------------------------------------------------------

  private drawTerrain(ctx: CanvasRenderingContext2D, track: Track, cameraX: number): void {
    const first = Math.max(0, Math.floor(cameraX / TILE) - 1);
    const last = Math.min(track.cols - 1, Math.ceil((cameraX + VIEW_WIDTH) / TILE) + 1);
    for (let col = first; col <= last; col += 1) {
      for (let row = 0; row < track.rows; row += 1) {
        if (!isSolid(track, col, row)) continue;
        const x = col * TILE;
        const y = row * TILE;

        // Tile gradient for depth
        const tileGrad = ctx.createLinearGradient(x, y, x, y + TILE);
        tileGrad.addColorStop(0, '#f5efe2');
        tileGrad.addColorStop(1, '#e8e0d0');
        ctx.fillStyle = tileGrad;

        // Rounded rectangle for each tile
        const r = 4;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + TILE - r, y);
        ctx.quadraticCurveTo(x + TILE, y, x + TILE, y + r);
        ctx.lineTo(x + TILE, y + TILE - r);
        ctx.quadraticCurveTo(x + TILE, y + TILE, x + TILE - r, y + TILE);
        ctx.lineTo(x + r, y + TILE);
        ctx.quadraticCurveTo(x, y + TILE, x, y + TILE - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();

        // Edge highlights — a lip on the face that matters
        ctx.fillStyle = SOLID_EDGE;
        if (!isSolid(track, col, row + 1)) ctx.fillRect(x, y + TILE - 6, TILE, 6);
        if (!isSolid(track, col, row - 1)) ctx.fillRect(x, y, TILE, 6);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Runner — vector stick figure with animated limbs
  // ---------------------------------------------------------------------------

  private drawRunner(
    ctx: CanvasRenderingContext2D,
    body: RunnerBody,
    seat: number,
    mine: boolean,
  ): void {
    const color = colorFor(this.context.colorBySeat[seat] ?? seat);
    const hatIndex = this.context.hatBySeat[seat] ?? 0;
    const faceIndex = this.context.faceBySeat[seat] ?? 0;

    if (!this.reduced && !body.grounded) {
      // Flip trail — a faded silhouette at the previous surface.
      ctx.globalAlpha = 0.2;
      this.drawFigure(ctx, body.x, body.y - body.g * 26, color, 0.5, body.g, hatIndex, faceIndex, false);
      ctx.globalAlpha = 1;
    }

    // The phase drives the run animation. Airborne runners tuck.
    const phase = body.grounded ? this.animPhase : 0.5;
    this.drawFigure(ctx, body.x, body.y, color, phase, body.g, hatIndex, faceIndex, mine);

    const name = this.context.nameBySeat[seat];
    if (name) {
      ctx.fillStyle = '#efe9dc';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(name, body.x, body.y - body.g * (RUN_HALF_H + 10));
    }
  }

  /**
   * A procedural vector stick-figure runner.
   *
   * The figure is drawn in world space at (cx, cy), oriented by gravity `g`.
   * `phase` in [0, 1) drives the limb cycle: 0 and 1 are the same pose (right
   * leg forward), 0.5 is the mirror (left leg forward). When `phase` is exactly
   * 0.5 the limbs are centred — used for the airborne tuck pose.
   */
  private drawFigure(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    color: string,
    phase: number,
    g: 1 | -1,
    hatIndex: number,
    faceIndex: number,
    mine: boolean,
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    if (g === -1) ctx.scale(1, -1);

    // Proportions relative to RUN_HALF_H (22).
    const headR = 8;
    const neckY = -RUN_HALF_H + headR * 2 + 2;
    const hipY = RUN_HALF_H - 12;
    const footY = RUN_HALF_H - 1;
    const shoulderY = neckY + 2;

    // Limb swing — sinusoidal, ±1.
    const swing = Math.sin(phase * Math.PI * 2);
    const armSwing = swing * 8;
    const legSwing = swing * 10;

    const lw = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw;

    // --- Shadow (offset) ---
    ctx.strokeStyle = '#000000';
    ctx.save();
    ctx.translate(2, 2);
    this.strokeFigureLines(ctx, neckY, shoulderY, hipY, footY, armSwing, legSwing);
    ctx.restore();

    // --- Body ---
    ctx.strokeStyle = color;
    this.strokeFigureLines(ctx, neckY, shoulderY, hipY, footY, armSwing, legSwing);

    // --- Head ---
    // Shadow
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(2, -RUN_HALF_H + headR + 2, headR, 0, Math.PI * 2);
    ctx.fill();
    // Head fill
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, -RUN_HALF_H + headR, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // --- Hat and face (drawn on the head) ---
    ctx.save();
    ctx.translate(0, -RUN_HALF_H + headR);
    // Un-flip for face so it reads right-side-up regardless of gravity
    if (g === -1) ctx.scale(1, -1);
    drawFace(ctx, faceIndex, headR);
    drawHat(ctx, hatIndex, color, headR, false);
    ctx.restore();

    // --- "Mine" indicator ---
    if (mine) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, -RUN_HALF_H + headR, headR + 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  private strokeFigureLines(
    ctx: CanvasRenderingContext2D,
    neckY: number,
    shoulderY: number,
    hipY: number,
    footY: number,
    armSwing: number,
    legSwing: number,
  ): void {
    // Torso
    ctx.beginPath();
    ctx.moveTo(0, neckY);
    ctx.lineTo(0, hipY);
    ctx.stroke();

    // Right arm
    ctx.beginPath();
    ctx.moveTo(0, shoulderY);
    ctx.lineTo(armSwing, shoulderY + 14);
    ctx.stroke();

    // Left arm
    ctx.beginPath();
    ctx.moveTo(0, shoulderY);
    ctx.lineTo(-armSwing, shoulderY + 14);
    ctx.stroke();

    // Right leg
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(legSwing, footY);
    ctx.stroke();

    // Left leg
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(-legSwing, footY);
    ctx.stroke();
  }

  private drawGhost(ctx: CanvasRenderingContext2D, x: number, y: number, seat: number): void {
    ctx.globalAlpha = 0.15;
    const color = colorFor(this.context.colorBySeat[seat] ?? seat);
    const hatIndex = this.context.hatBySeat[seat] ?? 0;
    const faceIndex = this.context.faceBySeat[seat] ?? 0;
    // Frozen pose for ghosts
    this.drawFigure(ctx, x, y, color, 0.25, 1, hatIndex, faceIndex, false);
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
