import { colorFor } from '@mg/shared';
import {
  BOMBIT_MAPS,
  BOMBIT_STAGE_URL,
  FUSE_TICKS,
  FLAME_TICKS,
  PLAYER_HALF,
  TILE,
  blastCells,
  bombAtTile,
  facingDelta,
  tileOf,
  type BombitBomb,
  type BombitEvent,
  type BombitPowerup,
  type BombitSnapshot,
  type FlameKind,
} from '@mg/shared/bombit';
import { CanvasStage } from '../../game/CanvasStage';
import { drawFace, drawHat, hatRise } from '../../game/appearance';
import { roundRect, shade } from '../../game/canvasDraw';
import { getImage } from '../../game/images';
import { PositionSmoother } from '../../game/PositionSmoother';
import { RemoteBodies } from '../../game/RemoteBodies';
import { feed } from '../../net/feed';
import { sfx } from '../../audio';
import { prefersReducedMotion } from '../../ui/motion';
import { arenaFromSnapshot, blockedIn, resetArenaCache, type ClientArena } from './arena';
import { BombitPredictor, advanceRemote, ticksBehind } from './predictor';

/**
 * The two block tiles, drawn once per wall and per crate at exactly `TILE`
 * square. The backdrop is per stage and lives on the map (`BOMBIT_STAGE_URL`).
 *
 * All three are *decoration over* a complete procedural drawing (see the note
 * at the top of `game/images.ts`): a missing file, a 404 or a slow connection
 * all end with the board still fully legible rather than blank.
 */
const WALL_URL = '/bombit/wall.png';
const CRATE_URL = '/bombit/crate.png';

const LETTERBOX = '#100f16';
const FLOOR = '#2b2233';
const FLOOR_ALT = '#312739';
const WALL = '#6f6478';
const WALL_TOP = '#8c8096';
const CRATE = '#b6763c';
const CRATE_TOP = '#d08c4c';
const INK = '#16121c';

/** Hard offset shadow, never a blur — see the note at the top of `tokens.css`. */
const SHADOW_OFFSET = 3;

/** How close to going off a bomb has to be before the warning is at full strength. */
const DANGER_LEAD = FUSE_TICKS;

/**
 * The fighter's half-extents, copied from Gun Mayhem's `PLAYER_WIDTH/HEIGHT`.
 *
 * Copied rather than imported: those are that game's *collision* numbers, and
 * importing them would make a Gun Mayhem hitbox tweak silently resize the cast
 * of a different game. Here they are purely how big the drawing is — collision
 * is `PLAYER_HALF` on the grid, and always was. A little under a tile tall is
 * what makes a character read as standing *in* a square.
 */
const FIGHTER_HALF_W = 13;
const FIGHTER_HALF_H = 20;

export interface BombitRenderContext {
  mySeat: number;
  colorBySeat: Record<number, number>;
  nameBySeat: Record<number, string>;
  hatBySeat: Record<number, number>;
  faceBySeat: Record<number, number>;
  paused: boolean;
}

/**
 * The Bomb It renderer.
 *
 * The one thing here that is gameplay rather than decoration is the **danger
 * overlay**: every tile a live bomb is going to burn, tinted and pulsing in
 * time with its fuse. It is drawn from `blastCells` — the same function the
 * server explodes with — so the warning cannot be subtly wrong in the corner
 * cases, which is the only way a telegraph can make a game *less* fair than no
 * telegraph at all.
 */
export class BombitRenderer {
  private stage: CanvasStage | null = null;
  private raf = 0;
  private context: BombitRenderContext;

  private readonly predictor = new BombitPredictor();
  /** Absorbs the jump when the local body changes which clock it is drawn from. */
  private readonly smoother = new PositionSmoother();
  /**
   * Everyone else, extrapolated rather than predicted.
   *
   * Movement here is a scalar along one axis at a time, so a velocity "event"
   * is a body starting, stopping or turning — all of which are worth snapping
   * to, and none of which extrapolation could have contained. Base speed is
   * ~187 units/s and the smallest genuine event is a full stop, so the
   * threshold sits comfortably under that and well above nothing.
   */
  private readonly remotes = new RemoteBodies(110);

  /**
   * Which way each seat is drawn facing, and how far through its stride it is.
   *
   * Facing is *last horizontal* rather than current: the fighter is drawn from
   * the front, so there is no up or down pose to switch to, and flipping the
   * sprite every time somebody turned a corner would strobe.
   */
  private readonly lastFacing = new Map<number, number>();
  private readonly stride = new Map<number, number>();

  private shake = 0;
  private reduced = false;
  private lastMap = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    context: BombitRenderContext,
  ) {
    this.context = context;
  }

  setContext(context: BombitRenderContext): void {
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
    this.lastFacing.clear();
    this.stride.clear();
    resetArenaCache();
  }

  // -------------------------------------------------------------------------

  private frame(now: number): void {
    const entry = feed.latest;
    if (!entry || entry.snap.game !== 'bombit') return;
    const snap: BombitSnapshot = entry.snap;

    const arena = arenaFromSnapshot(snap);
    const stage = this.stageFor(arena);
    if (!stage) return;

    if (this.lastMap !== snap.map) {
      // A new board means every smoothed position is about to teleport.
      this.lastMap = snap.map;
      this.smoother.reset();
      this.remotes.clear();
      this.predictor.reset();
    }

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

    this.drawFloor(ctx, arena);
    this.drawPickups(ctx, arena, snap, now);
    this.drawCrates(ctx, arena);
    this.drawWalls(ctx, arena);
    // Over the crates, not under them. A crate standing in a blast is exactly
    // the tile a player wants marked — it is where the arm stops *and* the
    // route that is about to open — and underneath, the crate hid its own
    // warning. Walls never appear in `blastCells`, so nothing paints over one.
    this.drawDanger(ctx, arena, snap, now);
    this.drawBombs(ctx, snap, now);
    this.drawFlames(ctx, arena, snap);
    this.drawPlayers(ctx, arena, snap, now, entry.serverAt);
  }

  /** Rebuilt when the board changes shape, which is once a round at most. */
  private stageFor(arena: ClientArena): CanvasStage | null {
    const width = arena.cols * TILE;
    const height = arena.rows * TILE;
    if (this.stage && this.stage.arenaWidth === width && this.stage.arenaHeight === height) {
      return this.stage;
    }
    this.stage?.detach();
    this.stage = new CanvasStage(this.canvas, width, height);
    this.stage.attach();
    return this.stage;
  }

  // -------------------------------------------------------------------------
  // The board
  // -------------------------------------------------------------------------

  private drawFloor(ctx: CanvasRenderingContext2D, arena: ClientArena): void {
    const width = arena.cols * TILE;
    const height = arena.rows * TILE;

    const stage = BOMBIT_MAPS[arena.mapId]?.stage;
    const image = stage ? getImage(BOMBIT_STAGE_URL[stage]) : null;
    if (image && image.naturalWidth > 0) {
      // Cover rather than stretch. The backdrops are 16:9 and the boards are
      // nearer square, so stretching one to fit visibly squashes the artwork;
      // cropping the overflow keeps it looking like what was drawn.
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const sw = width / scale;
      const sh = height / scale;
      ctx.drawImage(
        image,
        (image.naturalWidth - sw) / 2,
        (image.naturalHeight - sh) / 2,
        sw,
        sh,
        0,
        0,
        width,
        height,
      );
      // A slight darkening wash over the art. Bombs, fire and eight seat
      // colours all have to stay legible on top of a backdrop that was drawn to
      // be looked at, and this is what buys the contrast back.
      ctx.fillStyle = 'rgba(20, 16, 26, 0.28)';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    // A chequer rather than a flat fill: on a grid game the tiles themselves
    // are the thing to read, and a player judging whether they are clear of a
    // blast is really judging which square they are standing in.
    ctx.fillStyle = FLOOR;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = FLOOR_ALT;
    for (let cy = 0; cy < arena.rows; cy += 1) {
      for (let cx = (cy % 2 === 0 ? 0 : 1); cx < arena.cols; cx += 2) {
        ctx.fillRect(cx * TILE, cy * TILE, TILE, TILE);
      }
    }
  }

  private drawWalls(ctx: CanvasRenderingContext2D, arena: ClientArena): void {
    const image = getImage(WALL_URL);
    for (let cy = 0; cy < arena.rows; cy += 1) {
      for (let cx = 0; cx < arena.cols; cx += 1) {
        if (arena.walls[cy * arena.cols + cx] !== 1) continue;
        const x = cx * TILE;
        const y = cy * TILE;
        if (image) {
          ctx.drawImage(image, x, y, TILE, TILE);
          continue;
        }
        ctx.fillStyle = INK;
        ctx.fillRect(x + SHADOW_OFFSET, y + SHADOW_OFFSET, TILE, TILE);
        ctx.fillStyle = WALL;
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = WALL_TOP;
        ctx.fillRect(x, y, TILE, TILE * 0.22);
      }
    }
  }

  private drawCrates(ctx: CanvasRenderingContext2D, arena: ClientArena): void {
    const image = getImage(CRATE_URL);
    for (let cy = 0; cy < arena.rows; cy += 1) {
      for (let cx = 0; cx < arena.cols; cx += 1) {
        if (arena.crates[cy * arena.cols + cx] !== 1) continue;
        const x = cx * TILE;
        const y = cy * TILE;
        if (image) {
          ctx.drawImage(image, x, y, TILE, TILE);
          continue;
        }
        const inset = TILE * 0.06;
        ctx.fillStyle = INK;
        roundRect(ctx, x + inset + SHADOW_OFFSET, y + inset + SHADOW_OFFSET, TILE - inset * 2, TILE - inset * 2, 5);
        ctx.fill();
        ctx.fillStyle = CRATE;
        roundRect(ctx, x + inset, y + inset, TILE - inset * 2, TILE - inset * 2, 5);
        ctx.fill();
        ctx.fillStyle = CRATE_TOP;
        ctx.fillRect(x + inset, y + inset, TILE - inset * 2, TILE * 0.16);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + inset, y + inset);
        ctx.lineTo(x + TILE - inset, y + TILE - inset);
        ctx.moveTo(x + TILE - inset, y + inset);
        ctx.lineTo(x + inset, y + TILE - inset);
        ctx.stroke();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Bombs, danger and fire
  // -------------------------------------------------------------------------

  /**
   * Every tile a live bomb is going to burn, including through chains.
   *
   * The chain matters more than it sounds: the whole skill of the game is
   * standing next to a bomb you know is safe, and a bomb three tiles away that
   * is about to set off the one beside you is not something a player can work
   * out in the second they have. Followed to a depth of four, which is past any
   * chain anyone reads deliberately.
   */
  private dangerTiles(arena: ClientArena, snap: BombitSnapshot): Map<number, number> {
    const out = new Map<number, number>();
    if (snap.bombs.length === 0) return out;

    const bombs: BombitBomb[] = snap.bombs.map((b, index) => ({
      id: index + 1,
      owner: b.o,
      x: b.x,
      y: b.y,
      fuse: b.f,
      range: b.r,
      dir: b.d,
    }));

    for (const bomb of bombs) {
      const grid = {
        cols: arena.cols,
        rows: arena.rows,
        isWall: (cx: number, cy: number) => arena.walls[cy * arena.cols + cx] === 1,
        isCrate: (cx: number, cy: number) => arena.crates[cy * arena.cols + cx] === 1,
        hasBomb: (cx: number, cy: number) => {
          const other = bombAtTile(bombs, cx, cy);
          return other !== null && other.id !== bomb.id;
        },
      };

      // Chained bombs burn when the *first* one in the chain does, so the whole
      // chain inherits the shortest fuse that reaches it.
      let front = [bomb];
      const seen = new Set<number>([bomb.id]);
      for (let depth = 0; depth < 4 && front.length > 0; depth += 1) {
        const next: BombitBomb[] = [];
        for (const source of front) {
          for (const hit of blastCells(grid, tileOf(source.x), tileOf(source.y), source.range)) {
            const previous = out.get(hit.cell);
            if (previous === undefined || bomb.fuse < previous) out.set(hit.cell, bomb.fuse);
            if (!hit.bomb) continue;
            const struck = bombAtTile(bombs, hit.cx, hit.cy);
            if (struck && !seen.has(struck.id)) {
              seen.add(struck.id);
              next.push(struck);
            }
          }
        }
        front = next;
      }
    }
    return out;
  }

  private drawDanger(
    ctx: CanvasRenderingContext2D,
    arena: ClientArena,
    snap: BombitSnapshot,
    now: number,
  ): void {
    const danger = this.dangerTiles(arena, snap);
    if (danger.size === 0) return;

    for (const [cell, fuse] of danger) {
      const cx = cell % arena.cols;
      const cy = (cell - cx) / arena.cols;
      // Faint and steady while there is time, urgent and flashing when there is
      // not — so a glance says "soon" or "now" without anyone counting.
      const urgency = 1 - Math.min(1, fuse / DANGER_LEAD);
      const flash = this.reduced || fuse > 30 ? 1 : 0.55 + 0.45 * Math.sin(now / 55);
      ctx.fillStyle = `rgba(255, 72, 48, ${(0.13 + urgency * 0.34) * flash})`;
      ctx.fillRect(cx * TILE, cy * TILE, TILE, TILE);
      // An inset outline as well as a wash. On a dark floor a low-alpha tint is
      // easy to lose against the chequer, and the one thing this overlay must
      // never be is *nearly* visible — an edge reads at a glance and at any
      // brightness the phone happens to be set to.
      ctx.strokeStyle = `rgba(255, 120, 90, ${(0.2 + urgency * 0.5) * flash})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(cx * TILE + 1, cy * TILE + 1, TILE - 2, TILE - 2);
    }
  }

  private drawBombs(ctx: CanvasRenderingContext2D, snap: BombitSnapshot, now: number): void {
    for (const bomb of snap.bombs) {
      // Swells as the fuse runs down, and faster the closer it gets. The pulse
      // *is* the clock: a bomb you have to remember the age of is a bomb that
      // kills you.
      const left = Math.max(0, bomb.f) / FUSE_TICKS;
      const rate = 90 + left * 260;
      const pulse = this.reduced ? 1 : 1 + Math.sin(now / rate) * (0.06 + (1 - left) * 0.12);
      const r = TILE * 0.34 * pulse;
      const x = bomb.x;
      const y = bomb.y;

      ctx.fillStyle = INK;
      circle(ctx, x + SHADOW_OFFSET, y + SHADOW_OFFSET, r);

      ctx.fillStyle = '#241d2c';
      circle(ctx, x, y, r);
      // A highlight, so a black ball on a dark floor still reads as a sphere.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
      circle(ctx, x - r * 0.32, y - r * 0.34, r * 0.24);

      // Fuse: a stub that shortens, with a spark on the end.
      ctx.strokeStyle = '#c9b48d';
      ctx.lineWidth = Math.max(1.5, r * 0.14);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + r * 0.35, y - r * 0.7);
      ctx.lineTo(x + r * 0.5 + r * 0.3 * left, y - r * 1.1 - r * 0.35 * left);
      ctx.stroke();

      ctx.fillStyle = left > 0.35 ? '#ffd23f' : '#ff5252';
      circle(ctx, x + r * 0.5 + r * 0.3 * left, y - r * 1.1 - r * 0.35 * left, r * 0.17);

      // A kicked bomb gets a short motion streak, so "sliding" is legible from
      // the far side of the board rather than only when it hits something.
      if (bomb.d !== 0 && !this.reduced) {
        const { dx, dy } = facingDelta(bomb.d);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = r * 0.8;
        ctx.beginPath();
        ctx.moveTo(x - dx * r * 0.4, y - dy * r * 0.4);
        ctx.lineTo(x - dx * r * 1.5, y - dy * r * 1.5);
        ctx.stroke();
      }
    }
  }

  private drawFlames(
    ctx: CanvasRenderingContext2D,
    arena: ClientArena,
    snap: BombitSnapshot,
  ): void {
    for (const flame of snap.flames) {
      const cx = flame.c % arena.cols;
      const cy = (flame.c - cx) / arena.cols;
      const life = Math.max(0, Math.min(1, flame.t / FLAME_TICKS));
      // Flares to full in the first couple of ticks and then shrinks away, so
      // the blast reads as one motion rather than a rectangle that appears.
      const grow = Math.min(1, (1 - life) * 6);
      const shrink = 0.55 + 0.45 * life;
      const size = TILE * grow * shrink;
      const x = cx * TILE + TILE / 2;
      const y = cy * TILE + TILE / 2;

      // The whole tile goes red underneath, and that is the load-bearing part:
      // a burning tile has to read as *the tile*, because "am I standing in
      // it" is the only question anyone is asking. The shaped flame on top is
      // what makes a blast look like a blast; the square is what makes it
      // playable.
      ctx.fillStyle = `rgba(196, 32, 16, ${0.55 * life + 0.2})`;
      ctx.fillRect(cx * TILE, cy * TILE, TILE, TILE);

      // Hot rather than warm, in three layers. The first version was a tan and
      // a pale cream, which on a board full of wooden crates read as more
      // crates — the fire was the least alarming thing on the screen.
      paintFlame(ctx, x, y, size, flame.kind, `rgba(255, 61, 20, ${0.9 * life + 0.1})`);
      paintFlame(ctx, x, y, size * 0.66, flame.kind, `rgba(255, 176, 32, ${0.9 * life + 0.1})`);
      paintFlame(ctx, x, y, size * 0.34, flame.kind, `rgba(255, 250, 214, ${0.85 * life + 0.15})`);
    }
  }

  private drawPickups(
    ctx: CanvasRenderingContext2D,
    arena: ClientArena,
    snap: BombitSnapshot,
    now: number,
  ): void {
    for (const pickup of snap.pickups) {
      const cx = pickup.cell % arena.cols;
      const cy = (pickup.cell - cx) / arena.cols;
      const phase = (cx * 7 + cy * 13) % (Math.PI * 2);
      const bob = this.reduced ? 0 : Math.sin(now / 420 + phase) * TILE * 0.05;
      const x = cx * TILE + TILE / 2;
      const y = cy * TILE + TILE / 2 + bob;
      const size = TILE * 0.62;

      ctx.fillStyle = INK;
      roundRect(ctx, x - size / 2 + SHADOW_OFFSET, y - size / 2 + SHADOW_OFFSET, size, size, 7);
      ctx.fill();

      ctx.fillStyle = POWERUP_COLORS[pickup.kind];
      roundRect(ctx, x - size / 2, y - size / 2, size, size, 7);
      ctx.fill();

      ctx.save();
      ctx.translate(x, y);
      drawPowerupGlyph(ctx, pickup.kind, size * 0.34);
      ctx.restore();
    }
  }

  // -------------------------------------------------------------------------
  // Players
  // -------------------------------------------------------------------------

  private drawPlayers(
    ctx: CanvasRenderingContext2D,
    arena: ClientArena,
    snap: BombitSnapshot,
    now: number,
    serverAt: number,
  ): void {
    const behind = ticksBehind(now, serverAt);
    const controllable = snap.phase === 'playing' && !this.context.paused;

    // Once per frame, not once per body: the smoothing rule keys off whether
    // this frame is the first to see a newer snapshot.
    this.remotes.beginFrame(serverAt);

    // Drawn back to front, so someone standing on a tile below overlaps
    // correctly rather than flickering by seat order.
    const ordered = [...snap.players].sort((a, b) => a.y - b.y);

    for (const player of ordered) {
      const mine = player.s === this.context.mySeat;
      const body = mine
        ? this.predictor.update(now, arena, snap, player, controllable)
        : advanceRemote(player, arena, this.predictor.bombs, behind, controllable);

      if (!body) {
        if (mine) this.smoother.reset();
        else this.remotes.forget(player.s);
        this.drawGhost(ctx, player.x, player.y, player.s);
        continue;
      }

      const drawn = mine
        ? this.smoother.apply(body.x, body.y, now, this.predictor.resynced)
        : this.remotes.draw(player.s, body.x, body.y, velocityOf(body.facing, player), now);

      this.drawPlayer(ctx, drawn.x, drawn.y, player, now);
    }
  }

  /**
   * The Gun Mayhem fighter, seen from the front.
   *
   * Deliberately the *same* character rather than a top-down one of its own:
   * same proportions, same helmet, same `drawFace`/`drawHat` from
   * `game/appearance.ts`, so the person you dressed in the lobby is the person
   * on the board here too. Bomberman has always drawn its cast face-on even
   * though the board is overhead, and it is what makes a hat and a face legible
   * at all — from directly above there is nothing of either to see.
   *
   * Up and down keep the last horizontal facing, because there is no back or
   * front view to switch to and flipping on every turn would strobe.
   */
  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    player: BombitSnapshot['players'][number],
    now: number,
  ): void {
    const color = colorFor(this.context.colorBySeat[player.s] ?? player.s);
    const seat = player.s;
    const w = FIGHTER_HALF_W;
    const h = FIGHTER_HALF_H;

    if (player.f === 3) this.lastFacing.set(seat, -1);
    else if (player.f === 4) this.lastFacing.set(seat, 1);
    const facing = this.lastFacing.get(seat) ?? 1;

    const moving = (player.ib & 0b1111) !== 0;
    // The stride advances with the frame rather than with distance, which is
    // all it can do: a snapshot says which way somebody is walking, not how far
    // they have walked since the last one.
    const phase = ((this.stride.get(seat) ?? 0) + (moving && !this.reduced ? 0.32 : 0)) % (Math.PI * 2);
    this.stride.set(seat, phase);

    // Contact shadow, hard-offset like everything else in the site's style.
    ctx.fillStyle = 'rgba(20, 16, 26, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + h * 0.72, w * 0.9, w * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing, 1);
    ctx.lineJoin = 'round';

    // Legs.
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    const stride = moving ? Math.sin(phase) * 5 : 0;
    const lift = moving ? Math.abs(Math.cos(phase)) * 2.5 : 0;
    ctx.beginPath();
    ctx.moveTo(-4, h - 9);
    ctx.lineTo(-4 + stride, h - (stride > 0 ? lift : 0));
    ctx.moveTo(4, h - 9);
    ctx.lineTo(4 - stride, h - (stride < 0 ? lift : 0));
    ctx.stroke();

    // Body.
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    roundRect(ctx, -w, -h + 4, w * 2, h * 2 - 14, 7);
    ctx.fill();
    ctx.stroke();

    // Helmet.
    ctx.fillStyle = shade(color, -0.25);
    ctx.beginPath();
    ctx.moveTo(-w, -h + 11);
    ctx.arc(0, -h + 11, w, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Two different origins, same as Gun Mayhem: the hat sits on the crown of
    // the helmet, and the face goes on the strip of body *below* the rim —
    // drawn any higher it is dark ink on a dark helmet and invisible.
    ctx.save();
    ctx.translate(0, -h + 16);
    drawFace(ctx, this.context.faceBySeat[seat] ?? 0, w * 0.8);
    ctx.restore();

    ctx.save();
    ctx.translate(0, -h + 11);
    drawHat(ctx, this.context.hatBySeat[seat] ?? 0, color, w);
    ctx.restore();

    ctx.restore();

    const r = PLAYER_HALF;
    if (player.sh > 0) {
      ctx.strokeStyle = '#8be9fd';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, y - 2, r + 5, h + 4, 0, 0, Math.PI * 2);
      ctx.stroke();
      // One arc per shield held, so a stack is countable at a glance.
      if (player.sh > 1) {
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x, y - 2, r + 9, h + 8, 0, 0, Math.PI * 2 * Math.min(1, (player.sh - 1) / 2));
        ctx.stroke();
      }
    }

    // The two debuffs somebody else inflicted. Marked on the character rather
    // than only in the rail: the moment they matter is the moment you are
    // running, and nobody looks away then.
    if (player.sl || player.rv) {
      const wobble = this.reduced ? 0 : Math.sin(now / 140) * 2;
      ctx.fillStyle = player.rv ? '#c77dff' : '#7fd4ff';
      ctx.font = `700 ${Math.round(r * 0.9)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(player.rv ? '⇄' : '≈', x, y - h - 16 + wobble);
    }

    // Above the hat, not above the head — a top hat is taller than the gap a
    // nameplate would otherwise be spaced for.
    const name = this.context.nameBySeat[seat];
    if (name) {
      const lift = hatRise(this.context.hatBySeat[seat] ?? 0, w);
      ctx.fillStyle = '#efe9dc';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.strokeText(name, x, y - h - 8 - lift);
      ctx.fillText(name, x, y - h - 8 - lift);
    }
  }

  /** Where somebody died. Faded and slumped, so the board reads as emptier. */
  private drawGhost(ctx: CanvasRenderingContext2D, x: number, y: number, seat: number): void {
    const color = colorFor(this.context.colorBySeat[seat] ?? seat);
    const w = FIGHTER_HALF_W;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    roundRect(ctx, x - w, y + 2, w * 2, w * 1.1, 6);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // -------------------------------------------------------------------------

  /**
   * Server events to sound and shake.
   *
   * Explosions are capped per frame: a chain of eight bombs arrives in one
   * snapshot, and playing all of them at once is a clipped wall of noise rather
   * than a satisfying chain. Chained booms are quieter than the one that
   * started it, which is what makes a chain *sound* like a chain.
   */
  private consumeEvents(snap: BombitSnapshot): void {
    let booms = 0;
    for (const event of snap.events as BombitEvent[]) {
      switch (event.t) {
        case 'place':
          sfx.click();
          break;
        case 'kick':
          sfx.hit();
          break;
        case 'boom':
          if (booms < 3) sfx.explode();
          booms += 1;
          if (!this.reduced) this.shake = Math.min(18, this.shake + (event.chained ? 5 : 10));
          break;
        case 'crate':
          if (booms <= 3) sfx.crush();
          break;
        case 'pickup':
          sfx.powerup();
          break;
        case 'shieldPop':
          sfx.shieldPop();
          break;
        case 'death':
          sfx.ringOut();
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

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

/**
 * The drawn velocity of a remote body, for the slide-or-snap rule.
 *
 * Movement here is a scalar along whichever axis the body is travelling, so
 * this reconstructs it as a vector: a turn then counts as a change of velocity
 * the same way a stop does, which is right — both are events extrapolation
 * could not have contained.
 */
function velocityOf(
  facing: BombitSnapshot['players'][number]['f'],
  player: BombitSnapshot['players'][number],
): { vx: number; vy: number } {
  const moving = (player.ib & 0b1111) !== 0;
  if (!moving) return { vx: 0, vy: 0 };
  const { dx, dy } = facingDelta(facing);
  const speed = 190 + player.sp * 30;
  return { vx: dx * speed, vy: dy * speed };
}

const POWERUP_COLORS: Record<BombitPowerup, string> = {
  bomb: '#ff8b3d',
  range: '#ff5252',
  speed: '#ffd23f',
  shield: '#4ecdc4',
  slow: '#7fd4ff',
  reverse: '#c77dff',
};

/**
 * Glyphs are vector paths, not text or emoji — emoji rendering varies by
 * platform and reads as a UI icon rather than part of the game world.
 */
function drawPowerupGlyph(ctx: CanvasRenderingContext2D, kind: BombitPowerup, r: number): void {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = Math.max(1.6, r * 0.22);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (kind) {
    case 'bomb': {
      circle(ctx, 0, r * 0.2, r * 0.62);
      ctx.beginPath();
      ctx.moveTo(r * 0.3, -r * 0.3);
      ctx.lineTo(r * 0.65, -r * 0.8);
      ctx.stroke();
      break;
    }
    case 'range': {
      ctx.beginPath();
      ctx.moveTo(-r, 0);
      ctx.lineTo(r, 0);
      ctx.moveTo(0, -r);
      ctx.lineTo(0, r);
      ctx.stroke();
      for (const [ax, ay] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(ax * r * 0.55 + ay * r * 0.3, ay * r * 0.55 + ax * r * 0.3);
        ctx.lineTo(ax * r, ay * r);
        ctx.lineTo(ax * r * 0.55 - ay * r * 0.3, ay * r * 0.55 - ax * r * 0.3);
        ctx.stroke();
      }
      break;
    }
    case 'speed': {
      for (const dx of [-r * 0.35, r * 0.25] as const) {
        ctx.beginPath();
        ctx.moveTo(dx - r * 0.3, -r * 0.6);
        ctx.lineTo(dx + r * 0.35, 0);
        ctx.lineTo(dx - r * 0.3, r * 0.6);
        ctx.stroke();
      }
      break;
    }
    case 'shield': {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.85);
      ctx.quadraticCurveTo(r * 0.8, -r * 0.6, r * 0.65, 0);
      ctx.quadraticCurveTo(r * 0.55, r * 0.6, 0, r * 0.9);
      ctx.quadraticCurveTo(-r * 0.55, r * 0.6, -r * 0.65, 0);
      ctx.quadraticCurveTo(-r * 0.8, -r * 0.6, 0, -r * 0.85);
      ctx.stroke();
      break;
    }
    case 'slow': {
      circle(ctx, 0, 0, r * 0.2);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -r * 0.55);
      ctx.moveTo(0, 0);
      ctx.lineTo(r * 0.4, r * 0.2);
      ctx.stroke();
      break;
    }
    case 'reverse': {
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, -r * 0.3);
      ctx.lineTo(r * 0.75, -r * 0.3);
      ctx.moveTo(r * 0.4, -r * 0.65);
      ctx.lineTo(r * 0.75, -r * 0.3);
      ctx.lineTo(r * 0.4, r * 0.05);
      ctx.moveTo(r * 0.75, r * 0.5);
      ctx.lineTo(-r * 0.75, r * 0.5);
      ctx.moveTo(-r * 0.4, r * 0.15);
      ctx.lineTo(-r * 0.75, r * 0.5);
      ctx.lineTo(-r * 0.4, r * 0.85);
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

/**
 * One burning tile, shaped by which part of the blast it is.
 *
 * The arms are drawn as bars that fill the tile along their own axis and are
 * inset across it, so a long arm reads as one continuous beam of fire instead
 * of a row of separate squares — which is what a blast looks like, and also
 * what makes its length countable at a glance.
 */
function paintFlame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  kind: FlameKind,
  fill: string,
): void {
  const half = size / 2;
  const thin = size * 0.36;
  ctx.fillStyle = fill;

  switch (kind) {
    case 'centre':
      roundRect(ctx, x - half, y - half, size, size, size * 0.28);
      ctx.fill();
      return;
    case 'armH':
      roundRect(ctx, x - TILE / 2, y - thin, TILE, thin * 2, thin * 0.5);
      ctx.fill();
      return;
    case 'armV':
      roundRect(ctx, x - thin, y - TILE / 2, thin * 2, TILE, thin * 0.5);
      ctx.fill();
      return;
    case 'tipLeft':
      roundRect(ctx, x - half, y - thin, half + TILE / 2, thin * 2, thin * 0.6);
      ctx.fill();
      return;
    case 'tipRight':
      roundRect(ctx, x - TILE / 2, y - thin, half + TILE / 2, thin * 2, thin * 0.6);
      ctx.fill();
      return;
    case 'tipUp':
      roundRect(ctx, x - thin, y - half, thin * 2, half + TILE / 2, thin * 0.6);
      ctx.fill();
      return;
    case 'tipDown':
      roundRect(ctx, x - thin, y - TILE / 2, thin * 2, half + TILE / 2, thin * 0.6);
      ctx.fill();
      return;
  }
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Re-exported so the touch pad can ask the same question the renderer does. */
export { blockedIn };
