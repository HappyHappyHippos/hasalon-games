import { colorFor } from '@mg/shared';
import {
  CELL,
  PICKUP_R,
  POWERUPS,
  TANK_R,
  WALL_HALF,
  arenaHeight,
  arenaWidth,
  generateMaze,
  hasHWall,
  hasVWall,
  type Maze,
  type TankEvent,
  type TankPowerup,
  type TanksSnapshot,
} from '@mg/shared/tanks';
import { CanvasStage } from '../../game/CanvasStage';
import { PositionSmoother } from '../../game/PositionSmoother';
import { feed } from '../../net/feed';
import { sfx } from '../../audio';
import { prefersReducedMotion } from '../../ui/motion';
import { TanksPredictor, advanceTank, ticksBehind } from './predictor';
import { getImage } from '../../game/images';
import { TANK_STAGES, TANK_STAGE_IDS, type TankBody } from '@mg/shared/tanks';

const FLOOR = '#1c1a24';
const LETTERBOX = '#100f16';
const WALL = '#efe9dc';
const WALL_SHADOW = '#000000';
const DEBUG_HITBOXES = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debugHitboxes');

/** Hard offset shadow, never a blur — see the note at the top of `tokens.css`. */
const SHADOW_OFFSET = 3;

/** Fill colours for one tank's parts, derived once per seat colour and cached. */
interface TankPalette {
  hull: string;
  track: string;
  turret: string;
  barrel: string;
}

/** Solid black for every part — the shadow pass is the coloured tank's own shape. */
const SHADOW_PALETTE: TankPalette = { hull: '#000000', track: '#000000', turret: '#000000', barrel: '#000000' };

/** How far a wreck's turret is knocked off-centre, so it reads as destroyed, not just faded. */
const WRECK_TURRET_SKEW = 0.6;

/**
 * Glyphs are drawn as vector paths, not text/emoji — emoji rendering varies
 * by platform and reads as a UI icon, not part of the game world.
 *
 * Every glyph is drawn inside a unit circle of radius 1 in local space; the
 * caller scales by the pickup's actual radius, so a glyph never needs its own
 * pixel numbers.
 */
const PICKUP_INK = '#1c1a24';

function drawPickupGlyph(ctx: CanvasRenderingContext2D, kind: TankPowerup, r: number): void {
  ctx.save();
  ctx.strokeStyle = PICKUP_INK;
  ctx.fillStyle = PICKUP_INK;
  ctx.lineWidth = r * 0.16;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (kind) {
    case 'shield': {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.75);
      ctx.quadraticCurveTo(r * 0.7, -r * 0.55, r * 0.6, 0);
      ctx.quadraticCurveTo(r * 0.5, r * 0.55, 0, r * 0.8);
      ctx.quadraticCurveTo(-r * 0.5, r * 0.55, -r * 0.6, 0);
      ctx.quadraticCurveTo(-r * 0.7, -r * 0.55, 0, -r * 0.75);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'speed': {
      for (const dx of [-r * 0.3, r * 0.25]) {
        ctx.beginPath();
        ctx.moveTo(dx - r * 0.35, -r * 0.5);
        ctx.lineTo(dx + r * 0.2, 0);
        ctx.lineTo(dx - r * 0.35, r * 0.5);
        ctx.stroke();
      }
      break;
    }
    case 'triple': {
      for (const dx of [-r * 0.5, 0, r * 0.5]) {
        ctx.beginPath();
        ctx.moveTo(dx, -r * 0.7);
        ctx.lineTo(dx, r * 0.15);
        ctx.stroke();
        circle(ctx, dx, r * 0.5, r * 0.13);
      }
      break;
    }
    case 'heavy': {
      circle(ctx, 0, 0, r * 0.55);
      ctx.strokeStyle = '#1c1a24aa';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.55, -Math.PI * 0.75, -Math.PI * 0.25);
      ctx.stroke();
      break;
    }
    case 'rapid': {
      ctx.beginPath();
      ctx.moveTo(r * 0.15, -r * 0.75);
      ctx.lineTo(-r * 0.35, r * 0.05);
      ctx.lineTo(r * 0.05, r * 0.05);
      ctx.lineTo(-r * 0.15, r * 0.75);
      ctx.lineTo(r * 0.45, -r * 0.15);
      ctx.lineTo(r * 0.05, -r * 0.15);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'bounce': {
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, r * 0.6);
      ctx.lineTo(-r * 0.15, -r * 0.5);
      ctx.lineTo(r * 0.15, r * 0.15);
      ctx.lineTo(r * 0.6, -r * 0.6);
      ctx.stroke();
      circle(ctx, -r * 0.6, r * 0.6, r * 0.1);
      circle(ctx, r * 0.6, -r * 0.6, r * 0.1);
      break;
    }
    case 'ghost': {
      ctx.beginPath();
      ctx.arc(0, -r * 0.05, r * 0.55, Math.PI, 0);
      ctx.lineTo(r * 0.55, r * 0.6);
      ctx.lineTo(r * 0.28, r * 0.35);
      ctx.lineTo(0, r * 0.6);
      ctx.lineTo(-r * 0.28, r * 0.35);
      ctx.lineTo(-r * 0.55, r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      circle(ctx, -r * 0.2, -r * 0.1, r * 0.09);
      circle(ctx, r * 0.2, -r * 0.1, r * 0.09);
      break;
    }
    case 'mini': {
      ctx.strokeRect(-r * 0.32, -r * 0.32, r * 0.64, r * 0.64);
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(sx * r * 0.55, sy * r * 0.55);
        ctx.lineTo(sx * r * 0.28, sy * r * 0.28);
        ctx.stroke();
      }
      break;
    }
    default:
      break;
  }

  ctx.restore();
}

export interface TanksRenderContext {
  mySeat: number;
  colorBySeat: Record<number, number>;
  nameBySeat: Record<number, string>;
  paused: boolean;
}

/**
 * The Tank Trouble renderer.
 *
 * The arena is regenerated locally from three numbers in the snapshot rather
 * than being sent: `generateMaze` is deterministic, so `az`/`aw`/`ah` is the
 * whole map. Memoised on those three, because a new maze arrives once a round
 * and rebuilding it every frame would be the most expensive thing here.
 */
export class TanksRenderer {
  private stage: CanvasStage | null = null;
  private raf = 0;
  private context: TanksRenderContext;

  private maze: Maze | null = null;
  private mazeKey = '';

  private readonly predictor = new TanksPredictor();
  private readonly smoothers = new Map<number, PositionSmoother>();
  private readonly paletteCache = new Map<number, TankPalette>();

  private shake = 0;
  private reduced = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    context: TanksRenderContext,
  ) {
    this.context = context;
  }

  setContext(context: TanksRenderContext): void {
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
    this.smoothers.clear();
  }

  // -------------------------------------------------------------------------

  private frame(now: number): void {
    const entry = feed.latest;
    if (!entry || entry.snap.game !== 'tanks') return;
    const snap: TanksSnapshot = entry.snap;

    const maze = this.mazeFor(snap);
    const stage = this.stageFor(maze);
    if (!stage) return;

    stage.begin(LETTERBOX);
    const { ctx } = stage;

    this.consumeEvents(snap);

    if (this.shake > 0.2) {
      const amount = this.shake;
      ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
      this.shake *= 0.85;
    } else {
      this.shake = 0;
    }

    this.drawFloor(ctx, maze);
    this.drawWalls(ctx, maze);
    this.drawPickups(ctx, snap, now);
    this.drawBullets(ctx, snap, now, entry.serverAt);
    this.drawTanks(ctx, snap, maze, now, entry.serverAt);
  }

  private mazeFor(snap: TanksSnapshot): Maze {
    const key = `${snap.az}:${snap.aw}:${snap.ah}`;
    if (this.maze && this.mazeKey === key) return this.maze;
    this.maze = generateMaze(snap.az, snap.aw, snap.ah, snap.players.length);
    this.mazeKey = key;
    // A new arena means every smoothed position is about to teleport.
    this.smoothers.clear();
    this.predictor.reset();
    return this.maze;
  }

  /** The stage is rebuilt when the arena changes size, which is once a round at most. */
  private stageFor(maze: Maze): CanvasStage | null {
    const width = arenaWidth(maze);
    const height = arenaHeight(maze);
    if (this.stage && this.stage.arenaWidth === width && this.stage.arenaHeight === height) {
      return this.stage;
    }
    this.stage?.detach();
    this.stage = new CanvasStage(this.canvas, width, height);
    this.stage.attach();
    return this.stage;
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private drawFloor(ctx: CanvasRenderingContext2D, maze: Maze): void {
    const width = arenaWidth(maze);
    const height = arenaHeight(maze);
    ctx.fillStyle = FLOOR;
    ctx.fillRect(0, 0, width, height);

    // Draw backdrop image if available for current seed / round.
    const stageId = TANK_STAGE_IDS[Math.abs(maze.cols * 31 + maze.rows) % TANK_STAGE_IDS.length]!;
    const stageDef = TANK_STAGES[stageId];
    if (stageDef) {
      const img = getImage(stageDef.backdropUrl);
      if (img) {
        ctx.drawImage(img, 0, 0, width, height);
      }
    }
  }

  private drawWalls(ctx: CanvasRenderingContext2D, maze: Maze): void {
    // Determine active stage theme hitboxes
    const stageId = TANK_STAGE_IDS[Math.abs(maze.cols * 31 + maze.rows) % TANK_STAGE_IDS.length]!;
    const stageDef = TANK_STAGES[stageId];

    // If stage image backdrop is loaded, suppress procedural wall fills
    const imgLoaded = stageDef && !!getImage(stageDef.backdropUrl);

    if (!imgLoaded) {
      for (const pass of [0, 1]) {
        ctx.fillStyle = pass === 0 ? WALL_SHADOW : WALL;
        const dx = pass === 0 ? SHADOW_OFFSET : 0;
        const dy = pass === 0 ? SHADOW_OFFSET : 0;

        for (let y = 0; y < maze.rows; y += 1) {
          for (let x = 0; x <= maze.cols; x += 1) {
            if (!hasVWall(maze, x, y)) continue;
            ctx.fillRect(x * CELL - WALL_HALF + dx, y * CELL - WALL_HALF + dy, WALL_HALF * 2, CELL + WALL_HALF * 2);
          }
        }
        for (let y = 0; y <= maze.rows; y += 1) {
          for (let x = 0; x < maze.cols; x += 1) {
            if (!hasHWall(maze, x, y)) continue;
            ctx.fillRect(x * CELL - WALL_HALF + dx, y * CELL - WALL_HALF + dy, CELL + WALL_HALF * 2, WALL_HALF * 2);
          }
        }
      }
    }

    if (DEBUG_HITBOXES && stageDef) {
      ctx.save();
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.9)';
      ctx.fillStyle = 'rgba(74, 222, 128, 0.2)';
      ctx.lineWidth = 2;
      for (const box of stageDef.obstacles) {
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
      }
      ctx.restore();
    }
  }

  /**
   * A rounded crate rather than a plain disc: a hard offset shadow (never a
   * blur — see the note at the top of `tokens.css`), the spec's own colour as
   * fill, a drawn glyph instead of an emoji, and a gentle idle bob so the
   * floor doesn't read as static once the ink and walls are.
   *
   * The bob/pulse phase is keyed on the pickup's id so a handful spawned at
   * once don't all bounce in lockstep.
   */
  private drawPickups(ctx: CanvasRenderingContext2D, snap: TanksSnapshot, now: number): void {
    for (const pickup of snap.pickups) {
      const spec = POWERUPS[pickup.k];
      const phase = (pickup.x * 7 + pickup.y * 13) % (Math.PI * 2);
      const bob = this.reduced ? 0 : Math.sin(now / 420 + phase) * PICKUP_R * 0.16;
      const pulse = this.reduced ? 1 : 1 + Math.sin(now / 260 + phase) * 0.045;
      const r = PICKUP_R * pulse;
      const cx = pickup.x;
      const cy = pickup.y + bob;
      const w = r * 1.9;
      const h = r * 1.6;
      const corner = r * 0.5;

      ctx.fillStyle = '#000000';
      roundedRect(ctx, cx - w / 2 + SHADOW_OFFSET, cy - h / 2 + SHADOW_OFFSET, w, h, corner);
      ctx.fill();

      ctx.fillStyle = spec.color;
      roundedRect(ctx, cx - w / 2, cy - h / 2, w, h, corner);
      ctx.fill();

      // A thin darker rim reads as a capsule seam rather than a flat sticker.
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.lineWidth = Math.max(1, r * 0.08);
      roundedRect(ctx, cx - w / 2, cy - h / 2, w, h, corner);
      ctx.stroke();

      ctx.save();
      ctx.translate(cx, cy);
      drawPickupGlyph(ctx, pickup.k, r * 0.85);
      ctx.restore();
    }
  }

  /**
   * Shells are drawn from the snapshot with only a short linear carry.
   *
   * Extrapolating them properly would mean re-marching the lattice on the
   * client, and a mispredicted bounce — a shell visibly passing through a wall
   * and snapping back — reads far worse than a shell being a frame or two
   * behind. Capping the carry keeps it honest.
   */
  private drawBullets(
    ctx: CanvasRenderingContext2D,
    snap: TanksSnapshot,
    now: number,
    serverAt: number,
  ): void {
    const carry = Math.min(3, ticksBehind(now, serverAt)) / 60;
    for (const bullet of snap.bullets) {
      const x = bullet.x + bullet.vx * carry;
      const y = bullet.y + bullet.vy * carry;
      const radius = bullet.h === 1 ? 10 : 6;

      // A short trail behind the shell, which is most of what makes a ricochet
      // readable at speed.
      if (!this.reduced) {
        ctx.strokeStyle = 'rgba(255, 226, 150, 0.35)';
        ctx.lineWidth = radius;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - bullet.vx * 0.035, y - bullet.vy * 0.035);
        ctx.stroke();
      }

      ctx.fillStyle = bullet.h === 1 ? '#ff9f43' : '#ffe296';
      circle(ctx, x, y, radius);
    }
  }

  private drawTanks(
    ctx: CanvasRenderingContext2D,
    snap: TanksSnapshot,
    maze: Maze,
    now: number,
    serverAt: number,
  ): void {
    const behind = ticksBehind(now, serverAt);
    const controllable = snap.phase === 'playing' && !this.context.paused;

    for (const player of snap.players) {
      const mine = player.s === this.context.mySeat;
      const body: TankBody | null = mine
        ? this.predictor.update(now, maze, player, controllable)
        : advanceTank(player, maze, behind, controllable);

      if (!body) {
        this.drawWreck(ctx, player.x, player.y, player.a, player.s);
        continue;
      }

      const smoother = this.smootherFor(player.s);
      const drawn = smoother.apply(body.x, body.y, now, mine && this.predictor.resynced);
      this.drawTank(ctx, drawn.x, drawn.y, body.angle, player.s, player.bf);
    }
  }

  private drawTank(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    seat: number,
    buffs: TanksSnapshot['players'][number]['bf'],
  ): void {
    const palette = this.paletteFor(seat);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Shadow: same silhouette, solid black, hard-offset — never a blur.
    ctx.save();
    ctx.translate(SHADOW_OFFSET, SHADOW_OFFSET);
    this.paintTankSilhouette(ctx, SHADOW_PALETTE, 0);
    ctx.restore();

    this.paintTankSilhouette(ctx, palette, 0);

    ctx.restore();

    if (buffs?.shield) {
      ctx.strokeStyle = '#8be9fd';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, TANK_R + 9, 0, Math.PI * 2);
      ctx.stroke();
    }

    const name = this.context.nameBySeat[seat];
    if (name) {
      ctx.fillStyle = '#efe9dc';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(name, x, y - TANK_R - 12);
    }
  }

  private drawWreck(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    seat: number,
  ): void {
    const palette = this.paletteFor(seat);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = 0.35;
    // A knocked-askew turret is what reads as "destroyed" rather than "faded".
    this.paintTankSilhouette(ctx, palette, WRECK_TURRET_SKEW);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /**
   * The whole tank — tracks, hull, turret and barrel — as one shape, drawn in
   * `angle`-local space with the barrel along +x. Used both for the coloured
   * tank and, with `SHADOW_PALETTE`, for its offset shadow, so the shadow can
   * never drift out of sync with a shape change here.
   */
  private paintTankSilhouette(
    ctx: CanvasRenderingContext2D,
    palette: TankPalette,
    turretSkew: number,
  ): void {
    const trackHalfLen = TANK_R * 0.92;
    const trackWidth = TANK_R * 0.34;
    const trackOuter = TANK_R;
    const trackInner = trackOuter - trackWidth;

    // Tracks, both sides.
    ctx.fillStyle = palette.track;
    ctx.fillRect(-trackHalfLen, -trackOuter, trackHalfLen * 2, trackWidth);
    ctx.fillRect(-trackHalfLen, trackInner, trackHalfLen * 2, trackWidth);

    // Tread rungs — a handful of link lines across each track.
    ctx.strokeStyle = palette.hull;
    ctx.lineWidth = Math.max(1, TANK_R * 0.045);
    ctx.beginPath();
    const rungs = 6;
    for (let i = 1; i < rungs; i++) {
      const rx = -trackHalfLen + (trackHalfLen * 2 * i) / rungs;
      ctx.moveTo(rx, -trackOuter);
      ctx.lineTo(rx, -trackInner);
      ctx.moveTo(rx, trackInner);
      ctx.lineTo(rx, trackOuter);
    }
    ctx.stroke();

    // Hull, rounded rather than a hard block.
    const hullHalfLen = TANK_R * 0.8;
    const hullHalfWid = TANK_R * 0.58;
    const hullCorner = TANK_R * 0.28;
    ctx.fillStyle = palette.hull;
    roundedRect(ctx, -hullHalfLen, -hullHalfWid, hullHalfLen * 2, hullHalfWid * 2, hullCorner);
    ctx.fill();

    ctx.save();
    ctx.rotate(turretSkew);

    // Turret ring + cap.
    const turretR = TANK_R * 0.46;
    ctx.fillStyle = palette.turret;
    circle(ctx, 0, 0, turretR);
    ctx.fillStyle = palette.hull;
    circle(ctx, 0, 0, turretR - TANK_R * 0.1);

    // Barrel — tapered, so the aim direction stays the clearest thing on the
    // sprite. Pointing +x, same as the hull before rotation.
    const barrelBaseHalf = TANK_R * 0.16;
    const barrelTipHalf = TANK_R * 0.09;
    const barrelStart = turretR * 0.7;
    const barrelEnd = barrelStart + TANK_R * 0.95;
    const muzzleR = TANK_R * 0.12;

    ctx.fillStyle = palette.barrel;
    ctx.beginPath();
    ctx.moveTo(barrelStart, -barrelBaseHalf);
    ctx.lineTo(barrelEnd, -barrelTipHalf);
    ctx.lineTo(barrelEnd, barrelTipHalf);
    ctx.lineTo(barrelStart, barrelBaseHalf);
    ctx.closePath();
    ctx.fill();

    circle(ctx, barrelEnd, 0, muzzleR);

    ctx.restore();
  }

  /**
   * Seat colour plus its derived tread/turret/barrel shades, cached per seat
   * so the hex-shade math doesn't run every tank every frame — only when a
   * seat's colour actually changes.
   */
  private paletteFor(seat: number): TankPalette {
    const color = colorFor(this.context.colorBySeat[seat] ?? seat);
    const cached = this.paletteCache.get(seat);
    if (cached && cached.hull === color) return cached;

    const palette: TankPalette = {
      hull: color,
      track: shade(color, 0.45),
      turret: shade(color, 0.25),
      barrel: '#1c1a24',
    };
    this.paletteCache.set(seat, palette);
    return palette;
  }

  private smootherFor(seat: number): PositionSmoother {
    let smoother = this.smoothers.get(seat);
    if (!smoother) {
      smoother = new PositionSmoother();
      this.smoothers.set(seat, smoother);
    }
    return smoother;
  }

  // -------------------------------------------------------------------------

  /**
   * Server events to sound and shake.
   *
   * Bounces are capped per frame: six shells with six bounces each can produce
   * a dozen in one snapshot, and playing all of them is a wall of noise rather
   * than a sound effect.
   */
  private consumeEvents(snap: TanksSnapshot): void {
    let bounces = 0;
    for (const event of snap.events as TankEvent[]) {
      switch (event.t) {
        case 'fire':
          sfx.tankFire(event.heavy);
          break;
        case 'bounce':
          if (bounces < 2) sfx.ricochet();
          bounces += 1;
          break;
        case 'kill':
          sfx.explode();
          if (!this.reduced) this.shake = 14;
          break;
        case 'pickup':
          sfx.powerup();
          break;
        case 'shieldPop':
          sfx.shieldPop();
          break;
        case 'roundOver':
          sfx.win();
          break;
        default:
          break;
      }
    }
  }
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Adds a rounded-rect path (caller fills/strokes) — used for the tank hull. */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Darkens a `#rrggbb` colour toward black by `factor` (0..1). */
function shade(hex: string, factor: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.round(((num >> 16) & 0xff) * (1 - factor)));
  const g = Math.max(0, Math.round(((num >> 8) & 0xff) * (1 - factor)));
  const b = Math.max(0, Math.round((num & 0xff) * (1 - factor)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
