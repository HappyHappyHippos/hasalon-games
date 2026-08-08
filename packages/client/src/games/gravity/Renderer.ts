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
import { drawFace, drawHat } from '../../game/appearance';
import { PositionSmoother } from '../../game/PositionSmoother';
import { RemoteBodies } from '../../game/RemoteBodies';
import { feed } from '../../net/feed';
import { sfx } from '../../audio';
import { prefersReducedMotion } from '../../ui/motion';
import { cameraFor } from './camera';
import { GravityPredictor, advanceRunner, ticksBehind } from './predictor';

const LETTERBOX = '#0a0d14';
const BAND = '#1d2438';
const SOLID_EDGE = '#8f8778';
const INK = '#14110f';

/** Distance in world units for one full limb-swing cycle. */
const RUN_STRIDE = 80;
/** Per-seat phase offset so up to 8 runners don't swing their legs in sync. */
const SEAT_PHASE_OFFSET = 0.15;

/**
 * The run-cycle phase for a runner at world x, offset by seat so a crowd of
 * runners reads as a crowd rather than one figure copy-pasted eight times. A
 * pure function of position (never of elapsed frames or wall-clock time), so
 * it is exact under prediction and stable across a backgrounded tab.
 */
function runPhase(x: number, seat: number): number {
  const raw = x / RUN_STRIDE + seat * SEAT_PHASE_OFFSET;
  return raw - Math.floor(raw);
}

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
  /**
   * Absorbs the jump the local player's drawn position would otherwise take on
   * every resync (see `predictor.ts:RESYNC_DISTANCE`) or on the predicting/not
   * transition (round start, death, respawn) — same tool Gun Mayhem uses for
   * the identical problem: two different clocks (predicted vs. server-driven)
   * feeding the same point on screen.
   */
  private readonly smoother = new PositionSmoother();
  /**
   * The same for everyone else, who are extrapolated to the present rather than
   * predicted from local input — so their drawn position steps on every
   * snapshot by however wrong the previous guess was.
   *
   * `TERMINAL_VY` is 500, so a flip swings vertical velocity by up to 1000 and
   * a landing by up to 500. Ordinary falling is already modelled by
   * `advanceRunner`, which runs real `stepRunner` ticks, so what is left to
   * absorb is small. 300 sits above that residual and below the smallest real
   * event, which keeps flips crisp — sliding into a flip is exactly the
   * floatiness Gun Mayhem's note warns about.
   */
  private readonly remotes = new RemoteBodies(300);
  private wasPredicting = false;
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
    this.smoother.reset();
    this.remotes.clear();
    this.wasPredicting = false;
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
    this.smoother.reset();
    this.remotes.clear();
    this.wasPredicting = false;
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
    //
    // Each runner's own `sp` (not the top-level `snap.sp`, which is the shared
    // base ramp before catch-up) is their actual speed this tick — a runner
    // behind the leader runs faster per `catchUpMul`. Predicting or advancing
    // with the wrong (shared) speed drifts from the server by however much that
    // runner's catch-up multiplier differs from 1, and that drift gets yanked
    // back to the true position on every snapshot — which is exactly what read
    // as juddering.
    this.remotes.beginFrame(entry.serverAt);

    const bodies = new Map<number, RunnerBody | null>();
    for (const player of snap.players) {
      if (player.s === this.context.mySeat) {
        bodies.set(player.s, this.predictor.update(now, track, player, player.sp, controllable));
        continue;
      }

      const body = advanceRunner(player, track, behind, player.sp, controllable);
      if (!body) {
        // Out of the round. Their next appearance is a fresh spawn, not a
        // continuation of where they died.
        this.remotes.forget(player.s);
        bodies.set(player.s, null);
        continue;
      }

      // Horizontal speed is the same every tick, so only `vy` distinguishes a
      // flip or a landing from ordinary falling.
      const drawn = this.remotes.draw(player.s, body.x, body.y, { vx: 0, vy: body.vy }, now);
      bodies.set(player.s, { ...body, x: drawn.x, y: drawn.y });
    }

    // The local body is predicted from a different clock than everyone else's
    // (see predictor.ts), and every resync — or the predicting/not transition
    // at death, respawn or round start — moves it for a reason that is not
    // motion. Slide instead of snapping, the same fix Gun Mayhem uses.
    const myBody = bodies.get(this.context.mySeat);
    if (myBody) {
      const jumped = !this.wasPredicting || this.predictor.resynced;
      this.wasPredicting = true;
      const drawn = this.smoother.apply(myBody.x, myBody.y, now, jumped);
      bodies.set(this.context.mySeat, { ...myBody, x: drawn.x, y: drawn.y });
    } else {
      this.wasPredicting = false;
      this.smoother.reset();
    }

    if (this.predictor.consumeFlip()) {
      const mine = bodies.get(this.context.mySeat);
      sfx.flip(mine ? mine.g === 1 : true);
    }

    // Deliberately not given `bodies`: the camera is shared by everyone, so it
    // is built from the snapshot alone. See camera.ts.
    const cameraX = cameraFor(snap, track, behind, controllable);

    ctx.save();
    ctx.translate(-cameraX, 0);

    this.drawBackground(ctx, cameraX);
    this.drawTerrain(ctx, track, cameraX);

    // Draw everyone else first, the local player last, so a crowd overlapping
    // near the leader never buries the one runner you actually need to find.
    for (const player of snap.players) {
      if (player.s === this.context.mySeat) continue;
      const body = bodies.get(player.s) ?? null;
      if (body) this.drawRunner(ctx, body, player.s, false);
      else this.drawGhost(ctx, player.x, player.y, player.s);
    }
    const mine = snap.players.find((player) => player.s === this.context.mySeat);
    if (mine) {
      const body = bodies.get(mine.s) ?? null;
      if (body) this.drawRunner(ctx, body, mine.s, true);
      else this.drawGhost(ctx, mine.x, mine.y, mine.s);
    }

    ctx.restore();
  }

  private trackFor(snap: GravitySnapshot): Track {
    if (this.track && this.trackKey === snap.tz) return this.track;
    this.track = buildTrack(snap.tz);
    this.trackKey = snap.tz;
    this.predictor.reset();
    this.smoother.reset();
    this.remotes.clear();
    this.wasPredicting = false;
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
  // Runner — the same body/helmet/face/hat art as Gun Mayhem, so a player
  // looks like themselves in both games. `RUN_HALF_W`/`RUN_HALF_H` (14/22) are
  // close enough to Gun Mayhem's own half-extents (15/22) that the proportions
  // carry over unscaled.
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
      this.drawFigure(
        ctx,
        body.x,
        body.y - body.g * 26,
        color,
        0.5,
        body.g,
        hatIndex,
        faceIndex,
        false,
        true,
        0,
      );
      ctx.globalAlpha = 1;
    }

    // The phase drives the run animation, driven by this runner's own x rather
    // than the shared camera — otherwise every figure's legs swing in lockstep,
    // which reads as a rendering bug rather than a crowd of runners. Purely a
    // function of position (plus a per-seat offset so seats don't sync up with
    // each other either), so it stays stable across a backgrounded tab where
    // rAF is suspended and never depends on elapsed frames or wall clock.
    const phase = body.grounded ? runPhase(body.x, seat) : 0.5;
    this.drawFigure(ctx, body.x, body.y, color, phase, body.g, hatIndex, faceIndex, mine, body.grounded, body.vy);

    const name = this.context.nameBySeat[seat];
    if (name) {
      ctx.fillStyle = '#efe9dc';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(name, body.x, body.y - body.g * (RUN_HALF_H + 10));
    }
  }

  /**
   * A runner drawn with the shared character art (`game/appearance.ts`'s
   * `drawHat`/`drawFace`), body and legs styled the same way Gun Mayhem's
   * `drawCharacter` builds its figure — a rounded body block, a helmet arc,
   * face and hat on top.
   *
   * The figure is drawn in world space at (cx, cy). `g` orients it: the runner
   * flips gravity, so for `g === -1` the whole figure is mirrored on the y
   * axis (feet toward the ceiling) and the head sub-drawing is un-mirrored
   * again so the face still reads right-side-up. `phase` in [0, 1) drives the
   * limb cycle the same way the old stick figure did: 0 and 1 are the same
   * pose (right leg forward), 0.5 is the mirror. `grounded`/`vy` pick the
   * airborne tuck pose, same idea as Gun Mayhem's jump pose.
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
    grounded: boolean,
    vy: number,
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    if (g === -1) ctx.scale(1, -1);

    const w = RUN_HALF_W;
    const h = RUN_HALF_H;

    // --- Legs ---------------------------------------------------------------
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';

    if (!grounded) {
      // Tucked while rising away from the surface, reaching while falling
      // toward it. `g` folds into the sign because `vy` is world-frame but the
      // pose needs to know direction relative to *this* runner's gravity.
      const towardSurface = vy * g > 0;
      const tuck = towardSurface ? 3 : -5;
      ctx.beginPath();
      ctx.moveTo(-5, h - 10);
      ctx.lineTo(-7, h + tuck);
      ctx.moveTo(5, h - 10);
      ctx.lineTo(7, h - tuck);
      ctx.stroke();
    } else {
      const swing = Math.sin(phase * Math.PI * 2);
      const stride = swing * 6;
      const lift = Math.abs(Math.cos(phase * Math.PI * 2)) * 3;
      ctx.beginPath();
      ctx.moveTo(-5, h - 10);
      ctx.lineTo(-5 + stride, h - (stride > 0 ? lift : 0));
      ctx.moveTo(5, h - 10);
      ctx.lineTo(5 - stride, h - (stride < 0 ? lift : 0));
      ctx.stroke();
    }

    // --- Body -----------------------------------------------------------
    // With 8 players staggered vertically and gently bumping, overlap is
    // still common. A hard offset shadow plus a dark outline under each
    // figure lets a colour keep reading as itself even when it is crossing
    // another runner's limbs.
    ctx.save();
    ctx.translate(2, 2);
    ctx.fillStyle = '#000000';
    roundRect(ctx, -w, -h + 4, w * 2, h * 2 - 14, 8);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    roundRect(ctx, -w, -h + 4, w * 2, h * 2 - 14, 8);
    ctx.fill();
    ctx.stroke();

    // --- Helmet ---------------------------------------------------------
    ctx.fillStyle = shade(color, -0.25);
    ctx.beginPath();
    ctx.moveTo(-w, -h + 12);
    ctx.arc(0, -h + 12, w, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // --- Face and hat -----------------------------------------------------
    // The context is already flipped for gravity, so both draw as though
    // upright; a nested un-flip on the hat/face group keeps the drawing calls
    // themselves identical to Gun Mayhem's.
    ctx.save();
    ctx.translate(0, -h + 17);
    if (g === -1) ctx.scale(1, -1);
    drawFace(ctx, faceIndex, w * 0.8);
    ctx.restore();

    ctx.save();
    ctx.translate(0, -h + 12);
    if (g === -1) ctx.scale(1, -1);
    drawHat(ctx, hatIndex, color, w);
    ctx.restore();

    // --- "Mine" indicator ---
    if (mine) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, -h + 12, w + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawGhost(ctx: CanvasRenderingContext2D, x: number, y: number, seat: number): void {
    ctx.globalAlpha = 0.15;
    const color = colorFor(this.context.colorBySeat[seat] ?? seat);
    const hatIndex = this.context.hatBySeat[seat] ?? 0;
    const faceIndex = this.context.faceBySeat[seat] ?? 0;
    // Frozen standing pose for ghosts.
    this.drawFigure(ctx, x, y, color, 0.25, 1, hatIndex, faceIndex, false, true, 0);
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

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Darken (negative) or lighten (positive) a hex colour. Mirrors Gun Mayhem's helper. */
function shade(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const num = Number.parseInt(value, 16);
  const channel = (shift: number): number => {
    const base = (num >> shift) & 0xff;
    const next = amount < 0 ? base * (1 + amount) : base + (255 - base) * amount;
    return Math.round(Math.min(255, Math.max(0, next)));
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
