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
/** Everything past the shoulder. Not a colour a car ever stands on. */
const SCENERY = '#2c3a24';
const SCENERY_SPECK = '#25321e';
const OFFROAD = '#6d7a3f';
const TRACK = '#a8794b';
const TRACK_GRAIN = '#9c6f44';
const KERB_LIGHT = '#f2e6d2';
const KERB_DARK = '#b4462f';
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
  private shake = 0;
  private reduced = false;
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
    this.drawPads(ctx, snap, now);
    this.drawMines(ctx, snap, now);
    this.drawCars(ctx, snap, geometry, now, entry.serverAt);
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

    ctx.fillStyle = SCENERY;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);

    if (backdrop) {
      ctx.drawImage(backdrop, 0, 0, ARENA_W, ARENA_H);
      // Even with art, the kerbs are drawn from the geometry — they are the
      // one thing a driver reads at speed and they must mark the real edge.
      this.strokeKerbs(ctx, geometry);
      return layer;
    }

    // Scenery texture, so the solid region reads as ground rather than as a
    // background colour. Deterministic from position — a hash rather than
    // `Math.random`, so it does not crawl when the layer is repainted.
    ctx.fillStyle = SCENERY_SPECK;
    for (let y = 12; y < ARENA_H; y += 26) {
      for (let x = 12; x < ARENA_W; x += 26) {
        const h = hash2(x, y);
        if (h > 0.55) continue;
        ctx.fillRect(x + (h * 40 - 10), y + (h * 62 - 20), 3 + h * 5, 3);
      }
    }

    // Shoulder first, then the racing surface on top of it — two passes of the
    // same ribbon at two widths, which is why the shoulder is always exactly as
    // wide as the physics says and never a hand-drawn approximation of it.
    fillRibbon(ctx, geometry.outline, (p) => p.w + p.s, OFFROAD, true);
    for (const cut of geometry.shortcutOutlines) {
      fillRibbon(ctx, cut, (p) => p.w + p.s, OFFROAD, false);
    }
    fillRibbon(ctx, geometry.outline, (p) => p.w, TRACK, true);
    for (const cut of geometry.shortcutOutlines) {
      fillRibbon(ctx, cut, (p) => p.w, TRACK, false);
    }

    // Grain along the direction of travel, so the surface reads as a road with
    // a direction rather than as a brown shape.
    ctx.save();
    clipRibbon(ctx, geometry.outline, (p) => p.w, true);
    ctx.strokeStyle = TRACK_GRAIN;
    ctx.lineWidth = 5;
    for (const side of [-0.55, -0.2, 0.2, 0.55]) {
      ctx.beginPath();
      geometry.outline.forEach((p, i) => {
        const n = normalAt(geometry.outline, i, true);
        const x = p.x + n.x * p.w * side;
        const y = p.y + n.y * p.w * side;
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

      // Alternating dashes, walked by arc length so the blocks stay the same
      // size through a hairpin as down a straight.
      let run = 0;
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        ctx.strokeStyle = Math.floor(run / 26) % 2 === 0 ? KERB_LIGHT : KERB_DARK;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        run += len;
      }
    }
  }

  private drawStartLine(ctx: CanvasRenderingContext2D, geometry: TrackGeometry): void {
    const start = geometry.outline[0];
    if (!start) return;
    const n = normalAt(geometry.outline, 0, true);
    const squares = 8;

    ctx.save();
    ctx.translate(start.x, start.y);
    ctx.rotate(Math.atan2(-n.x, n.y));
    const cell = (start.w * 2) / squares;
    for (let i = 0; i < squares; i += 1) {
      for (let row = 0; row < 2; row += 1) {
        ctx.fillStyle = (i + row) % 2 === 0 ? '#f7f2e8' : INK;
        ctx.fillRect(-start.w + i * cell, -cell + row * cell, cell, cell);
      }
    }
    ctx.restore();
  }

  private drawSolids(ctx: CanvasRenderingContext2D, geometry: TrackGeometry): void {
    for (const pass of [0, 1]) {
      const offset = pass === 0 ? SHADOW_OFFSET : 0;
      for (const box of geometry.solids) {
        // ── ASSET SWAP POINT ────────────────────────────────────────────────
        // A per-track prop sheet would go here, drawn into the same rectangle.
        // The box stays the hitbox either way — see `tracks.ts`.
        // ────────────────────────────────────────────────────────────────────
        ctx.fillStyle = pass === 0 ? '#000000' : '#7d6f60';
        roundRect(ctx, box.x + offset, box.y + offset, box.w, box.h, 9);
        ctx.fill();
        if (pass === 1) {
          ctx.fillStyle = '#94867a';
          roundRect(ctx, box.x + 5, box.y + 5, box.w - 10, Math.max(4, box.h * 0.4), 6);
          ctx.fill();
        }
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
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.beginPath();
      ctx.ellipse(pad.x, pad.y, PAD_R * 1.15, PAD_R * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();

      if (!pad.k) continue;

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

      ctx.fillStyle = armed ? '#ffd447' : '#8d8470';
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

      this.drawCar(ctx, drawn.x, drawn.y, body.angle, car, now);
    }
  }

  private drawCar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    car: DirtSnapshot['cars'][number],
    now: number,
  ): void {
    const color = colorFor(this.context.colorBySeat[car.s] ?? car.s);
    const finished = car.fp > 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

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
      const len = CAR_R * 1.45;
      const wide = CAR_R * 0.92;

      ctx.fillStyle = '#000000';
      roundRect(ctx, -len + SHADOW_OFFSET, -wide + SHADOW_OFFSET, len * 2, wide * 2, 7);
      ctx.fill();

      // Wheels, sticking out past the body so the car reads as a car at the
      // size it is actually drawn — about forty pixels on a phone.
      ctx.fillStyle = INK;
      for (const wx of [-len * 0.58, len * 0.55]) {
        for (const wy of [-wide - 2, wide - 5]) {
          roundRect(ctx, wx - 8, wy, 16, 7, 3);
          ctx.fill();
        }
      }

      ctx.fillStyle = color;
      roundRect(ctx, -len, -wide, len * 2, wide * 2, 7);
      ctx.fill();

      // Nose flash and windscreen: two marks, enough to tell which way it is
      // pointed when it is sideways, which in this game is most of the time.
      ctx.fillStyle = shade(color, -0.35);
      roundRect(ctx, len * 0.34, -wide + 3, len * 0.5, wide * 2 - 6, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(226, 240, 255, 0.85)';
      roundRect(ctx, -len * 0.1, -wide * 0.62, len * 0.42, wide * 1.24, 3);
      ctx.fill();

      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      roundRect(ctx, -len, -wide, len * 2, wide * 2, 7);
      ctx.stroke();
    }

    ctx.restore();

    // Effect badges ride above the car, unrotated — a marker that spun with the
    // car would be unreadable on the one car that most needs reading.
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 1;

    if (car.rv) this.drawReversedBadge(ctx, now);
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

  /**
   * The reversed-steering marker.
   *
   * Loud on purpose, and the loudest thing this renderer draws. Reversed
   * controls are the one effect a player must not have to *work out* — the
   * failure mode is pressing left, going right, and concluding the game is
   * broken. So it gets a rotating pair of arrows over the car, a coloured ring
   * around it, and (in `DirtScreen`) a banner across the arena and a wheel that
   * changes colour. Any one of those alone has been enough to miss.
   */
  private drawReversedBadge(ctx: CanvasRenderingContext2D, now: number): void {
    const spin = this.reduced ? 0 : (now / 260) % (Math.PI * 2);
    const r = CAR_R + 13;

    ctx.save();
    ctx.strokeStyle = '#c77dff';
    ctx.lineWidth = 4;
    ctx.setLineDash([9, 7]);
    ctx.beginPath();
    ctx.arc(0, 0, r, spin, spin + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.translate(0, -r - 14);
    ctx.fillStyle = '#c77dff';
    roundRect(ctx, -17, -11, 34, 22, 6);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    roundRect(ctx, -17, -11, 34, 22, 6);
    ctx.stroke();

    // A pair of opposed arrows — the same glyph the HUD chip uses.
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-10 * dir, -4 * dir);
      ctx.lineTo(10 * dir, -4 * dir);
      ctx.moveTo(10 * dir, -4 * dir);
      ctx.lineTo(5 * dir, -8 * dir);
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
          if (noisy < 2) {
            sfx.crush();
            noisy += 1;
          }
          break;
        case 'thud':
          this.shake = Math.min(9, this.shake + 4);
          if (noisy < 2) {
            sfx.crash();
            noisy += 1;
          }
          break;
        case 'pickup':
          if (event.seat === this.context.mySeat) sfx.pickup();
          break;
        case 'use':
          if (event.kind === 'speed') sfx.powerup();
          else sfx.click();
          break;
        case 'spin':
          this.shake = Math.min(12, this.shake + 7);
          sfx.explode();
          break;
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
    void now;
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
    case 'reverse': {
      // Two arrows pointing opposite ways — the same mark as the in-world badge
      // and the HUD chip, so the three read as one thing.
      for (const dir of [-1, 1]) {
        const y = r * 0.34 * dir;
        ctx.beginPath();
        ctx.moveTo(-r * 0.62 * dir, y);
        ctx.lineTo(r * 0.62 * dir, y);
        ctx.lineTo(r * 0.28 * dir, y - r * 0.28 * dir);
        ctx.moveTo(r * 0.62 * dir, y);
        ctx.lineTo(r * 0.28 * dir, y + r * 0.28 * dir);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}
