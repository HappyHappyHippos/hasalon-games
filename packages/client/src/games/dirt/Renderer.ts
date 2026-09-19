/**
 * Dirt Racing's canvas.
 *
 * ## Placeholders, and why this one cannot lie
 *
 * There is no art for this game yet. Every renderer here follows the house rule
 * that images are *decoration over* a complete procedural drawing (see
 * `game/images.ts`), but this one gets that for free in a stronger form: the
 * course it paints is drawn from `TrackGeometry` — **the same segment array the
 * server collides against**. So the placeholder is not an approximation of the
 * track, it is the track. A car stops where the picture says it stops because
 * there is only one description of where that is.
 *
 * When real art arrives it goes *behind* this, and the ribbons keep being the
 * truth. Every place a file would be used is marked ASSET SWAP POINT below; all
 * of them fail soft, and all of them are one path each.
 *
 * ## What is predicted and what is not
 *
 * The local car is predicted (`predictor.ts`), everyone else is extrapolated
 * from the newest snapshot and smoothed by `RemoteBodies`. The event threshold
 * passed to it is in this game's velocity units: ordinary acceleration is a few
 * tens of units per snapshot, and hitting a rock or a boost landing is several
 * hundred, so 220 sits between "a guess that was a bit stale" and "something
 * happened that no guess could have contained".
 */

import { colorFor } from '@mg/shared';
import {
  ARENA_H,
  ARENA_W,
  CAR_R,
  DIRT_POWERUPS,
  DIRT_TRACKS,
  MINE_R,
  PAD_R,
  surfaceAt,
  trackGeometry,
  type DirtEvent,
  type DirtPowerup,
  type DirtSnapshot,
  type RibbonPoint,
  type TrackGeometry,
} from '@mg/shared/dirt';
import { CanvasStage } from '../../game/CanvasStage';
import { hexToRgba, roundRect, shade } from '../../game/canvasDraw';
import { PositionSmoother } from '../../game/PositionSmoother';
import { RemoteBodies } from '../../game/RemoteBodies';
import { getImage } from '../../game/images';
import { feed } from '../../net/feed';
import { sfx } from '../../audio';
import { prefersReducedMotion } from '../../ui/motion';
import { DirtPredictor, advanceCar, ticksBehind } from './predictor';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const LETTERBOX = '#100f16';
const KERB_LIGHT = '#f4ead6';
const KERB_DARK = '#bb4630';
const INK = '#191420';

/** Hard offset shadow, never a blur — see the note at the top of `tokens.css`. */
const SHADOW_OFFSET = 3;

const DEBUG_TERRAIN =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('debugTerrain');

export interface DirtRenderContext {
  mySeat: number;
  colorBySeat: Record<number, number>;
  nameBySeat: Record<number, string>;
  paused: boolean;
}

/** One skid mark. Local only — never in a snapshot; see the note on `pushSkid`. */
interface Skid {
  x: number;
  y: number;
  angle: number;
  born: number;
  seat: number;
}

const SKID_LIFE_MS = 4200;
const MAX_SKIDS = 900;

/**
 * A puff of something — dust off the shoulder, tyre smoke off a drift, sparks
 * off a rock.
 *
 * Local, like the skid marks, and for the same reason: it is all derived from
 * flags the snapshot already carries, so putting the particles themselves on
 * the wire would pay 30 Hz of bandwidth for something every client can work out
 * for itself. Two clients disagreeing about where a speck of dust is costs
 * nothing.
 */
interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  r: number;
  color: string;
  /** Sparks are drawn as streaks, dust as blobs. */
  spark: boolean;
}

const MAX_PUFFS = 260;

export class DirtRenderer {
  private stage: CanvasStage | null = null;
  private raf = 0;
  private context: DirtRenderContext;

  private geometry: TrackGeometry | null = null;
  private trackKey = '';

  private readonly predictor = new DirtPredictor();
  /** Absorbs the jump when the local car changes which clock it is drawn from. */
  private readonly smoother = new PositionSmoother();
  /** See the note at the top of the file for where 220 comes from. */
  private readonly remotes = new RemoteBodies(220);

  private skids: Skid[] = [];
  private puffs: Puff[] = [];
  private shake = 0;
  private reduced = false;
  private vignette: CanvasGradient | null = null;
  /** Rebuilt when the course changes; the ribbons never move within a race. */
  private courseLayer: HTMLCanvasElement | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    context: DirtRenderContext,
  ) {
    this.context = context;
  }

  setContext(context: DirtRenderContext): void {
    this.context = context;
  }

  start(): void {
    this.reduced = prefersReducedMotion();
    this.predictor.reset();
    const loop = (now: number): void => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.stage?.detach();
    this.stage = null;
    this.predictor.reset();
    this.smoother.reset();
    this.remotes.clear();
    this.skids = [];
    this.puffs = [];
    this.courseLayer = null;
  }

  // -------------------------------------------------------------------------

  private frame(now: number): void {
    const entry = feed.latest;
    if (!entry || entry.snap.game !== 'dirt') return;
    const snap: DirtSnapshot = entry.snap;

    const geometry = this.geometryFor(snap);
    const stage = this.stageFor();
    if (!stage) return;

    stage.begin(LETTERBOX);
    const { ctx } = stage;

    this.consumeEvents(snap, now);

    if (this.shake > 0.2) {
      const amount = this.shake;
      ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
      this.shake *= 0.85;
    } else {
      this.shake = 0;
    }

    this.drawCourse(ctx, geometry);
    this.drawSkids(ctx, now);
    this.drawPuffs(ctx, now);
    this.drawPads(ctx, snap, now);
    this.drawMines(ctx, snap, now);
    this.drawCars(ctx, snap, geometry, now, entry.serverAt);
    this.drawVignette(ctx);
    if (DEBUG_TERRAIN) this.drawTerrainDebug(ctx, geometry);
  }

  /**
   * The course is deterministic from the track id in the snapshot, so nothing
   * about it is ever sent. A mid-race joiner gets the whole thing from the
   * first frame they receive.
   */
  private geometryFor(snap: DirtSnapshot): TrackGeometry {
    if (this.geometry && this.trackKey === snap.tk) return this.geometry;
    this.geometry = trackGeometry(DIRT_TRACKS[snap.tk] ?? DIRT_TRACKS.canyon);
    this.trackKey = snap.tk;
    // A new course means every smoothed position is about to teleport, and
    // every skid mark is on a road that no longer exists.
    this.smoother.reset();
    this.remotes.clear();
    this.predictor.reset();
    this.skids = [];
    this.puffs = [];
    this.courseLayer = null;
    return this.geometry;
  }

  private stageFor(): CanvasStage | null {
    if (this.stage) return this.stage;
    this.stage = new CanvasStage(this.canvas, ARENA_W, ARENA_H);
    this.stage.attach();
    return this.stage;
  }

  // -------------------------------------------------------------------------
  // The course
  // -------------------------------------------------------------------------

  /**
   * Painted once into an offscreen canvas and blitted every frame.
   *
   * The ribbons are a few hundred path points across three passes plus the
   * kerbs, and none of it moves for the length of a race — redrawing it sixty
   * times a second is the one obviously wasteful thing this renderer could do.
   */
  private drawCourse(ctx: CanvasRenderingContext2D, geometry: TrackGeometry): void {
    if (!this.courseLayer) this.courseLayer = this.paintCourse(geometry);
    if (this.courseLayer) ctx.drawImage(this.courseLayer, 0, 0, ARENA_W, ARENA_H);
  }

  private paintCourse(geometry: TrackGeometry): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    const layer = document.createElement('canvas');
    layer.width = ARENA_W;
    layer.height = ARENA_H;
    const ctx = layer.getContext('2d');
    if (!ctx) return null;

    // ── ASSET SWAP POINT ────────────────────────────────────────────────────
    // The painted course, drawn under everything. The ribbons below stay the
    // truth about where the track is; art only replaces how it looks. Path is
    // `tracks.ts`'s `backdropUrl`, 1600×900.
    // ────────────────────────────────────────────────────────────────────────
    const backdrop = getImage(geometry.backdropUrl);
    const pal = geometry.palette;

    if (backdrop) {
      ctx.fillStyle = pal.scenery;
      ctx.fillRect(0, 0, ARENA_W, ARENA_H);
      ctx.drawImage(backdrop, 0, 0, ARENA_W, ARENA_H);
      // Even with art, the kerbs are drawn from the geometry — they are the
      // one thing a driver reads at speed and they must mark the real edge.
      this.strokeKerbs(ctx, geometry);
      return layer;
    }

    // Scenery, in layers. Flat colour reads as a background; a base plus
    // patches plus flecks reads as ground you are driving past.
    ctx.fillStyle = pal.scenery;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);

    // Broad tonal patches first — the thing that stops a big empty region
    // looking like a fill. Deterministic from position, so it never crawls.
    ctx.fillStyle = pal.sceneryDetail;
    for (let y = 0; y < ARENA_H; y += 90) {
      for (let x = 0; x < ARENA_W; x += 90) {
        const h = hash2(x * 0.7, y * 0.7);
        if (h > 0.5) continue;
        ctx.beginPath();
        ctx.ellipse(x + h * 90, y + h * 70, 60 + h * 90, 40 + h * 60, h * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Scatter: little rocks and tufts out in the scenery. Purely something for
    // the eye to measure speed against — none of it is collidable, because
    // everything out here is solid already.
    for (let y = 14; y < ARENA_H; y += 34) {
      for (let x = 14; x < ARENA_W; x += 34) {
        const h = hash2(x, y);
        if (h > 0.34) continue;
        const px = x + h * 60 - 15;
        const py = y + hash2(y, x) * 50 - 12;
        const r = 3 + h * 9;
        ctx.fillStyle = pal.propShade;
        ctx.beginPath();
        ctx.ellipse(px, py + r * 0.5, r * 1.1, r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = pal.prop;
        ctx.beginPath();
        ctx.ellipse(px, py, r, r * 0.82, h * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Shoulder, then the racing surface on top of it — two passes of the same
    // ribbon at two widths, which is why the shoulder is always exactly as wide
    // as the physics says and never a hand-drawn approximation of it.
    fillRibbon(ctx, geometry.outline, (q) => q.w + q.s, pal.offroad, true);
    for (const cut of geometry.shortcutOutlines) {
      fillRibbon(ctx, cut, (q) => q.w + q.s, pal.offroad, false);
    }
    // A soft dark lip where the shoulder meets the scenery, so the drivable
    // world has an edge rather than just ending.
    strokeRibbonEdge(ctx, geometry.outline, (q) => q.w + q.s, 'rgba(0, 0, 0, 0.22)', 7, true);

    fillRibbon(ctx, geometry.outline, (q) => q.w, pal.track, true);
    for (const cut of geometry.shortcutOutlines) {
      fillRibbon(ctx, cut, (q) => q.w, pal.track, false);
    }

    // The worn racing line: a darker band down the middle where the cars go.
    // Sells the road as something that has been driven on more than anything
    // else here, for one stroke.
    ctx.save();
    clipRibbon(ctx, geometry.outline, (q) => q.w, true);
    ctx.strokeStyle = pal.trackWorn;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    geometry.outline.forEach((q, i) => {
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.lineWidth = 74;
    ctx.globalAlpha = 0.55;
    ctx.stroke();
    ctx.lineWidth = 40;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Ruts along the direction of travel, so the surface reads as a road with a
    // direction rather than as a brown shape.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.09)';
    ctx.lineWidth = 4;
    for (const side of [-0.62, -0.28, 0.28, 0.62]) {
      ctx.beginPath();
      geometry.outline.forEach((q, i) => {
        const n = normalAt(geometry.outline, i, true);
        const x = q.x + n.x * q.w * side;
        const y = q.y + n.y * q.w * side;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    this.strokeKerbs(ctx, geometry);
    this.drawStartLine(ctx, geometry);
    this.drawSolids(ctx, geometry);
    return layer;
  }

  /**
   * The red-and-white edge of the racing surface.
   *
   * Drawn from the ribbon rather than as decoration on the backdrop, because
   * this is the line a driver actually steers by — if it were art it could
   * disagree with where the grass starts, and then the game would be lying
   * about the only thing it needs to be honest about at 430 units a second.
   */
  private strokeKerbs(ctx: CanvasRenderingContext2D, geometry: TrackGeometry): void {
    for (const sign of [-1, 1]) {
      const pts = geometry.outline.map((p, i) => {
        const n = normalAt(geometry.outline, i, true);
        return { x: p.x + n.x * p.w * sign, y: p.y + n.y * p.w * sign };
      });

      // Alternating blocks, walked by arc length so they stay the same size
      // through a hairpin as down a straight. Drawn twice: a dark seat first,
      // then the blocks on top, which gives the kerb thickness without a blur.
      let run = 0;
      ctx.lineCap = 'butt';
      for (const pass of [0, 1]) {
        run = 0;
        for (let i = 0; i < pts.length; i += 1) {
          const a = pts[i]!;
          const b = pts[(i + 1) % pts.length]!;
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (pass === 0) {
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.lineWidth = 12;
          } else {
            ctx.strokeStyle = Math.floor(run / 30) % 2 === 0 ? KERB_LIGHT : KERB_DARK;
            ctx.lineWidth = 8;
          }
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          run += len;
        }
      }
    }
  }

  /**
   * The start/finish line, square across the track.
   *
   * The rotation is the whole thing, and it was wrong: `atan2(-n.x, n.y)` maps
   * the local +x axis to a vector that is neither the normal nor the tangent,
   * so the chequer band sat skew to the road and hung off one side of it. The
   * band has to run *along the normal* — local +x → n is `atan2(n.y, n.x)`.
   */
  private drawStartLine(ctx: CanvasRenderingContext2D, geometry: TrackGeometry): void {
    const start = geometry.outline[0];
    if (!start) return;
    const n = normalAt(geometry.outline, 0, true);
    const squares = 8;
    // Out to the kerb rather than the bare surface, so the line meets the edge
    // of the road instead of stopping short of it.
    const half = start.w + 4;
    const cell = (half * 2) / squares;

    ctx.save();
    ctx.translate(start.x, start.y);
    ctx.rotate(Math.atan2(n.y, n.x));

    for (let i = 0; i < squares; i += 1) {
      for (let row = 0; row < 2; row += 1) {
        ctx.fillStyle = (i + row) % 2 === 0 ? '#f7f2e8' : INK;
        ctx.fillRect(-half + i * cell, -cell + row * cell, cell, cell);
      }
    }
    ctx.restore();
  }

  private drawSolids(ctx: CanvasRenderingContext2D, geometry: TrackGeometry): void {
    const pal = geometry.palette;
    for (const pass of [0, 1]) {
      const offset = pass === 0 ? SHADOW_OFFSET : 0;
      for (const box of geometry.solids) {
        // ── ASSET SWAP POINT ────────────────────────────────────────────────
        // A per-track prop sheet would go here, drawn into the same rectangle.
        // The box stays the hitbox either way — see `tracks.ts`.
        // ────────────────────────────────────────────────────────────────────
        ctx.fillStyle = pass === 0 ? 'rgba(0, 0, 0, 0.55)' : pal.solid;
        roundRect(ctx, box.x + offset, box.y + offset, box.w, box.h, 10);
        ctx.fill();
        if (pass === 0) continue;

        // A lit top face and a hard ink edge: the same flat 2.5D language the
        // other games' stages use, so these read as objects standing on the
        // ground rather than holes cut in it.
        ctx.fillStyle = pal.solidTop;
        roundRect(ctx, box.x + 5, box.y + 4, box.w - 10, Math.max(5, box.h * 0.42), 7);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.lineWidth = 2.5;
        roundRect(ctx, box.x, box.y, box.w, box.h, 10);
        ctx.stroke();
      }
    }
  }

  /** `?debugTerrain` — samples the real terrain function, not a second copy of it. */
  private drawTerrainDebug(ctx: CanvasRenderingContext2D, geometry: TrackGeometry): void {
    ctx.save();
    ctx.globalAlpha = 0.4;
    for (let y = 0; y < ARENA_H; y += 12) {
      for (let x = 0; x < ARENA_W; x += 12) {
        const surface = surfaceAt(geometry, x, y);
        ctx.fillStyle =
          surface === 'track' ? '#2ecc71' : surface === 'offroad' ? '#f1c40f' : '#e74c3c';
        ctx.fillRect(x, y, 4, 4);
      }
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Track furniture
  // -------------------------------------------------------------------------

  private drawPads(ctx: CanvasRenderingContext2D, snap: DirtSnapshot, now: number): void {
    for (const pad of snap.pads) {
      // An empty pad still draws its plate, so the racing line stays learnable:
      // you should be able to plan to come through here next lap.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.beginPath();
      ctx.ellipse(pad.x, pad.y + 3, PAD_R * 1.2, PAD_R * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = pad.k ? 'rgba(255, 244, 214, 0.75)' : 'rgba(255, 244, 214, 0.28)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(pad.x, pad.y + 3, PAD_R * 1.2, PAD_R * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();

      if (!pad.k) continue;

      // A ring that expands and fades on a loop — the "come and get it" cue,
      // and the only thing on the track that moves when nothing is happening.
      if (!this.reduced) {
        const beat = ((now / 1100) % 1);
        ctx.strokeStyle = `rgba(255, 244, 214, ${0.5 * (1 - beat)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(pad.x, pad.y + 3, PAD_R * (0.7 + beat * 1.1), PAD_R * (0.36 + beat * 0.6), 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      const bob = this.reduced ? 0 : Math.sin(now / 380 + pad.x * 0.05) * 3;
      const cy = pad.y + bob;
      const r = PAD_R;

      // ── ASSET SWAP POINT ──────────────────────────────────────────────────
      // Per-powerup icons at `/powerups/powerup_dirt_<kind>.png`, square. The
      // glyphs below are the fallback and are drawn as paths, never emoji —
      // emoji rendering varies by platform and reads as UI, not game world.
      // ──────────────────────────────────────────────────────────────────────
      const img = getImage(`/powerups/powerup_dirt_${pad.k}.png`);
      if (img) {
        ctx.drawImage(img, pad.x - r, cy - r, r * 2, r * 2);
        continue;
      }

      const spec = DIRT_POWERUPS[pad.k];
      ctx.fillStyle = '#000000';
      roundRect(ctx, pad.x - r + SHADOW_OFFSET, cy - r + SHADOW_OFFSET, r * 2, r * 2, r * 0.5);
      ctx.fill();
      ctx.fillStyle = spec.color;
      roundRect(ctx, pad.x - r, cy - r, r * 2, r * 2, r * 0.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = 2;
      roundRect(ctx, pad.x - r, cy - r, r * 2, r * 2, r * 0.5);
      ctx.stroke();

      ctx.save();
      ctx.translate(pad.x, cy);
      drawPowerupGlyph(ctx, pad.k, r * 0.72);
      ctx.restore();
    }
  }

  private drawMines(ctx: CanvasRenderingContext2D, snap: DirtSnapshot, now: number): void {
    for (const mine of snap.mines) {
      const armed = mine.ar === 1;
      // An unarmed mine is visibly not a threat yet, which is what makes
      // dropping one at speed a decision rather than a coin flip.
      const pulse = this.reduced || !armed ? 1 : 1 + Math.sin(now / 140) * 0.12;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.ellipse(mine.x + 2, mine.y + 3, MINE_R * 0.9, MINE_R * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();

      // An armed mine blinks; an unarmed one is flat and dull. Two states you
      // can tell apart at speed without reading anything.
      const blink = armed && !this.reduced && Math.floor(now / 260) % 2 === 0;
      ctx.fillStyle = armed ? (blink ? '#ff5b45' : '#ffd447') : '#8d8470';
      ctx.beginPath();
      ctx.arc(mine.x, mine.y, MINE_R * 0.7 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = INK;
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(
          mine.x + Math.cos(a) * MINE_R * 0.72 * pulse,
          mine.y + Math.sin(a) * MINE_R * 0.72 * pulse,
          3,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Cars
  // -------------------------------------------------------------------------

  private drawCars(
    ctx: CanvasRenderingContext2D,
    snap: DirtSnapshot,
    geometry: TrackGeometry,
    now: number,
    serverAt: number,
  ): void {
    const behind = ticksBehind(now, serverAt);
    const controllable = snap.phase === 'racing' && !this.context.paused;

    // Once per frame, not once per car: the smoothing rule keys off whether
    // this frame is the first to see a newer snapshot.
    this.remotes.beginFrame(serverAt);

    for (const car of snap.cars) {
      const mine = car.s === this.context.mySeat;
      const driving = controllable && car.fp === 0;
      const body = mine
        ? this.predictor.update(now, geometry, car, driving)
        : advanceCar(car, geometry, behind, driving);

      const drawn = mine
        ? this.smoother.apply(body.x, body.y, now, this.predictor.resynced)
        : this.remotes.draw(car.s, body.x, body.y, { vx: body.vx, vy: body.vy }, now);

      if (car.df === 1 && !this.reduced) this.pushSkid(drawn.x, drawn.y, body.angle, car.s, now);

      // Flourishes, all derived from what the snapshot already says.
      const speed = Math.hypot(body.vx, body.vy);
      // Named for the part of the car, not the clock — `behind` above is how
      // many ticks stale the snapshot is.
      const tail = {
        x: drawn.x - Math.cos(body.angle) * CAR_R,
        y: drawn.y - Math.sin(body.angle) * CAR_R,
      };

      if (surfaceAt(geometry, drawn.x, drawn.y) === 'offroad' && speed > 60) {
        // Rooster tail off the shoulder, in the colour of the ground it is
        // being thrown off.
        this.emit(now, tail.x, tail.y, 2, geometry.palette.offroad, {
          spread: 1.1, speed: 70, life: 620, r: 8,
        });
      } else if (car.df === 1 && speed > 120) {
        // Tyre smoke off a drift — paler and slower than dust.
        this.emit(now, tail.x, tail.y, 1, '#d9d2c6', { spread: 0.9, speed: 34, life: 760, r: 9 });
      }

      if (car.bo) {
        // Boost throws sparks straight out the back.
        this.emit(now, tail.x, tail.y, 2, '#ffbe3c', {
          spread: 0.5, speed: 150, life: 320, r: 4, spark: true,
        });
      }

      this.drawCar(ctx, drawn.x, drawn.y, body.angle, car, now, speed);
    }
  }

  private drawCar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    car: DirtSnapshot['cars'][number],
    now: number,
    speed: number,
  ): void {
    const color = colorFor(this.context.colorBySeat[car.s] ?? car.s);
    const finished = car.fp > 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Speed streaks either side while boosting — the cheapest possible "this
    // is fast" and it reads instantly at a glance.
    if (car.bo && !this.reduced && speed > 100) {
      ctx.strokeStyle = 'rgba(255, 226, 150, 0.5)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        const off = side * CAR_R * 1.15;
        ctx.beginPath();
        ctx.moveTo(-CAR_R * 1.3, off);
        ctx.lineTo(-CAR_R * (2.4 + Math.sin(now / 60 + side) * 0.5), off);
        ctx.stroke();
      }
    }

    // Boost flame, behind the car so it reads as thrust rather than as a decal.
    if (car.bo && !this.reduced) {
      const flick = 0.75 + Math.sin(now / 40) * 0.25;
      ctx.fillStyle = 'rgba(255, 190, 60, 0.85)';
      ctx.beginPath();
      ctx.moveTo(-CAR_R * 1.05, -6);
      ctx.lineTo(-CAR_R * (1.6 + flick * 0.8), 0);
      ctx.lineTo(-CAR_R * 1.05, 6);
      ctx.closePath();
      ctx.fill();
    }

    ctx.globalAlpha = finished ? 0.45 : car.gh ? 0.6 : 1;

    // ── ASSET SWAP POINT ──────────────────────────────────────────────────
    // A car sprite at `/cars/car_<colorIndex>.png`, drawn nose-right so the
    // rotation above points it the way it is driving. Until one exists the
    // body below is the car — it is a complete drawing, not a stand-in shape.
    // ──────────────────────────────────────────────────────────────────────
    const sprite = getImage(`/cars/car_${this.context.colorBySeat[car.s] ?? car.s}.png`);
    if (sprite) {
      ctx.drawImage(sprite, -CAR_R * 1.5, -CAR_R, CAR_R * 3, CAR_R * 2);
    } else {
      const len = CAR_R * 1.5;
      const wide = CAR_R * 0.94;
      // The front wheels turn. Tiny detail, but it is the only part of the car
      // that shows what the player is *asking* for rather than what the car is
      // doing, and at this size it is the difference between a shape sliding
      // around and something being driven.
      const lock = (car.st ?? 0) * 0.5;

      // Ground shadow, offset the same way as everything else here.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      roundRect(ctx, -len + SHADOW_OFFSET, -wide + SHADOW_OFFSET, len * 2, wide * 2, 8);
      ctx.fill();

      // Wheels under the body, rears square on, fronts steered.
      ctx.fillStyle = '#15120f';
      for (const wy of [-wide - 1, wide - 6]) {
        roundRect(ctx, -len * 0.68 - 9, wy, 18, 7, 3);
        ctx.fill();
      }
      for (const wy of [-wide - 1, wide - 6]) {
        ctx.save();
        ctx.translate(len * 0.62, wy + 3.5);
        ctx.rotate(lock);
        roundRect(ctx, -9, -3.5, 18, 7, 3);
        ctx.fill();
        ctx.restore();
      }

      // Body, then a darker nose and a lighter shoulder line: three tones is
      // enough to read as a moulded shape rather than a rectangle.
      ctx.fillStyle = color;
      roundRect(ctx, -len, -wide, len * 2, wide * 2, 8);
      ctx.fill();

      ctx.fillStyle = shade(color, -0.34);
      roundRect(ctx, len * 0.3, -wide + 2, len * 0.62, wide * 2 - 4, 6);
      ctx.fill();

      ctx.fillStyle = shade(color, 0.28);
      roundRect(ctx, -len + 4, -wide + 3, len * 1.1, 5, 3);
      ctx.fill();

      // Cockpit and a helmet, so the car has a driver and a clear front.
      ctx.fillStyle = 'rgba(24, 30, 40, 0.85)';
      roundRect(ctx, -len * 0.16, -wide * 0.66, len * 0.5, wide * 1.32, 4);
      ctx.fill();
      ctx.fillStyle = shade(color, 0.5);
      ctx.beginPath();
      ctx.arc(len * 0.02, 0, wide * 0.38, 0, Math.PI * 2);
      ctx.fill();

      // Rear light bar, brighter under boost.
      ctx.fillStyle = car.bo ? '#ffd166' : '#c2402f';
      roundRect(ctx, -len + 1, -wide * 0.62, 4, wide * 1.24, 2);
      ctx.fill();

      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      roundRect(ctx, -len, -wide, len * 2, wide * 2, 8);
      ctx.stroke();
    }

    ctx.restore();

    // Effect badges ride above the car, unrotated — a marker that spun with the
    // car would be unreadable on the one car that most needs reading.
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 1;

    if (car.sp) this.drawSpinBadge(ctx, now);

    if (car.s === this.context.mySeat && !finished) {
      // A ring under your own car. Eight cars in one colour scheme is a lot to
      // pick yourself out of at speed.
      ctx.strokeStyle = hexToRgba('#ffffff', 0.9);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, CAR_R + 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }


  private drawSpinBadge(ctx: CanvasRenderingContext2D, now: number): void {
    if (this.reduced) return;
    ctx.save();
    ctx.strokeStyle = '#ffd447';
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i += 1) {
      const a = (now / 90 + (i * Math.PI * 2) / 3) % (Math.PI * 2);
      ctx.beginPath();
      ctx.arc(0, 0, CAR_R + 10, a, a + 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Skid marks
  // -------------------------------------------------------------------------

  /**
   * Skid marks are local, and deliberately not in the snapshot.
   *
   * They are pure decoration derived from a flag the server already sends, so
   * putting the marks themselves on the wire would be paying 30 Hz of bandwidth
   * for something every client can draw from what it already has. Two clients
   * disagreeing about where a smudge is costs nothing; Achtung's trail is in
   * its snapshot precisely because there, it would cost everything.
   */
  private pushSkid(x: number, y: number, angle: number, seat: number, now: number): void {
    const last = this.skids[this.skids.length - 1];
    if (last && last.seat === seat && Math.hypot(last.x - x, last.y - y) < 7) return;
    this.skids.push({ x, y, angle, born: now, seat });
    if (this.skids.length > MAX_SKIDS) this.skids.splice(0, this.skids.length - MAX_SKIDS);
  }

  /**
   * Throw a few particles. Capped hard, because eight cars drifting through one
   * corner would otherwise emit faster than they expire.
   */
  private emit(
    now: number,
    x: number,
    y: number,
    count: number,
    color: string,
    opts: { spread?: number; speed?: number; life?: number; r?: number; spark?: boolean } = {},
  ): void {
    if (this.reduced) return;
    const spread = opts.spread ?? Math.PI * 2;
    const speed = opts.speed ?? 40;
    for (let i = 0; i < count; i += 1) {
      if (this.puffs.length >= MAX_PUFFS) break;
      const a = (Math.random() - 0.5) * spread;
      const v = speed * (0.4 + Math.random() * 0.9);
      this.puffs.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        born: now,
        life: (opts.life ?? 520) * (0.7 + Math.random() * 0.6),
        r: (opts.r ?? 7) * (0.6 + Math.random() * 0.8),
        color,
        spark: opts.spark ?? false,
      });
    }
  }

  private drawPuffs(ctx: CanvasRenderingContext2D, now: number): void {
    if (this.puffs.length === 0) return;
    let write = 0;
    for (const puff of this.puffs) {
      const age = (now - puff.born) / puff.life;
      if (age >= 1) continue;
      this.puffs[write] = puff;
      write += 1;

      // Position is integrated from the particle's own age rather than stepped
      // per frame, so a dropped frame does not stall the animation.
      const t = (now - puff.born) / 1000;
      const x = puff.x + puff.vx * t;
      const y = puff.y + puff.vy * t;
      const fade = 1 - age;

      ctx.globalAlpha = fade * (puff.spark ? 0.95 : 0.5);
      ctx.fillStyle = puff.color;
      if (puff.spark) {
        ctx.strokeStyle = puff.color;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - puff.vx * 0.02, y - puff.vy * 0.02);
        ctx.stroke();
      } else {
        // Dust grows as it disperses.
        ctx.beginPath();
        ctx.arc(x, y, puff.r * (1 + age * 1.4), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    this.puffs.length = write;
  }

  /**
   * A soft darkening at the edges of the arena.
   *
   * The one deliberate gradient in this renderer. The house rule is hard offset
   * shadows and no blur, but that is about *objects* — this is light, it sits
   * behind nothing, and without it a flat-lit top-down map has no centre for
   * the eye to sit in.
   */
  private drawVignette(ctx: CanvasRenderingContext2D): void {
    if (this.reduced) return;
    if (!this.vignette) {
      const g = ctx.createRadialGradient(
        ARENA_W / 2, ARENA_H / 2, Math.min(ARENA_W, ARENA_H) * 0.42,
        ARENA_W / 2, ARENA_H / 2, Math.max(ARENA_W, ARENA_H) * 0.72,
      );
      g.addColorStop(0, 'rgba(0, 0, 0, 0)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0.34)');
      this.vignette = g;
    }
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  }

  private drawSkids(ctx: CanvasRenderingContext2D, now: number): void {
    if (this.skids.length === 0) return;
    let write = 0;
    ctx.lineCap = 'round';
    for (const skid of this.skids) {
      const age = (now - skid.born) / SKID_LIFE_MS;
      if (age >= 1) continue;
      this.skids[write] = skid;
      write += 1;

      ctx.strokeStyle = `rgba(38, 28, 22, ${0.34 * (1 - age)})`;
      ctx.lineWidth = 5;
      const dx = Math.cos(skid.angle) * 7;
      const dy = Math.sin(skid.angle) * 7;
      const nx = -Math.sin(skid.angle) * CAR_R * 0.72;
      const ny = Math.cos(skid.angle) * CAR_R * 0.72;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(skid.x + nx * side - dx, skid.y + ny * side - dy);
        ctx.lineTo(skid.x + nx * side + dx, skid.y + ny * side + dy);
        ctx.stroke();
      }
    }
    this.skids.length = write;
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private consumeEvents(snap: DirtSnapshot, now: number): void {
    // Contact is constant in this game — eight cars in a corner can produce a
    // dozen of these in a frame — so the noisy ones are capped per frame the
    // way Tank Trouble caps ricochets. Without it a first corner is a wall of
    // sawtooth.
    let noisy = 0;

    for (const event of snap.events as DirtEvent[]) {
      switch (event.t) {
        case 'bump':
          this.shake = Math.min(9, this.shake + 3);
          this.emit(now, event.x, event.y, 5, '#ffd98a', { speed: 130, life: 340, r: 3, spark: true });
          if (noisy < 2) {
            sfx.crush();
            noisy += 1;
          }
          break;
        case 'thud':
          this.shake = Math.min(9, this.shake + 4);
          this.emit(now, event.x, event.y, 8, '#ffe6a8', { speed: 170, life: 380, r: 3, spark: true });
          if (noisy < 2) {
            sfx.crash();
            noisy += 1;
          }
          break;
        case 'pickup': {
          const taker = snap.cars.find((c) => c.s === event.seat);
          if (taker) this.emit(now, taker.x, taker.y, 10, '#8dff7a', { speed: 120, life: 460, r: 4, spark: true });
          if (event.seat === this.context.mySeat) sfx.pickup();
          break;
        }
        case 'use':
          if (event.kind === 'speed') sfx.powerup();
          else sfx.click();
          break;
        case 'spin': {
          this.shake = Math.min(12, this.shake + 7);
          const hit = snap.cars.find((c) => c.s === event.seat);
          if (hit) {
            this.emit(now, hit.x, hit.y, 16, '#ffc247', { speed: 210, life: 480, r: 4, spark: true });
            this.emit(now, hit.x, hit.y, 10, '#8a8177', { speed: 70, life: 700, r: 11 });
          }
          sfx.explode();
          break;
        }
        case 'lap':
          if (event.seat === this.context.mySeat) sfx.countdown(false);
          break;
        case 'finish':
          if (event.seat === this.context.mySeat) sfx.fanfare();
          break;
        case 'respawn':
          // A recovery is a teleport. Sliding into it would draw the car
          // travelling across the scenery it was just pulled out of.
          if (event.seat === this.context.mySeat) this.smoother.reset();
          else this.remotes.forget(event.seat);
          break;
        default:
          break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ribbon drawing
// ---------------------------------------------------------------------------

/**
 * The outward normal at a ribbon point.
 *
 * Averaged across the two adjoining spans rather than taken from one of them,
 * so the offset edges stay smooth through a corner instead of stepping at every
 * control point.
 */
function normalAt(pts: RibbonPoint[], i: number, closed: boolean): { x: number; y: number } {
  const n = pts.length;
  const prev = closed ? pts[(i - 1 + n) % n]! : pts[Math.max(0, i - 1)]!;
  const next = closed ? pts[(i + 1) % n]! : pts[Math.min(n - 1, i + 1)]!;
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

function ribbonPath(
  ctx: CanvasRenderingContext2D,
  pts: RibbonPoint[],
  halfAt: (p: RibbonPoint) => number,
  closed: boolean,
): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    const n = normalAt(pts, i, closed);
    const h = halfAt(p);
    const x = p.x + n.x * h;
    const y = p.y + n.y * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i]!;
    const n = normalAt(pts, i, closed);
    const h = halfAt(p);
    ctx.lineTo(p.x - n.x * h, p.y - n.y * h);
  }
  ctx.closePath();
}

function fillRibbon(
  ctx: CanvasRenderingContext2D,
  pts: RibbonPoint[],
  halfAt: (p: RibbonPoint) => number,
  fill: string,
  closed: boolean,
): void {
  if (pts.length < 2) return;
  ribbonPath(ctx, pts, halfAt, closed);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Outline a ribbon's edge — the lip where the drivable world stops. */
function strokeRibbonEdge(
  ctx: CanvasRenderingContext2D,
  pts: RibbonPoint[],
  halfAt: (p: RibbonPoint) => number,
  stroke: string,
  width: number,
  closed: boolean,
): void {
  if (pts.length < 2) return;
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const n = normalAt(pts, i, closed);
      const h = halfAt(p) * sign;
      const x = p.x + n.x * h;
      const y = p.y + n.y * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (closed) ctx.closePath();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function clipRibbon(
  ctx: CanvasRenderingContext2D,
  pts: RibbonPoint[],
  halfAt: (p: RibbonPoint) => number,
  closed: boolean,
): void {
  ribbonPath(ctx, pts, halfAt, closed);
  ctx.clip();
}

/** Stable pseudo-random in [0, 1) from a position. No state, no crawl on repaint. */
function hash2(x: number, y: number): number {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

/**
 * Vector paths, not text or emoji — emoji rendering varies by platform and
 * reads as a UI icon rather than part of the game world. Each glyph is drawn
 * around the origin at radius `r`, so the caller never needs pixel numbers.
 */
function drawPowerupGlyph(ctx: CanvasRenderingContext2D, kind: DirtPowerup, r: number): void {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = r * 0.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (kind) {
    case 'speed': {
      for (const dx of [-r * 0.34, r * 0.22]) {
        ctx.beginPath();
        ctx.moveTo(dx - r * 0.32, -r * 0.55);
        ctx.lineTo(dx + r * 0.24, 0);
        ctx.lineTo(dx - r * 0.32, r * 0.55);
        ctx.stroke();
      }
      break;
    }
    case 'mine': {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = r * 0.16;
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
        ctx.lineTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}
