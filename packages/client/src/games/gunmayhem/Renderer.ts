import { getImage } from '../../game/images';
import { TICK_MS, colorFor } from '@mg/shared';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BLAST_BOTTOM,
  BLAST_LEFT,
  BLAST_RIGHT,
  BLAST_TOP,
  BOMB_SIZE,
  CRATE_SIZE,
  GM_POWERUPS,
  PLAYER_HALF_H,
  PLAYER_HALF_W,
  POWERUP_SIZE,
  RUN_SPEED,
  WEAPONS,
  getLevel,
  type GmBuffKind,
  type GmSnapshotPlayer,
  type GunMayhemSnapshot,
  type Level,
  type WeaponKind,
} from '@mg/shared/gunmayhem';
import { feed } from '../../net/feed';
import { sfx } from '../../audio';
import { CanvasStage } from '../../game/CanvasStage';
import { drawFace, drawHat, hatRise } from '../../game/appearance';
import { bracket, lerp } from '../../game/interpolation';
import { PositionSmoother } from '../../game/PositionSmoother';
import { RemoteBodies } from '../../game/RemoteBodies';
import { isPredicting, predictsSelf } from '../../net/playbackMode';
import { prefersReducedMotion } from '../../ui/motion';
import { advancePlayer, ticksBehind } from './advance';
import { GunMayhemPredictor } from './predictor';
import { DeathFx, LocalShotFx } from './localFx';
import { drawBackdrop } from './stageArt';
import { drawSlash, drawWeapon, muzzleX, recoilStrength } from './weaponArt';

const INK = '#14110f';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

/**
 * The reduced-motion stand-in for a death explosion: a flat disc that fades
 * out rather than a burst of moving particles. Kept as its own list instead
 * of reusing `Particle` — particles are simulated (gravity, drift) and this
 * is deliberately static, the whole point of the reduced-motion path.
 */
interface DeathFlash {
  x: number;
  y: number;
  color: string;
  life: number;
}

export interface GunMayhemRenderContext {
  mySeat: number;
  colorBySeat: Record<number, number>;
  nameBySeat: Record<number, string>;
  hatBySeat: Record<number, number>;
  faceBySeat: Record<number, number>;
  /** The server has frozen the tick; predicting through that only drifts. */
  paused: boolean;
}

interface DrawnPlayer {
  x: number;
  y: number;
  facing: 1 | -1;
  onGround: boolean;
  vx: number;
  vy: number;
}

interface InterpolatedView {
  /** Newest snapshot: world entities and the input to prediction. */
  latest: GunMayhemSnapshot;
  /** The snapshot `bodies` were interpolated from, and their matching state. */
  delayed: GunMayhemSnapshot;
  bodies: Map<number, DrawnPlayer>;
}

/** A gunshot or knife swing in progress, purely for animation. */
interface Swing {
  /** 1 at the moment of firing, decaying to 0. */
  amount: number;
  kind: WeaponKind;
  /** Only meaningful for the knife. */
  hit: boolean;
}

export class GunMayhemRenderer {
  private stage: CanvasStage;
  private context: GunMayhemRenderContext;
  private predictor = new GunMayhemPredictor();
  /** Plays your own gunfire on the trigger press rather than the server's echo. */
  private localFx = new LocalShotFx();
  /** Guarantees each death explodes exactly once — see `localFx.ts`. */
  private deathFx = new DeathFx();
  /** Absorbs the jump when your own character changes which clock it is on. */
  private smoother = new PositionSmoother();
  /**
   * The same, once per other player.
   *
   * Only used while predicting. Each frame re-extrapolates them from whatever
   * the newest snapshot is, so the moment a new one lands their drawn position
   * steps by however far the previous guess was wrong. That step is the whole
   * visible cost of drawing the present instead of the past, and this is what
   * turns it into a slide — except where the step is a real event, which it
   * snaps to instead. `VELOCITY_EVENT` is 260: above what a couple of ticks of
   * gravity and friction account for, well below a jump (`AIR_JUMP_VELOCITY`
   * is -720).
   */
  private remotes = new RemoteBodies(260);
  /**
   * Where each seat was actually drawn last frame.
   *
   * Events carry the position the *server* resolved them at, which is where
   * that character was when the snapshot was authored — not where they are
   * being drawn now that everyone is extrapolated forward. Firing a muzzle
   * flash at the event's own coordinates leaves it hanging behind the gun by
   * however far the shooter has travelled since.
   */
  private drawnBySeat = new Map<number, { x: number; y: number }>();
  private wasPredicting = false;

  private raf = 0;
  private level: Level = getLevel('candyland');
  /**
   * Whether this frame's painted backdrop actually drew. Set by
   * `drawBackground` and read by `drawPlatforms` immediately after, so both
   * halves of the stage agree on whether they are painting or falling back.
   */
  private backdropLoaded = false;
  private seenEventTick = -1;
  private particles: Particle[] = [];
  private floaters: FloatingText[] = [];
  private deathFlashes: DeathFlash[] = [];
  private shake = 0;
  /** Per-seat firing animation, decayed every frame. */
  private swings = new Map<number, Swing>();
  /** Per-seat landing squash, so touching down has some weight to it. */
  private squash = new Map<number, number>();
  private wasAirborne = new Map<number, boolean>();
  /**
   * Per-seat stride clock, advanced by distance covered rather than by time.
   * Per seat and not shared, or four players would advance it four times a
   * frame and all run in lockstep.
   */
  private stridePhase = new Map<number, number>();

  constructor(canvas: HTMLCanvasElement, context: GunMayhemRenderContext) {
    this.stage = new CanvasStage(canvas, ARENA_WIDTH, ARENA_HEIGHT);
    this.context = context;
  }

  setContext(context: GunMayhemRenderContext): void {
    this.context = context;
  }

  start(): void {
    this.stage.attach();
    this.predictor.reset();
    this.smoother.reset();
    this.remotes.clear();
    this.drawnBySeat.clear();
    this.deathFx.reset();
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
    this.drawnBySeat.clear();
    this.deathFx.reset();
    this.wasPredicting = false;
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  private frame(now: number): void {
    // How far behind the present remote entities are drawn. The feed sets this
    // from measured jitter rather than a constant — on a clean link it is
    // barely more than a snapshot interval, and it deepens on its own when the
    // network gets choppy. Only *other* people's characters pay it; yours is
    // predicted.
    const renderTime = feed.renderTime(now);
    const latest = feed.latest;
    const latestSnap = latest?.snap;
    if (latestSnap && latestSnap.game === 'gunmayhem') {
      this.level = getLevel(latestSnap.levelId);
      if (latestSnap.tick > this.seenEventTick) {
        this.consumeEvents(latestSnap, now);
        this.seenEventTick = latestSnap.tick;
      }
    }

    const { ctx } = this.stage;
    this.stage.begin(INK);

    // Screen shake, applied inside the letterbox transform so it never reveals
    // the bars at the edges.
    if (this.shake > 0.2) {
      const amount = this.shake;
      ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
      this.shake *= 0.88;
    }

    this.decaySwings();

    this.drawBackground(now);
    this.drawPlatforms();

    const serverAt = latest?.serverAt ?? now;
    const view = isPredicting ? this.presentView(now, serverAt) : this.interpolate(renderTime);
    if (view) {
      // Bullets are extrapolated forward from the newest snapshot rather than
      // interpolated — they are fast enough that drawing them late reads as lag
      // — so the world entities all stay on the latest one.
      //
      // Crucially this uses *the same horizon the players got*. Bullets used to
      // carry their own 50 ms cap, which was harmless while everyone was drawn
      // in the past and both errors pointed the same way. Once players moved to
      // the present the two timelines came apart, and a bullet was drawn
      // progressively further behind the character who fired it.
      const ahead = isPredicting
        ? (ticksBehind(now, serverAt) * TICK_MS) / 1000
        : Math.min(0.05, Math.max(0, (now - serverAt) / 1000));

      this.drawPowerups(view.latest, now);
      this.drawCrates(view.latest);
      this.drawBombs(view.latest, now);
      this.drawBullets(view.latest, ahead);
      this.drawPlayers(view, now, serverAt);
    }

    this.drawParticles();
    this.drawFloaters();
    this.drawDeathFlashes();
  }

  // -------------------------------------------------------------------------
  // Stage
  // -------------------------------------------------------------------------

  /**
   * Paints the letterbox surplus as the void it actually is.
   *
   * The stage is a fixed 1280x720 but a phone held sideways is far wider than
   * 16:9, so the letterbox reveals world either side of it. That strip is not
   * scenery — it is reachable, and you survive in it until you cross
   * `BLAST_LEFT`/`BLAST_RIGHT`, which at that aspect ratio can sit off screen
   * entirely. Left flat it reads as ordinary playable ground you inexplicably
   * do not die in, which is exactly what was reported.
   *
   * So the strip is hatched, and the kill line is drawn on it whenever it is
   * visible. The bounds themselves stay untouched: the server has no idea what
   * shape anyone's screen is, and a viewport-dependent kill line would be a
   * desync by construction.
   */
  private drawOutOfPlay(): void {
    const { ctx } = this.stage;
    const view = this.stage.visibleRect();
    if (view.x0 >= 0 && view.x1 <= ARENA_WIDTH && view.y0 >= 0 && view.y1 <= ARENA_HEIGHT) {
      return;
    }

    ctx.save();

    // Hatching, not a flat fill — a second flat colour beside the sky still
    // reads as somewhere to stand. Diagonals read as "off the map" at a glance.
    ctx.beginPath();
    ctx.rect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    ctx.rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    ctx.clip('evenodd');

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 6;
    const span = view.x1 - view.x0 + (view.y1 - view.y0);
    for (let d = view.x0 - (view.y1 - view.y0); d < view.x0 + span; d += 34) {
      ctx.beginPath();
      ctx.moveTo(d, view.y0);
      ctx.lineTo(d + (view.y1 - view.y0), view.y1);
      ctx.stroke();
    }
    ctx.restore();

    // The kill line, wherever it falls inside the view. Off screen on a 16:9
    // display, which is why this was invisible until someone played sideways.
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 92, 92, 0.5)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (BLAST_LEFT > view.x0) {
      ctx.moveTo(BLAST_LEFT, view.y0);
      ctx.lineTo(BLAST_LEFT, view.y1);
    }
    if (BLAST_RIGHT < view.x1) {
      ctx.moveTo(BLAST_RIGHT, view.y0);
      ctx.lineTo(BLAST_RIGHT, view.y1);
    }
    if (BLAST_TOP > view.y0) {
      ctx.moveTo(view.x0, BLAST_TOP);
      ctx.lineTo(view.x1, BLAST_TOP);
    }
    if (BLAST_BOTTOM < view.y1) {
      ctx.moveTo(view.x0, BLAST_BOTTOM);
      ctx.lineTo(view.x1, BLAST_BOTTOM);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawBackground(now: number): void {
    const { ctx } = this.stage;
    const palette = this.level.palette;

    this.drawOutOfPlay();

    ctx.fillStyle = palette.sky;
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    // A wash of the level's accent from the top, rather than a disc — a hard
    // circle behind the action reads as a muddy blob and fights the sprites.
    const wash = ctx.createLinearGradient(0, 0, 0, ARENA_HEIGHT * 0.7);
    wash.addColorStop(0, hexToRgba(palette.accent, 0.16));
    wash.addColorStop(1, hexToRgba(palette.accent, 0));
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT * 0.7);

    // The painted backdrop goes over the sky and under everything else. Every
    // level has one, but it loads lazily — so for the first frames of a match,
    // and forever if the file is missing, the procedural stage below carries it.
    // `drawPlatforms` reads this too: outlined platforms are part of the same
    // fallback, and drawing neither is what leaves a stage with no floor.
    this.backdropLoaded = drawBackdrop(ctx, this.level.id);

    // Two slow parallax bands so the stage has depth without stealing focus.
    // Skipped under a backdrop, which already supplies the depth.
    if (!this.backdropLoaded) {
      const drift = Math.sin(now / 6000) * 18;
      ctx.fillStyle = palette.far;
      ctx.beginPath();
      ctx.ellipse(300 + drift, 640, 420, 230, 0, 0, Math.PI * 2);
      ctx.ellipse(1000 - drift, 680, 460, 240, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = palette.near;
      ctx.beginPath();
      ctx.ellipse(640 + drift * 0.5, 780, 620, 210, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPlatforms(): void {
    const { ctx } = this.stage;
    const palette = this.level.palette;
    // The painted stage draws its own platforms, so these are only for the
    // frames before it loads. See `drawBackground`.
    const painted = this.backdropLoaded;
    const isDebugHitboxes =
      typeof window !== 'undefined' && window.location.search.includes('debugHitboxes');

    for (const platform of this.level.platforms) {
      if (!painted) {
        ctx.fillStyle = palette.platform;
        roundRect(ctx, platform.x, platform.y, platform.w, platform.h, 5);
        ctx.fill();

        // Lit top face, so which side you can land on is obvious at a glance.
        ctx.fillStyle = palette.platformTop;
        roundRect(ctx, platform.x, platform.y, platform.w, Math.min(6, platform.h), 3);
        ctx.fill();

        ctx.lineWidth = 3;
        ctx.strokeStyle = INK;
        roundRect(ctx, platform.x, platform.y, platform.w, platform.h, 5);
        ctx.stroke();
      }

      // Dashes under one-way ledges: the visual language for "you can pass".
      if (platform.oneWay && !painted) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = palette.platformTop;
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 7]);
        ctx.beginPath();
        ctx.moveTo(platform.x + 4, platform.y + platform.h + 4);
        ctx.lineTo(platform.x + platform.w - 4, platform.y + platform.h + 4);
        ctx.stroke();
        ctx.restore();
      }

      // Debug overlay for verifying platform bounding box alignment
      if (isDebugHitboxes) {
        ctx.save();
        ctx.strokeStyle = platform.oneWay ? 'rgba(255, 0, 0, 0.9)' : 'rgba(0, 255, 0, 0.9)';
        ctx.fillStyle = platform.oneWay ? 'rgba(255, 0, 0, 0.25)' : 'rgba(0, 255, 0, 0.25)';
        ctx.lineWidth = 2;
        ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
        ctx.strokeRect(platform.x, platform.y, platform.w, platform.h);
        ctx.restore();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Entities
  // -------------------------------------------------------------------------

  /**
   * Everything a shot looks and sounds like, in one place.
   *
   * Called from two directions — the server's `shot` event for other people,
   * and the local trigger press for your own — and they must be
   * indistinguishable, or your gun would read differently from everyone else's.
   */
  private playShot(
    seat: number,
    kind: WeaponKind,
    x: number,
    y: number,
    dir: 1 | -1,
    showFlash = true,
  ): void {
    sfx.shoot(kind);
    const strength = recoilStrength(kind);
    this.swings.set(seat, { amount: 1, kind, hit: false });

    // Muzzle flash and smoke, both scaled by how big the gun is. Skipped for a
    // remote invisible shooter — a flash at their exact position would give
    // them away just as badly as drawing the body would.
    if (showFlash) {
      const flashX = x + dir * (muzzleX(kind) - PLAYER_HALF_W);
      this.spawnParticles(flashX, y, 4 + Math.round(strength * 8), '#fff3c4', dir * 260, 120 + strength * 220);
      this.spawnParticles(flashX, y, 3, '#b9b3a6', dir * 90, 60);
    }

    // The heavy weapons thump the camera. The pistol and SMG do not, or
    // full-auto fire would shake the screen continuously.
    if (strength > 0.5) this.shake = Math.max(this.shake, strength * 9);
  }

  /**
   * Everyone, simulated forward from the newest snapshot to this instant.
   *
   * The counterpart to `interpolate` below, and deliberately the same shape so
   * `drawPlayers` cannot tell which one it was handed. Note what is absent:
   * there is no buffer, no bracketing, and no correction state. Each frame
   * starts again from the newest snapshot, so nothing accumulates and nothing
   * needs reconciling — see the header of `advance.ts`.
   */
  private presentView(now: number, serverAt: number): InterpolatedView | null {
    const newest = feed.latest?.snap;
    if (!newest || newest.game !== 'gunmayhem') return null;

    const ticks = ticksBehind(now, serverAt);
    const playing = newest.phase === 'playing';
    const bodies = new Map<number, DrawnPlayer>();

    for (const player of newest.players) {
      const body = advancePlayer(player, this.level, ticks, playing);
      // null means the server owns them outright — off the stage waiting to
      // respawn, or out. `drawPlayers` skips those on the same condition.
      if (!body) continue;
      bodies.set(player.s, {
        x: body.x,
        y: body.y,
        facing: body.facing,
        onGround: body.onGround,
        vx: body.vx,
        vy: body.vy,
      });
    }

    // `delayed` is a misnomer in this mode and that is the point: the state a
    // character is drawn *with* and the position it is drawn *at* now come from
    // the same snapshot, so the mismatch the interpolated path has to be
    // careful about cannot arise here.
    return { latest: newest, delayed: newest, bodies };
  }

  private interpolate(renderTime: number): InterpolatedView | null {
    const found = bracket(feed.entries, renderTime);
    if (!found) return null;

    const fromSnap = found.from.snap;
    if (fromSnap.game !== 'gunmayhem') return null;
    const toSnap = found.to?.snap;
    const next = toSnap && toSnap.game === 'gunmayhem' ? toSnap : null;

    // Nothing newer to reach for: the next packet is late. Coast on last known
    // velocity for a moment instead of freezing — a character stopped dead in
    // mid-air and then teleporting is what reads as rubber-banding, and over
    // ~100 ms a straight-line guess is usually indistinguishable from the truth.
    // Ballistic only, deliberately: running real physics here would need level
    // collision, and a wrong guess that tunnels through a platform looks far
    // worse than one that drifts a few pixels.
    const coast = found.overshootMs / 1000;

    const bodies = new Map<number, DrawnPlayer>();
    for (const player of fromSnap.players) {
      const after = next?.players.find((p) => p.s === player.s);
      const alpha = after ? found.alpha : 0;
      bodies.set(player.s, {
        x: after ? lerp(player.x, after.x, alpha) : player.x + player.vx * coast,
        y: after ? lerp(player.y, after.y, alpha) : player.y + player.vy * coast,
        facing: player.f,
        onGround: player.g === 1,
        vx: player.vx,
        vy: player.vy,
      });
    }

    const newest = feed.latest?.snap;
    const latest = newest && newest.game === 'gunmayhem' ? newest : fromSnap;
    // `delayed` is the snapshot the bodies came from. Everything a character is
    // drawn *with* — stocks, respawn timer, invulnerability, jetpack — has to
    // be read from it too. Reading those from `latest` mixes a position from
    // one moment with the state from ~90 ms later, which is how a respawning
    // player ended up drawn streaking from the blast zone to their spawn point.
    return { latest, delayed: fromSnap, bodies };
  }

  private drawPlayers(view: InterpolatedView, now: number, latestAt: number): void {
    const { latest, delayed, bodies } = view;

    // A new snapshot is the only thing that moves a predicted remote character
    // for a reason that is not motion. Between snapshots their extrapolation is
    // continuous, so smoothing every frame would fight the movement itself.
    this.remotes.beginFrame(latestAt);

    for (const player of delayed.players) {
      const isLocal = player.s === this.context.mySeat;

      // Out of the game, or waiting to drop back in.
      const gone = player.rt > 0 || player.k <= 0;
      if (gone) {
        if (isLocal) this.releaseLocalBody();
        continue;
      }

      let body = bodies.get(player.s);
      let predicting = false;

      if (isLocal && predictsSelf && !this.context.paused) {
        // Prediction runs against the *newest* server state, replaying whatever
        // input it has not acknowledged — see `predictor.ts`.
        const server = latest.players.find((p) => p.s === player.s) ?? player;
        const controllable = latest.phase === 'playing';
        const predicted = this.predictor.update(now, this.level, server, controllable);
        if (predicted) {
          predicting = true;
          body = {
            x: predicted.x,
            y: predicted.y,
            facing: predicted.facing,
            onGround: predicted.onGround,
            vx: predicted.vx,
            vy: predicted.vy,
          };

          // Read after stepping, so the sound lands on the frame the character
          // leaves the ground rather than the one after.
          const jumped = this.predictor.consumeJump();
          if (jumped) sfx.jump(jumped === 'air');

          // Same idea for the gun, and from the same replay — so the flash, the
          // bang and the recoil all belong to one tick. Drawn from the predicted
          // body, so the flash is at the barrel the player can see rather than
          // where the server last reported them. A knife is excluded: `stab`
          // events carry whether the swing connected, which changes the whole
          // effect and is not something we can know locally.
          const fired = this.predictor.consumeShot();
          if (fired && !WEAPONS[fired].melee) {
            this.playShot(player.s, fired, body.x, body.y, body.facing);
            this.localFx.played(now);
          }
        }
      }
      if (!body) {
        if (isLocal) this.releaseLocalBody();
        continue;
      }

      if (isLocal) {
        // Changing which clock the body came from, and every resync, moves it
        // for reasons that are not motion. Slide instead of teleporting.
        const jumped = predicting !== this.wasPredicting || this.predictor.resynced;
        this.wasPredicting = predicting;
        const drawn = this.smoother.apply(body.x, body.y, now, jumped);
        body = { ...body, x: drawn.x, y: drawn.y };
      } else if (isPredicting) {
        // Everyone else, when they are being drawn at the present rather than
        // interpolated out of the past. The interpolated path needs none of
        // this: it only ever draws positions the server actually reported, so
        // there is nothing to be wrong about and nothing to absorb.
        // Only smooth what the extrapolation could plausibly have got wrong on
        // its own. A jump, a knockback or a landing all arrive as a velocity
        // step no guess could have contained; sliding into those is what made
        // jumping feel broken. `RemoteBodies` owns that distinction — Tank
        // Trouble and Gravity Guy need exactly the same rule.
        const drawn = this.remotes.draw(
          player.s,
          body.x,
          body.y,
          { vx: player.vx, vy: player.vy },
          now,
        );
        body = { ...body, x: drawn.x, y: drawn.y };
      }

      // Recorded before the invulnerability blink can `continue` past the draw,
      // so a shot fired on a blinking frame still flashes at the right barrel.
      this.drawnBySeat.set(player.s, { x: body.x, y: body.y });

      // Ground effects run whether or not the character is drawn this frame,
      // otherwise the invulnerability blink would strobe the dust too. Fx are
      // suppressed for a remote invisible player — landing dust and jetpack
      // flame at their feet would otherwise pinpoint them just as badly as
      // drawing the body would.
      const remoteHidden = !isLocal && (player.bf?.invis ?? 0) > 0;
      this.updateGroundEffects(player, body, !remoteHidden);
      if (player.jp > 0 && body.vy < -40 && !remoteHidden) this.emitJetpackFlame(body);

      // Blink while invulnerable so it reads as "cannot be hit".
      if (player.iv > 0 && Math.floor(now / 70) % 2 === 0) continue;

      this.drawCharacter(player, body, isLocal, now);
    }
  }

  /** Your character stopped being drawn; nothing to smooth from when it returns. */
  private releaseLocalBody(): void {
    this.smoother.reset();
    this.wasPredicting = false;
  }

  /**
   * Landing squash and skid dust. Both are derived from the body rather than
   * from events, because the server does not send a "you are skidding" message
   * and does not need to — the client can see it.
   */
  private updateGroundEffects(player: GmSnapshotPlayer, body: DrawnPlayer, spawnFx: boolean): void {
    const airborne = !body.onGround;
    const wasAirborne = this.wasAirborne.get(player.s) ?? false;
    this.wasAirborne.set(player.s, airborne);

    const current = this.squash.get(player.s) ?? 0;
    if (wasAirborne && !airborne) {
      this.squash.set(player.s, 1);
      if (spawnFx) {
        this.spawnParticles(body.x, body.y + PLAYER_HALF_H, 6, '#e6e0d4', 0, 130);
        sfx.land();
      }
    } else if (current > 0) {
      this.squash.set(player.s, Math.max(0, current - 0.09));
    }

    // Skid: on the ground, moving fast, and being asked to go the other way.
    // Only the local player's intent is known, so this reads velocity sign
    // changes instead — good enough, and it works for everyone.
    if (spawnFx && !airborne && Math.abs(body.vx) > RUN_SPEED * 0.55 && Math.random() < 0.25) {
      this.particles.push({
        x: body.x - Math.sign(body.vx) * 6,
        y: body.y + PLAYER_HALF_H - 1,
        vx: -body.vx * 0.12,
        vy: -30 - Math.random() * 40,
        life: 1,
        maxLife: 0.25,
        color: '#d8d2c6',
        size: 1.5 + Math.random() * 2,
      });
    }
  }

  private emitJetpackFlame(body: DrawnPlayer): void {
    this.particles.push({
      x: body.x + (Math.random() - 0.5) * 8,
      y: body.y + PLAYER_HALF_H - 2,
      vx: (Math.random() - 0.5) * 60,
      vy: 120 + Math.random() * 120,
      life: 1,
      maxLife: 0.22,
      color: Math.random() < 0.5 ? '#ff8b3d' : '#ffd23f',
      size: 2 + Math.random() * 2.5,
    });
  }

  private drawCharacter(
    player: GmSnapshotPlayer,
    body: DrawnPlayer,
    isLocal: boolean,
    now: number,
  ): void {
    const { ctx } = this.stage;
    const color = colorFor(this.context.colorBySeat[player.s] ?? player.s);
    const w = PLAYER_HALF_W;
    const h = PLAYER_HALF_H;
    // A top hat is taller than the gap the labels were spaced for, so both the
    // damage label and the marker move up by however far the hat sticks out.
    const lift = hatClearance(this.context.hatBySeat[player.s] ?? 0);

    const speed = Math.abs(body.vx);
    const swing = this.swings.get(player.s);
    const recoil = swing ? swing.amount : 0;
    const invisible = (player.bf?.invis ?? 0) > 0;

    // Invisible remote players are hidden outright — the whole point of the
    // buff is that opponents cannot see you. Only the local player still gets
    // a faint ghost of themselves, so they know the buff is active.
    const remoteHidden = invisible && !isLocal;

    ctx.save();

    if (invisible) ctx.globalAlpha = isLocal ? 0.55 : 0;

    ctx.translate(body.x, body.y);

    if (isLocal) this.drawSelfMarker(color, h, lift, now);

    ctx.scale(body.facing, 1);

    // Squash and stretch. Landing compresses, rising stretches — cheap, and it
    // is most of what makes a jump feel like it has weight.
    const landSquash = this.squash.get(player.s) ?? 0;
    const stretch = body.onGround ? 0 : clamp(-body.vy / 1400, -0.12, 0.14);
    const scaleY = 1 + stretch - landSquash * 0.28;
    const scaleX = 1 - stretch * 0.7 + landSquash * 0.3;
    ctx.translate(0, h - h * scaleY);
    ctx.scale(scaleX, scaleY);

    // Lean into the run, and back into a gunshot.
    const lean = clamp(body.vx / RUN_SPEED, -1, 1) * 0.12 - recoil * 0.18;
    ctx.rotate(lean * body.facing);

    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';

    this.drawLegs(player.s, body, speed, h);

    // Body.
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    roundRect(ctx, -w, -h + 4, w * 2, h * 2 - 14, 8);
    ctx.fill();
    ctx.stroke();

    // Helmet.
    ctx.fillStyle = shade(color, -0.25);
    ctx.beginPath();
    ctx.moveTo(-w, -h + 12);
    ctx.arc(0, -h + 12, w, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // The context is already flipped for facing, so both of these draw as
    // though looking right and land on the leading side either way.
    //
    // Two different origins: the hat sits on the crown of the helmet, but the
    // face goes on the strip of body *below* the helmet rim — drawn any higher
    // it would be dark ink on the dark helmet and effectively invisible.
    ctx.save();
    ctx.translate(0, -h + 17);
    drawFace(ctx, this.context.faceBySeat[player.s] ?? 0, w * 0.8);
    ctx.restore();

    ctx.save();
    ctx.translate(0, -h + 12);
    drawHat(ctx, this.context.hatBySeat[player.s] ?? 0, color, w);
    ctx.restore();

    this.drawArmedHand(player.w, color, w, recoil, swing);

    ctx.restore();

    // These are drawn outside the alpha scope above (they have their own
    // save/restore), so a remote-hidden player needs them skipped explicitly
    // or the shield glow, buff row (which would show the invis glyph itself)
    // and damage readout would each give away exactly where they are.
    if (!remoteHidden) {
      if ((player.bf?.shield ?? 0) > 0) this.drawShieldBubble(body, now);
      this.drawBuffGlyphs(player, body);
      this.drawNameplate(player, body, lift);
    }
  }

  /** Bobbing triangle over your own character, so you can always find yourself. */
  private drawSelfMarker(color: string, h: number, lift: number, now: number): void {
    const { ctx } = this.stage;
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    const bob = Math.sin(now / 220) * 2;
    // Sits above the damage label, which is itself above the head.
    ctx.beginPath();
    ctx.moveTo(0, -h - 34 - lift + bob);
    ctx.lineTo(-7, -h - 46 - lift + bob);
    ctx.lineTo(7, -h - 46 - lift + bob);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Legs. The stride is driven by how fast you are actually moving rather than
   * by the wall clock, which is the whole point — acceleration is deliberately
   * slow enough to see now, and the legs are what makes it visible.
   */
  private drawLegs(seat: number, body: DrawnPlayer, speed: number, h: number): void {
    const { ctx } = this.stage;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';

    if (!body.onGround) {
      // Tucked while rising, reaching while falling.
      const tuck = body.vy < 0 ? -5 : 3;
      ctx.beginPath();
      ctx.moveTo(-5, h - 10);
      ctx.lineTo(-7, h + tuck);
      ctx.moveTo(5, h - 10);
      ctx.lineTo(7, h - tuck);
      ctx.stroke();
      return;
    }

    if (speed < 20) {
      ctx.beginPath();
      ctx.moveTo(-5, h - 10);
      ctx.lineTo(-5, h);
      ctx.moveTo(5, h - 10);
      ctx.lineTo(5, h);
      ctx.stroke();
      return;
    }

    // Phase advances with distance covered, so the stride speeds up as you do.
    const phase = (this.stridePhase.get(seat) ?? 0) + (speed / RUN_SPEED) * 0.42;
    this.stridePhase.set(seat, phase % (Math.PI * 2));
    const stride = Math.sin(phase) * 6 * Math.min(1, speed / RUN_SPEED);
    const lift = Math.abs(Math.cos(phase)) * 3;
    ctx.beginPath();
    ctx.moveTo(-5, h - 10);
    ctx.lineTo(-5 + stride, h - (stride > 0 ? lift : 0));
    ctx.moveTo(5, h - 10);
    ctx.lineTo(5 - stride, h - (stride < 0 ? lift : 0));
    ctx.stroke();
  }

  /**
   * The weapon, plus an arm to hold it — the gun used to float unattached next
   * to the torso, which is most of why it read as a stray rectangle.
   */
  private drawArmedHand(
    kind: WeaponKind,
    color: string,
    w: number,
    recoil: number,
    swing: Swing | undefined,
  ): void {
    const { ctx } = this.stage;
    const shoulderX = w - 6;
    const shoulderY = -2;

    ctx.save();
    ctx.translate(shoulderX, shoulderY);

    // Knife swings overhead and down; guns stay level and kick back.
    if (kind === 'knife' && swing) {
      ctx.rotate((1 - swing.amount) * 0.9 - 0.45);
    } else {
      ctx.rotate(-recoil * 0.35);
    }

    // Arm first, so the weapon sits on top of it.
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(8, 1);
    ctx.stroke();
    ctx.strokeStyle = shade(color, 0.1);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(8, 1);
    ctx.stroke();

    drawWeapon(ctx, kind, recoil);

    if (kind === 'knife' && swing) {
      drawSlash(ctx, WEAPONS.knife.melee?.reach ?? 26, 1 - swing.amount, swing.hit);
    }

    ctx.restore();
  }

  private drawShieldBubble(body: DrawnPlayer, now: number): void {
    const { ctx } = this.stage;
    const pulse = 1 + Math.sin(now / 140) * 0.04;
    ctx.save();
    ctx.translate(body.x, body.y);
    ctx.scale(pulse, pulse);
    ctx.strokeStyle = GM_POWERUPS.shield.color;
    ctx.fillStyle = hexToRgba(GM_POWERUPS.shield.color, 0.16);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_HALF_H + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Active buffs as a row of glyphs under the feet.
   *
   * Deliberately on the canvas and not in the React HUD: these timers change
   * every tick, and the zustand store is only for slow-changing data.
   */
  private drawBuffGlyphs(player: GmSnapshotPlayer, body: DrawnPlayer): void {
    const active = player.bf ? (Object.keys(player.bf) as GmBuffKind[]) : [];
    const hasJetpack = player.jp > 0;
    if (active.length === 0 && !hasJetpack) return;

    const { ctx } = this.stage;
    const glyphs = active.map((kind) => GM_POWERUPS[kind]);
    if (hasJetpack) glyphs.push(GM_POWERUPS.jetpack);

    const spacing = 15;
    const startX = body.x - ((glyphs.length - 1) * spacing) / 2;
    const y = body.y + PLAYER_HALF_H + 14;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 13px Rubik Variable, system-ui, sans-serif';
    glyphs.forEach((def, index) => {
      const x = startX + index * spacing;
      ctx.fillStyle = def.color;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.fillText(def.icon, x, y + 0.5);
    });
    ctx.restore();
  }

  private drawNameplate(player: GmSnapshotPlayer, body: DrawnPlayer, lift: number): void {
    const { ctx } = this.stage;
    const damage = player.d;
    // Damage colours from white through yellow to red as you get launchier.
    const heat = Math.min(1, damage / 160);
    const color = `rgb(255, ${Math.round(255 - heat * 190)}, ${Math.round(255 - heat * 225)})`;

    // Above the head, and above the hat: below the feet it would sit inside
    // whatever platform they are standing on.
    const y = body.y - PLAYER_HALF_H - 10 - lift;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '800 18px Rubik Variable, system-ui, sans-serif';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.fillStyle = color;
    const label = `${Math.round(damage)}%`;
    ctx.strokeText(label, body.x, y);
    ctx.fillText(label, body.x, y);
    ctx.restore();
  }

  private drawBullets(snap: GunMayhemSnapshot, ahead: number): void {
    const { ctx } = this.stage;

    for (const bullet of snap.bullets) {
      const x = bullet.x + bullet.vx * ahead;
      const y = bullet.y + bullet.vy * ahead;
      const color = colorFor(this.context.colorBySeat[bullet.o] ?? bullet.o);
      const big = bullet.k === 'rocket' || bullet.k === 'sniper';

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(bullet.vy, bullet.vx));

      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = color;
      ctx.lineWidth = big ? 4 : 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-(big ? 26 : 16), 0);
      ctx.lineTo(0, 0);
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.fillStyle = big ? '#fff3c4' : color;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      roundRect(ctx, -4, -(big ? 4 : 2.5), big ? 14 : 9, big ? 8 : 5, 3);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawBombs(snap: GunMayhemSnapshot, now: number): void {
    const { ctx } = this.stage;
    for (const bomb of snap.bombs) {
      ctx.save();
      ctx.translate(bomb.x, bomb.y);
      ctx.fillStyle = '#2b2b33';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, BOMB_SIZE / 2 + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Fuse spark.
      ctx.fillStyle = Math.floor(now / 90) % 2 === 0 ? '#ffd23f' : '#ff8b3d';
      ctx.beginPath();
      ctx.arc(4, -BOMB_SIZE / 2 - 3, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * Powerups. Bobbing and haloed, so they never get confused with a weapon
   * crate — the crate is a brown box that fell out of the sky, this is a
   * coloured coin hovering in place.
   */
  private drawPowerups(snap: GunMayhemSnapshot, now: number): void {
    const { ctx } = this.stage;
    const half = POWERUP_SIZE / 2;

    for (const powerup of snap.powerups) {
      const def = GM_POWERUPS[powerup.k];
      const bob = Math.sin(now / 320 + powerup.i) * 4;

      ctx.save();
      ctx.translate(powerup.x, powerup.y + bob);

      // Halo, so it catches the eye across a busy stage.
      const halo = ctx.createRadialGradient(0, 0, half * 0.5, 0, 0, half * 2.1);
      halo.addColorStop(0, hexToRgba(def.color, 0.4));
      halo.addColorStop(1, hexToRgba(def.color, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, half * 2.1, 0, Math.PI * 2);
      ctx.fill();

      const img = getImage(`/powerups/powerup_${powerup.k}.png`);
      if (img) {
        ctx.drawImage(img, -half, -half, POWERUP_SIZE, POWERUP_SIZE);
        ctx.restore();
        continue;
      }

      ctx.fillStyle = def.color;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, half, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = INK;
      ctx.font = '800 16px Rubik Variable, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, 0, 1);
      ctx.restore();
    }
  }

  private drawCrates(snap: GunMayhemSnapshot): void {
    const { ctx } = this.stage;
    const half = CRATE_SIZE / 2;

    for (const crate of snap.crates) {
      ctx.save();
      ctx.translate(crate.x, crate.y);

      ctx.fillStyle = '#c98a4b';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      roundRect(ctx, -half, -half, CRATE_SIZE, CRATE_SIZE, 5);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-half, -half);
      ctx.lineTo(half, half);
      ctx.moveTo(half, -half);
      ctx.lineTo(-half, half);
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = INK;
      ctx.font = '800 15px Rubik Variable, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(WEAPONS[crate.w].icon, 0, 1);
      ctx.restore();
    }
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  private consumeEvents(snap: GunMayhemSnapshot, now: number): void {
    for (const event of snap.events) {
      switch (event.t) {
        case 'shot': {
          // Our own shots have already been drawn and heard, the instant the
          // trigger went down. Drawing them again a round trip later is a
          // double flash and a double bang.
          if (event.seat === this.context.mySeat && this.localFx.consume(now)) break;
          // Fire it from where the shooter is being *drawn*, not from where the
          // server resolved the shot — see `drawnBySeat`. Falls back to the
          // event's own position for anyone not currently on screen.
          const at = this.drawnBySeat.get(event.seat);
          const shooter = snap.players.find((p) => p.s === event.seat);
          const shooterHidden =
            event.seat !== this.context.mySeat && (shooter?.bf?.invis ?? 0) > 0;
          this.playShot(
            event.seat,
            event.kind,
            at?.x ?? event.x,
            at?.y ?? event.y,
            event.dir,
            !shooterHidden,
          );
          break;
        }
        case 'stab': {
          sfx.stab(event.hit);
          this.swings.set(event.seat, { amount: 1, kind: 'knife', hit: event.hit });
          // Same reasoning as `shot`: a knife lands at arm's length from where
          // the attacker is drawn, not from where the server last reported them.
          // An invisible remote attacker skips the spark too, or it would land
          // exactly where they are and undo the whole point of the buff.
          const attacker = snap.players.find((p) => p.s === event.seat);
          const attackerHidden =
            event.seat !== this.context.mySeat && (attacker?.bf?.invis ?? 0) > 0;
          if (!attackerHidden) {
            const from = this.drawnBySeat.get(event.seat);
            const sx = (from?.x ?? event.x) + event.dir * 20;
            const sy = from?.y ?? event.y;
            if (event.hit) {
              this.spawnParticles(sx, sy, 10, '#fff3c4', event.dir * 220, 200);
              this.shake = Math.max(this.shake, 6);
            } else {
              this.spawnParticles(sx, sy, 3, '#e8ecf5', event.dir * 140, 70);
            }
          }
          break;
        }
        case 'powerup': {
          sfx.powerup();
          const def = GM_POWERUPS[event.kind];
          this.spawnParticles(event.x, event.y, 16, def.color, 0, 240);
          this.floaters.push({
            x: event.x,
            y: event.y - 14,
            text: def.label,
            color: def.color,
            life: 1,
          });
          break;
        }
        case 'shieldPop':
          sfx.shieldPop();
          this.spawnParticles(event.x, event.y, 18, GM_POWERUPS.shield.color, 0, 260);
          break;
        case 'hit':
          sfx.hit();
          this.spawnParticles(event.x, event.y, 8, '#fff3c4', 0, 190);
          this.floaters.push({
            x: event.x,
            y: event.y - 20,
            text: `${Math.round(event.damage)}`,
            color: '#ffd23f',
            life: 1,
          });
          break;
        case 'explode':
          sfx.explode();
          this.spawnParticles(event.x, event.y, 26, '#ff8b3d', 0, 420);
          this.spawnParticles(event.x, event.y, 12, '#ffd23f', 0, 260);
          this.shake = 16;
          break;
        case 'died': {
          sfx.ringOut();
          // `snap.tick` plus the seat is a unique handle on *this* death —
          // `DeathFx` is the belt to `seenEventTick`'s suspenders (see its own
          // comment): the outer per-tick gate already keeps this switch from
          // running twice for the same snapshot, but the explosion is the one
          // effect the issue calls out by name, so it gets its own guarantee
          // that isn't riding on renderer bookkeeping a test can't reach.
          if (!this.deathFx.consume(event.seat, snap.tick)) break;

          const x = event.x;
          const y = Math.min(event.y, ARENA_HEIGHT - 20);
          const color = colorFor(this.context.colorBySeat[event.seat] ?? event.seat);

          if (prefersReducedMotion()) {
            // A brief static flash instead of a particle burst — same
            // duration budget, none of the motion.
            this.deathFlashes.push({ x, y, color, life: 1 });
          } else {
            // Bigger and tinted to the dying player's colour, otherwise the
            // same shape as a bomb's `explode` — see that case above. Short
            // particle lifetimes (inherited from `spawnParticles`) matter
            // here specifically: a `respawn` event lands the player at their
            // spawn point moments later, and this must have finished fading
            // before that reads as "obscured".
            this.spawnParticles(x, y, 30, color, 0, 460);
            this.spawnParticles(x, y, 16, '#fff', 0, 300);
          }

          this.shake = Math.max(this.shake, 10);
          break;
        }
        case 'jump':
          // Your own jump only, and only when prediction is off.
          //
          // While predicting, `drawPlayers` plays the sound off the replay so it
          // lands on the frame you press rather than a round trip later; taking
          // it from the server event too would double it. This is the fallback
          // for the frames prediction is not running.
          //
          // Other seats are deliberately silent. Four players jumping
          // constantly is noise, and a jump is already legible on screen.
          if (event.seat !== this.context.mySeat) break;
          if (!this.predictor.active) sfx.jump(event.double);
          break;
        case 'pickup':
          sfx.pickup();
          break;
        default:
          break;
      }
    }
  }

  /**
   * Age the firing animations. Frame-rate dependent on purpose: it is a purely
   * cosmetic decay, and tying it to a timer for a ~200ms flourish buys nothing.
   */
  private decaySwings(): void {
    for (const [seat, swing] of this.swings) {
      swing.amount *= 0.82;
      if (swing.amount < 0.02) this.swings.delete(seat);
    }
  }

  private spawnParticles(
    x: number,
    y: number,
    count: number,
    color: string,
    biasX: number,
    speed: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const magnitude = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * magnitude + biasX,
        vy: Math.sin(angle) * magnitude,
        life: 1,
        maxLife: 0.35 + Math.random() * 0.35,
        color,
        size: 2 + Math.random() * 3,
      });
    }
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
  }

  private drawParticles(): void {
    const { ctx } = this.stage;
    const dt = 1 / 60;

    this.particles = this.particles.filter((p) => {
      p.life -= dt / p.maxLife;
      if (p.life <= 0) return false;
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return true;
    });
  }

  private drawFloaters(): void {
    const { ctx } = this.stage;
    const dt = 1 / 60;

    this.floaters = this.floaters.filter((f) => {
      f.life -= dt / 0.8;
      if (f.life <= 0) return false;
      f.y -= 40 * dt;

      ctx.save();
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.textAlign = 'center';
      ctx.font = '800 16px Rubik Variable, system-ui, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
      return true;
    });
  }

  /**
   * The reduced-motion death effect: a disc that only fades, never moves or
   * grows. `FLASH_LIFETIME_MS` is short on purpose — brief enough that it is
   * gone well before a `respawn` event could place the same player back on
   * screen nearby.
   */
  private drawDeathFlashes(): void {
    const { ctx } = this.stage;
    const dt = 1 / 60;

    this.deathFlashes = this.deathFlashes.filter((f) => {
      f.life -= dt / (FLASH_LIFETIME_MS / 1000);
      if (f.life <= 0) return false;

      ctx.save();
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(f.x, f.y, PLAYER_HALF_H + 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return true;
    });
  }
}

/** How long the reduced-motion death flash stays visible. */
const FLASH_LIFETIME_MS = 220;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * How much further up the labels have to go for this hat. The 7 is the gap
 * already between the top of the head and the damage label, which short hats
 * fit inside for free.
 */
function hatClearance(hatIndex: number): number {
  return Math.max(0, hatRise(hatIndex, PLAYER_HALF_W) - 7);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

/** A hex colour as an rgba() string at the given alpha, for gradient stops. */
function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const num = Number.parseInt(value, 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Darken (negative) or lighten (positive) a hex colour. */
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
