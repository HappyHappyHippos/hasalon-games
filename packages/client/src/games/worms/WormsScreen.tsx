import { useEffect, useRef, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import { colorFor, type RoomView } from '@mg/shared';
import { TICK_RATE } from '@mg/shared';
import { WEAPONS, isWeaponId, weaponsFor, type WormsWeaponId } from '@mg/shared/worms';
import { useStore } from '../../store';
import { socket } from '../../net/socket';
import { Screen } from '../../ui/Screen';
import { useShowTouchControls } from '../../ui/useTouchControls';
import { useVoice } from '../../ui/useVoice';
import { useT } from '../../strings';
import { WormsRenderer } from './Renderer';
import { attachWormsInput } from './input';
import { Controls } from './Controls';

interface Props {
  room: RoomView;
  mySeat: number;
}

export function WormsScreen({ room, mySeat }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WormsRenderer | null>(null);
  const inputRef = useRef<ReturnType<typeof attachWormsInput> | null>(null);
  const showTouch = useShowTouchControls();

  const hud = useStore((s) => s.hud);
  const worms = hud.worms;
  const settings = room.settings.game === 'worms' ? room.settings : null;
  const weapon = worms?.weapon ?? 'bazooka';
  const targeting = isWeaponId(weapon) ? WEAPONS[weapon].needsTarget === true : false;
  const myTurn = worms?.activeSeat === mySeat && mySeat >= 0;

  // Constructed once per mount, deliberately: the renderer owns its animation
  // frame, and rebuilding it whenever a prop changes would restart the loop
  // several times a second. Live data reaches it through `setContext`.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new WormsRenderer(canvas, {
      mySeat,
      colorBySeat: {},
      nameBySeat: {},
      paused: false,
    });
    rendererRef.current = renderer;
    renderer.start();

    inputRef.current = attachWormsInput({
      onBits: (bits, seq) => socket.sendInput({ seq, bits }),
      onCommand: (command) => socket.sendInput(command),
    });

    return () => {
      inputRef.current?.destroy();
      inputRef.current = null;
      renderer.stop();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const colorBySeat: Record<number, number> = {};
    const nameBySeat: Record<number, string> = {};
    for (const player of room.players) {
      if (player.seat < 0) continue;
      colorBySeat[player.seat] = player.colorIndex;
      nameBySeat[player.seat] = player.name;
    }
    rendererRef.current?.setContext({ mySeat, colorBySeat, nameBySeat, paused: room.paused });
  }, [room.players, room.paused, mySeat]);

  /**
   * Dragging pans; a tap on a map-targeting weapon places the mark.
   *
   * The distinction is the drag threshold, not the button: on a phone there is
   * no second button, and requiring a long-press to pan would make inspecting
   * the battlefield — the thing you spend a Worms turn doing — feel like a
   * gesture you have to get right.
   */
  const drag = useRef<{ id: number; x: number; y: number; moved: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    state.x = event.clientX;
    state.y = event.clientY;
    state.moved += Math.abs(dx) + Math.abs(dy);
    if (state.moved > 6) rendererRef.current?.panBy(dx, dy);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const state = drag.current;
    drag.current = null;
    if (!state || state.id !== event.pointerId) return;
    if (state.moved > 6 || !targeting || !myTurn) return;
    const world = rendererRef.current?.toWorld(event.clientX, event.clientY);
    if (world) inputRef.current?.setTarget(world.x, world.y);
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>): void => {
    rendererRef.current?.zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY);
  };

  return (
    <Screen
      room={room}
      mySeat={mySeat}
      canvasRef={canvasRef}
      hud={<WormsHud room={room} mySeat={mySeat} />}
      controls={
        <>
          <canvas
            // A transparent sheet over the arena purely to catch pointers. The
            // real canvas belongs to `Screen`, and reaching into its ref from
            // here to attach listeners would make two components own it.
            className="worms__pointer"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          />
          <WormsBanner mySeat={mySeat} />
          {mySeat >= 0 && showTouch && myTurn && (
            <Controls
              targeting={targeting}
              onButton={(bit, down) => inputRef.current?.setButton(bit, down)}
            />
          )}
          {mySeat >= 0 && myTurn && (
            <WeaponStrip
              extrasEnabled={settings?.extrasEnabled ?? true}
              current={weapon}
              ammo={worms?.ammo ?? {}}
              onPick={(id) => inputRef.current?.selectWeapon(id)}
            />
          )}
        </>
      }
    />
  );
}

/** Turn clock, wind and whose turn it is — the things you read, not watch. */
function WormsBanner({ mySeat }: { mySeat: number }): JSX.Element | null {
  const worms = useStore((s) => s.hud.worms);
  const phase = useStore((s) => s.hud.phase);
  const t = useT();
  if (!worms) return null;

  const mine = worms.activeSeat === mySeat && mySeat >= 0;
  const seconds = Math.max(0, Math.ceil(worms.turnTicks / TICK_RATE));
  const wind = worms.wind / 1000;

  return (
    <div className="worms__banner">
      <div className={`worms__clock${mine ? ' worms__clock--mine' : ''}`} dir="ltr">
        {phase === 'resolve' || phase === 'handoff' ? '—' : seconds}
      </div>
      <div className="worms__wind" aria-label={`${t.wormsWind} ${Math.round(wind * 100)}%`}>
        <span className="worms__wind-label">{t.wormsWind}</span>
        <div className="worms__wind-track">
          <span
            className="worms__wind-fill"
            style={{
              width: `${Math.abs(wind) * 50}%`,
              // Physical left/right, and deliberately not logical: this is a
              // compass, not text. It points the way the wind blows in the
              // world, which does not mirror with the interface language.
              left: wind >= 0 ? '50%' : `${50 - Math.abs(wind) * 50}%`,
            }}
          />
        </div>
      </div>
      {phase === 'retreat' && <span className="worms__cue">{t.wormsRetreat}</span>}
      {mine && phase === 'turn' && <span className="worms__cue">{t.wormsYourTurn}</span>}
    </div>
  );
}

function WeaponStrip({
  extrasEnabled,
  current,
  ammo,
  onPick,
}: {
  extrasEnabled: boolean;
  current: string;
  ammo: Record<string, number>;
  onPick: (id: WormsWeaponId) => void;
}): JSX.Element {
  return (
    <div className="worms__weapons">
      {weaponsFor(extrasEnabled).map((id, index) => {
        const left = ammo[id];
        const empty = left !== undefined && left <= 0;
        return (
          <button
            key={id}
            type="button"
            disabled={empty}
            className={`worms__weapon${current === id ? ' worms__weapon--on' : ''}`}
            onClick={() => onPick(id)}
            aria-label={id}
          >
            <span className="worms__weapon-key" dir="ltr">
              {(index + 1) % 10}
            </span>
            <span className="worms__weapon-icon" aria-hidden="true">
              {WEAPON_GLYPHS[id]}
            </span>
            {left !== undefined && (
              <span className="worms__weapon-ammo" dir="ltr">
                {left}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One glyph per weapon.
 *
 * Text, not drawings, and that is a compromise rather than a preference — the
 * repo's convention is vector glyphs (see `tanks/Renderer.ts:drawPickupGlyph`)
 * precisely because emoji render differently on every platform. Ten weapons is
 * ten little icons to draw; this gets the strip working and readable, and the
 * next pass can replace it without touching anything else.
 */
const WEAPON_GLYPHS: Record<WormsWeaponId, string> = {
  bazooka: '🚀',
  grenade: '💣',
  shotgun: '🔫',
  bat: '🏏',
  cluster: '🎆',
  dynamite: '🧨',
  homing: '🎯',
  mine: '💥',
  airstrike: '✈️',
  teleport: '🌀',
  clusterlet: '·',
  strikeBomb: '·',
};

function WormsHud({ room, mySeat }: Props): JSX.Element {
  const hud = useStore((s) => s.hud);
  const speaking = new Set(useVoice().speaking);

  const seated = room.players
    .filter((p) => p.seat >= 0)
    .map((player) => ({ player, live: hud.players.find((p) => p.seat === player.seat) }))
    .sort((a, b) => (b.live?.health ?? 0) - (a.live?.health ?? 0) || a.player.seat - b.player.seat);

  return (
    <>
      {seated.map(({ player, live }) => (
        <div
          key={player.id}
          className={`hudcard${live && !live.alive ? ' hudcard--out' : ''}${
            player.seat === mySeat ? ' hudcard--me' : ''
          }${hud.worms?.activeSeat === player.seat ? ' hudcard--turn' : ''}${
            speaking.has(player.id) ? ' hudcard--speaking' : ''
          }`}
          aria-label={`${player.name}: ${live?.health ?? 0}`}
        >
          <span className="hudcard__dot" style={{ background: colorFor(player.colorIndex) }} />
          <div className="hudcard__body">
            <span className="hudcard__name">{player.name}</span>
          </div>
          <span className="hudcard__score" dir="ltr">
            {live?.health ?? 0}
          </span>
        </div>
      ))}
    </>
  );
}
