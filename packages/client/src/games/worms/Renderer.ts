/**
 * Drawing a game of Worms.
 *
 * Layers, bottom to top: the background plate, the destructible terrain layer,
 * mines, projectiles, worms, the active worm's aiming furniture, and effects.
 * Everything up to the effects is in world units inside one camera transform;
 * the HUD is React and lives outside this file entirely.
 *
 * Two things here are less obvious than they look:
 *
 * - **The camera transform composes on top of `CanvasStage`, it does not
 *   replace it.** `CanvasStage` is constructed with the *view* size rather than
 *   the world size, so it still owns device pixel ratio, resizing and the
 *   letterbox; the camera is one more `translate/scale/translate` inside that.
 *   Screen-to-world therefore has to invert both, which is why every pointer
 *   handler goes through `toWorld` rather than `stage.toArena` alone.
 *
 * - **Squash and stretch is derived from world position, never accumulated.**
 *   A renderer-local walk-cycle counter would drift the moment a snapshot
 *   corrected the worm, and two people watching the same worm would draw it
 *   mid-stride differently. Taking the phase from `x` makes it stateless and
 *   identical everywhere for free.
 */

import { colorFor } from '@mg/shared';
import {
  AIM_RADIANS_PER_INDEX,
  WEAPONS,
  WORLD_H,
  WORLD_W,
  IN_LEFT,
  IN_RIGHT,
  WORM_HALF_H,
  WORM_HALF_W,
  WORMS_STAGES,
  type WormSnapWorm,
  type WormsEvent,
  type WormsSnapshot,
} from '@mg/shared/worms';
import { CanvasStage } from '../../game/CanvasStage';
import { roundRect } from '../../game/canvasDraw';
import { RemoteBodies } from '../../game/RemoteBodies';
import { getImage } from '../../game/images';
import { bracket, lerp } from '../../game/interpolation';
import { feed } from '../../net/feed';
import { sfx } from '../../audio';
import { prefersReducedMotion } from '../../ui/motion';
import { BOOM_HOLD_MS, WormsCamera, type Viewport } from './camera';
import { wormsInput } from './input';
import { predictWorm } from './predictor';
import { terrainBus } from './terrainBus';
import { TerrainCanvas } from './terrainCanvas';
import { getRecoloredWorm } from './wormRecolor';

/** The camera's nominal window on the world, before letterboxing. */
const VIEW_W = 1280;
const VIEW_H = 720;

const WORM_SPRITE = '/avatars/worms_game_worm_asset.png';
/**
 * The worm's ink inside its 1536x1024 sheet. Roughly half the file is padding,
 * so blitting the whole thing would draw the worm at half the size asked for.
 */
const SPRITE_BOX = { x: 359, y: 184, w: 820, h: 677 };
const WORM_DRAW_H = 34;
const WORM_DRAW_W = (WORM_DRAW_H * SPRITE_BOX.w) / SPRITE_BOX.h;

/** World units of travel per full walk cycle. */
const STRIDE = 26;

const INK = '#14110f';

interface Boom {
  x: number;
  y: number;
  r: number;
  /** 0 to 1, over the life of the effect. */
  age: number;
}

export interface WormsContext {
  mySeat: number;
  colorBySeat: Record<number, number>;
  nameBySeat: Record<number, string>;
  paused: boolean;
}

export class WormsRenderer {
  private readonly stage: CanvasStage;
  private readonly camera = new WormsCamera();
  private readonly terrain = new TerrainCanvas();
  /**
   * Every worm that is not the one you are driving. The threshold sits above
   * what a couple of ticks of gravity accounts for (~32 per snapshot) and well
   * below a blast, which sets several hundred at once.
   */
  private readonly bodies = new RemoteBodies(120);

  private raf = 0;
  private lastFrame = 0;
  private context: WormsContext;

  /** Landing squash, keyed by worm id: remaining ticks and the impact speed. */
  private readonly squash = new Map<number, { left: number; force: number }>();
  private readonly booms: Boom[] = [];
  private shake = 0;
  private boomFocus: { x: number; y: number; at: number } | null = null;
  private lastEventTick = -1;
  private lastRound = -1;

  constructor(canvas: HTMLCanvasElement, context: WormsContext) {
    this.stage = new CanvasStage(canvas, VIEW_W, VIEW_H);
    this.context = context;
  }

  setContext(context: WormsContext): void {
    this.context = context;
  }

  start(): void {
    this.stage.attach();
    this.lastFrame = performance.now();
    const loop = (now: number): void => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.stage.detach();
    this.bodies.clear();
    this.terrain.reset();
    this.squash.clear();
    this.booms.length = 0;
  }

  // -------------------------------------------------------------------------
  // Camera plumbing, used by the pointer handlers on the screen component
  // -------------------------------------------------------------------------

  private get viewport(): Viewport {
    const visible = this.stage.visibleRect();
    return { halfW: (visible.x1 - visible.x0) / 2, halfH: (visible.y1 - visible.y0) / 2 };
  }

  /** Canvas-relative client coordinates to world units. */
  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const view = this.stage.toArena(clientX, clientY);
    const visible = this.stage.visibleRect();
    return this.camera.toWorld(view.x - visible.x0, view.y - visible.y0, this.viewport);
  }

  panBy(screenDx: number, screenDy: number): void {
    this.camera.pan(screenDx / this.camera.zoom, screenDy / this.camera.zoom);
  }

  zoomBy(factor: number, clientX: number, clientY: number): void {
    const world = this.toWorld(clientX, clientY);
    this.camera.zoomAt(factor, world.x, world.y, this.viewport);
  }

  releaseCamera(): void {
    this.camera.release();
  }

  // -------------------------------------------------------------------------
  // The frame
  // -------------------------------------------------------------------------

  private frame(now: number): void {
    const dtMs = Math.min(64, now - this.lastFrame);
    this.lastFrame = now;

    const entry = feed.latest;
    const snap = entry?.snap.game === 'worms' ? entry.snap : null;

    const stageId = snap?.st ?? 'small_green';
    this.stage.begin(WORMS_STAGES[stageId].letterbox);

    if (!snap || !entry) {
      return;
    }

    if (snap.round !== this.lastRound) {
      // A new round is a whole new world: new terrain, worms teleported to
      // spawns. Everything that eases between frames has to be told, or it
      // spends the first second sliding out of last round's crater.
      this.lastRound = snap.round;
      this.bodies.clear();
      this.squash.clear();
      this.booms.length = 0;
      this.camera.snap();
      this.camera.release();
    }

    terrainBus.ensure(snap.st, snap.round);
    this.consumeEvents(snap);

    const renderTime = feed.renderTime(now);
    const view = bracket(feed.entries, renderTime);
    const drawn = view?.from.snap.game === 'worms' ? view.from.snap : snap;
    const next = view?.to?.snap.game === 'worms' ? view.to.snap : null;
    const alpha = view?.alpha ?? 0;

    this.bodies.beginFrame(view?.from.serverAt ?? 0);
    this.aimCamera(drawn, now);
    this.camera.update(dtMs, this.viewport);

    const ctx = this.stage.ctx;
    const visible = this.stage.visibleRect();
    const centreX = (visible.x0 + visible.x1) / 2;
    const centreY = (visible.y0 + visible.y1) / 2;

    ctx.save();
    ctx.translate(centreX, centreY);
    if (this.shake > 0.1) {
      // Deterministically pseudo-random, so it does not need a generator and
      // cannot desync anything: it is decoration on one screen.
      ctx.translate(Math.sin(now * 0.09) * this.shake, Math.cos(now * 0.13) * this.shake);
    }
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    this.drawStage(ctx, drawn);
    this.drawMines(ctx, drawn);
    this.drawProjectiles(ctx, drawn, next, alpha);
    this.drawWorms(ctx, drawn, next, alpha, renderTime);
    this.drawTargeting(ctx, drawn);
    this.drawBooms(ctx, dtMs);

    ctx.restore();

    this.shake = Math.max(0, this.shake - dtMs * 0.05);
  }

  /**
   * Where the camera wants to be.
   *
   * Priority, highest first: whatever is in the air, the most recent explosion
   * for a beat afterwards, then the active worm. Nothing at all during
   * `handoff`, which is when the camera travels to the next worm and is the
   * only part of a turn that is about the map rather than about a worm.
   */
  private aimCamera(snap: WormsSnapshot, now: number): void {
    if (this.camera.manual) return;

    const flying = snap.proj[snap.proj.length - 1];
    if (flying) {
      this.camera.aim({ x: flying.x, y: flying.y, zoom: 1.05 });
      return;
    }

    if (this.boomFocus && now - this.boomFocus.at < BOOM_HOLD_MS) {
      this.camera.aim({ x: this.boomFocus.x, y: this.boomFocus.y, zoom: 1.15 });
      return;
    }

    const active = snap.worms.find((w) => w.i === snap.ac);
    if (active) {
      this.camera.aim({ x: active.x, y: active.y - 30, zoom: 1.2 });
      return;
    }

    const alive = snap.worms.filter((w) => w.al === 1);
    if (alive.length > 0) {
      const x = alive.reduce((a, w) => a + w.x, 0) / alive.length;
      const y = alive.reduce((a, w) => a + w.y, 0) / alive.length;
      this.camera.aim({ x, y, zoom: 0.85 });
    }
  }

  /** Sounds and effects, once each. */
  private consumeEvents(snap: WormsSnapshot): void {
    if (snap.tick === this.lastEventTick) return;
    this.lastEventTick = snap.tick;

    for (const event of snap.events) {
      this.handleEvent(event);
    }
  }

  private handleEvent(event: WormsEvent): void {
    switch (event.t) {
      case 'fire':
        sfx.shoot(fireSound(event.w));
        return;
      case 'boom': {
        this.booms.push({ x: event.x, y: event.y, r: event.r, age: 0 });
        this.boomFocus = { x: event.x, y: event.y, at: performance.now() };
        sfx.explode();
        if (!prefersReducedMotion()) this.shake = Math.min(14, this.shake + event.r * 0.12);
        return;
      }
      case 'hurt':
        sfx.hit();
        return;
      case 'jump':
        sfx.jump(false);
        return;
      case 'land': {
        sfx.land();
        // Scaled by impact, so a hop is a twitch and a long fall is a splat.
        const force = Math.min(1, event.vy / 700);
        if (force > 0.08) this.squash.set(event.worm, { left: 10, force });
        return;
      }
      case 'drown':
        sfx.splash();
        return;
      case 'died':
        this.bodies.forget(event.worm);
        return;
      case 'turn':
        this.camera.release();
        if (event.seat === this.context.mySeat) sfx.yourTurn();
        return;
      case 'roundOver':
      case 'matchOver':
        return;
      default: {
        const never: never = event;
        throw new Error(`unhandled worms event ${String(never)}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Layers
  // -------------------------------------------------------------------------

  private drawStage(ctx: CanvasRenderingContext2D, snap: WormsSnapshot): void {
    const stage = WORMS_STAGES[snap.st];

    const background = getImage(stage.backgroundUrl);
    if (background) {
      ctx.drawImage(background, 0, 0, WORLD_W, WORLD_H);
    } else {
      ctx.fillStyle = stage.letterbox;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }

    // The tick being *displayed*, which is the bracketed snapshot's own — not
    // the newest one. Craters are gated on this so a hole opens on the frame
    // its explosion does rather than a playback delay early.
    const layer = this.terrain.layer(snap.st, snap.tick);
    if (layer) ctx.drawImage(layer, 0, 0, WORLD_W, WORLD_H);
  }

  private drawMines(ctx: CanvasRenderingContext2D, snap: WormsSnapshot): void {
    for (const mine of snap.mines) {
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(mine.x, mine.y, 6, 0, Math.PI * 2);
      ctx.fill();
      // Armed mines blink; an unarmed one is inert and says so by not.
      ctx.fillStyle = mine.a === 1 && Math.floor(performance.now() / 300) % 2 === 0 ? '#ff5a4d' : '#7a3a33';
      ctx.beginPath();
      ctx.arc(mine.x, mine.y - 1, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawProjectiles(
    ctx: CanvasRenderingContext2D,
    snap: WormsSnapshot,
    next: WormsSnapshot | null,
    alpha: number,
  ): void {
    for (const shot of snap.proj) {
      const to = next?.proj.find((p) => p.i === shot.i);
      const x = to ? lerp(shot.x, to.x, alpha) : shot.x;
      const y = to ? lerp(shot.y, to.y, alpha) : shot.y;
      const heading = Math.atan2(shot.vy, shot.vx);
      const spec = WEAPONS[shot.k];

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(heading);

      ctx.fillStyle = INK;
      if (spec.projectile?.bounce) {
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4d7a33';
        ctx.beginPath();
        ctx.arc(-1, -1, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        roundRect(ctx, -7, -3, 14, 6, 3);
        ctx.fill();
        ctx.fillStyle = '#ffb03a';
        roundRect(ctx, -11, -2, 5, 4, 2);
        ctx.fill();
      }
      ctx.restore();

      // A fuse that is about to run out has to be legible at a glance — this is
      // the only warning anyone gets that a grenade is theirs to run from.
      if (shot.fu !== undefined && shot.fu > 0) {
        ctx.fillStyle = '#fff3d6';
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(Math.ceil(shot.fu / 60)), x, y - 11);
      }
    }
  }

  private drawWorms(
    ctx: CanvasRenderingContext2D,
    snap: WormsSnapshot,
    next: WormsSnapshot | null,
    alpha: number,
    renderTime: number,
  ): void {
    const sprite = getImage(WORM_SPRITE);
    const mySeat = this.context.mySeat;
    const controllable = snap.phase === 'turn' || snap.phase === 'retreat';

    for (const worm of snap.worms) {
      if (worm.al === 0) continue;

      const seat = snap.seats.find((s) => s.s === worm.s);
      const mine = worm.i === snap.ac && worm.s === mySeat && controllable;

      let x = worm.x;
      let y = worm.y;
      let facing = worm.f;
      let onGround = worm.g === 1;
      let vy = worm.vy;

      if (mine && seat) {
        const predicted = predictWorm(worm, terrainBus.mask, seat.ack, seat.ib, true);
        if (predicted) {
          x = predicted.x;
          y = predicted.y;
          facing = predicted.facing;
          onGround = predicted.onGround;
          vy = predicted.vy;
        }
      } else {
        const to = next?.worms.find((w) => w.i === worm.i);
        if (to) {
          x = lerp(worm.x, to.x, alpha);
          y = lerp(worm.y, to.y, alpha);
        }
        const smoothed = this.bodies.draw(worm.i, x, y, { vx: worm.vx, vy: worm.vy }, renderTime);
        x = smoothed.x;
        y = smoothed.y;
      }

      const held = mine ? wormsInput.bits : (seat?.ib ?? 0);
      const left = (held & IN_LEFT) !== 0;
      const right = (held & IN_RIGHT) !== 0;
      const walking = worm.i === snap.ac && controllable && left !== right;

      const color = colorFor(this.context.colorBySeat[worm.s] ?? worm.s);
      this.drawWorm(ctx, sprite, { x, y, facing, onGround, vy, worm, color, walking });

      if (worm.dy === undefined) {
        this.drawTag(ctx, x, y, worm, color, this.context.nameBySeat[worm.s] ?? '');
      }

      if (worm.i === snap.ac && controllable) {
        this.drawAim(ctx, x, y, worm, facing, color);
      }
    }
  }

  /**
   * One worm, squashed and stretched.
   *
   * Anchored at the feet rather than the centre. Scaling about the middle sinks
   * a squashing worm halfway into the ground and lifts a stretching one off it,
   * which reads as the sprite being wrong rather than as weight.
   */
  private drawWorm(
    ctx: CanvasRenderingContext2D,
    sprite: HTMLImageElement | null,
    body: {
      x: number;
      y: number;
      facing: 1 | -1;
      onGround: boolean;
      vy: number;
      worm: WormSnapWorm;
      color: string;
      /**
       * Taking a step. Not derivable from velocity: `stepWorm` moves a walking
       * worm by position and holds `vx` at zero, precisely so that walking has
       * no momentum — so the snapshot of a worm mid-stride is indistinguishable
       * from one standing still unless the buttons come too.
       */
      walking: boolean;
    },
  ): void {
    const { x, y, facing, onGround, vy, worm, color, walking } = body;

    let sy = 1;
    let hop = 0;
    if (onGround) {
      // Phase from world position, not from a frame counter — see the header.
      const phase = (x / STRIDE) * Math.PI * 2;
      const swing = walking ? Math.sin(phase) : 0;
      sy = 1 + 0.1 * swing;
      hop = -3 * Math.abs(swing);
    } else {
      sy = Math.min(1.3, 1 + Math.abs(vy) / 900 / 4);
    }

    const impact = this.squash.get(worm.i);
    if (impact) {
      const t = impact.left / 10;
      sy *= 1 - 0.34 * impact.force * t;
      impact.left -= 1;
      if (impact.left <= 0) this.squash.delete(worm.i);
    }

    const sx = 1 / sy;
    const w = WORM_DRAW_W * sx;
    const h = WORM_DRAW_H * sy;
    const feet = y + WORM_HALF_H + hop;

    ctx.save();
    ctx.translate(x, feet);
    ctx.scale(facing, 1);

    if (sprite) {
      const shadow = getRecoloredWorm(sprite, color, true);
      if (shadow) {
        ctx.globalAlpha = 0.22;
        ctx.drawImage(shadow, SPRITE_BOX.x, SPRITE_BOX.y, SPRITE_BOX.w, SPRITE_BOX.h, -w / 2 + 2, -h + 3, w, h);
        ctx.globalAlpha = 1;
      }
      const tinted = getRecoloredWorm(sprite, color) ?? sprite;
      ctx.drawImage(tinted, SPRITE_BOX.x, SPRITE_BOX.y, SPRITE_BOX.w, SPRITE_BOX.h, -w / 2, -h, w, h);
    } else {
      // The whole game has to work before a single asset has loaded.
      ctx.fillStyle = color;
      roundRect(ctx, -WORM_HALF_W * sx, -h, WORM_HALF_W * 2 * sx, h, 6);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawTag(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    worm: WormSnapWorm,
    color: string,
    name: string,
  ): void {
    const top = y - WORM_HALF_H - 30;
    const label = name || `#${worm.s + 1}`;

    ctx.font = '600 11px system-ui, sans-serif';
    const width = Math.max(34, ctx.measureText(label).width + 12);

    ctx.fillStyle = 'rgba(20, 17, 15, 0.72)';
    roundRect(ctx, x - width / 2, top, width, 24, 5);
    ctx.fill();

    // Health bar first, name over it: at a glance the bar is what you read.
    const barW = width - 8;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(ctx, x - barW / 2, top + 17, barW, 4, 2);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, x - barW / 2, top + 17, (barW * Math.max(0, worm.hp)) / 100, 4, 2);
    ctx.fill();

    ctx.fillStyle = '#fdf7ee';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, top + 12);
  }

  /**
   * The crosshair and the power meter.
   *
   * Dots along the aim line rather than a solid one, because a solid line reads
   * as the path the shot will take, and with wind and gravity it very much is
   * not. Dots read as a direction, which is what it is.
   */
  private drawAim(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    worm: WormSnapWorm,
    facing: 1 | -1,
    color: string,
  ): void {
    const angle = worm.ai * AIM_RADIANS_PER_INDEX;
    const dx = Math.cos(angle) * facing;
    const dy = -Math.sin(angle);

    ctx.fillStyle = color;
    for (let d = 26; d <= 74; d += 12) {
      ctx.globalAlpha = 1 - (d - 26) / 90;
      ctx.beginPath();
      ctx.arc(x + dx * d, y + dy * d, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x + dx * 86, y + dy * 86, 5, 0, Math.PI * 2);
    ctx.stroke();

    if (worm.pw > 0) {
      const power = worm.pw / 1000;
      const top = y - WORM_HALF_H - 44;
      ctx.fillStyle = 'rgba(20,17,15,0.75)';
      roundRect(ctx, x - 24, top, 48, 7, 3);
      ctx.fill();
      ctx.fillStyle = power > 0.85 ? '#ff5a4d' : '#ffc23a';
      roundRect(ctx, x - 23, top + 1, 46 * power, 5, 2);
      ctx.fill();
    }
  }

  /** Where a map-targeting weapon is pointed. */
  private drawTargeting(ctx: CanvasRenderingContext2D, snap: WormsSnapshot): void {
    if (snap.tx < 0 || snap.ty < 0) return;
    const seat = snap.seats.find((s) => s.s === snap.worms.find((w) => w.i === snap.ac)?.s);
    if (!seat || !WEAPONS[seat.w].needsTarget) return;

    ctx.strokeStyle = '#ff5a4d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(snap.tx, snap.ty, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(snap.tx - 22, snap.ty);
    ctx.lineTo(snap.tx - 8, snap.ty);
    ctx.moveTo(snap.tx + 8, snap.ty);
    ctx.lineTo(snap.tx + 22, snap.ty);
    ctx.moveTo(snap.tx, snap.ty - 22);
    ctx.lineTo(snap.tx, snap.ty - 8);
    ctx.moveTo(snap.tx, snap.ty + 8);
    ctx.lineTo(snap.tx, snap.ty + 22);
    ctx.stroke();
  }

  private drawBooms(ctx: CanvasRenderingContext2D, dtMs: number): void {
    for (let i = this.booms.length - 1; i >= 0; i -= 1) {
      const boom = this.booms[i]!;
      boom.age += dtMs / 420;
      if (boom.age >= 1) {
        this.booms.splice(i, 1);
        continue;
      }
      const t = boom.age;
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.fillStyle = t < 0.35 ? '#fff0c4' : '#ff8a3d';
      ctx.beginPath();
      ctx.arc(boom.x, boom.y, boom.r * (0.5 + t * 0.8), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

/** Map a weapon onto the synth kit's existing voices. */
function fireSound(weapon: string): string {
  if (weapon === 'shotgun') return 'shotgun';
  if (weapon === 'bat') return 'knife';
  if (weapon === 'bazooka' || weapon === 'homing' || weapon === 'cluster') return 'rocket';
  return 'pistol';
}
