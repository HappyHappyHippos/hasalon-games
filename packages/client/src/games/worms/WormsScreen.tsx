import { useState, useEffect, useRef, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
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
import { WeaponPickerModal } from './WeaponPickerModal';
import { WormsWeaponIcon } from './WormsWeaponIcons';

interface Props {
  room: RoomView;
  mySeat: number;
}

export function WormsScreen({ room, mySeat }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WormsRenderer | null>(null);
  const inputRef = useRef<ReturnType<typeof attachWormsInput> | null>(null);
  const showTouch = useShowTouchControls();
  const [pickerOpen, setPickerOpen] = useState(false);

  const hud = useStore((s) => s.hud);
  const worms = hud.worms;
  const settings = room.settings.game === 'worms' ? room.settings : null;
  const weapon = (worms?.weapon ?? 'bazooka') as WormsWeaponId;
  const targeting = isWeaponId(weapon) ? WEAPONS[weapon].needsTarget === true : false;
  const myTurn = worms?.activeSeat === mySeat && mySeat >= 0;

  // Key shortcuts (e.g. `Q` or `Tab`) open weapon picker modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!myTurn) return;
      if (e.code === 'KeyQ' || e.code === 'Tab') {
        e.preventDefault();
        setPickerOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [myTurn]);

  // Constructed once per mount
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

  const selectableWeapons = weaponsFor(settings?.extrasEnabled ?? true);

  return (
    <Screen
      room={room}
      mySeat={mySeat}
      canvasRef={canvasRef}
      hud={
        <>
          <WormsBanner mySeat={mySeat} />
          <WormsHud room={room} mySeat={mySeat} />
        </>
      }
      controls={
        <>
          <canvas
            className="worms__pointer"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          />
          {mySeat >= 0 && showTouch && myTurn && (
            <Controls
              currentWeapon={weapon}
              ammo={worms?.ammo ?? {}}
              onOpenPicker={() => setPickerOpen(true)}
              onButton={(bit, down) => inputRef.current?.setButton(bit, down)}
            />
          )}

          {mySeat >= 0 && myTurn && !showTouch && (
            <div className="worms__desktop-trigger-bar">
              <button
                type="button"
                className="worms__weapon-trigger"
                onClick={() => setPickerOpen(true)}
              >
                <WormsWeaponIcon id={weapon} size={24} />
                <span className="worms__weapon-trigger-ammo">
                  {worms?.ammo[weapon] !== undefined ? worms.ammo[weapon] : '∞'}
                </span>
                <span className="worms__weapon-trigger-arrow">▾</span>
              </button>
            </div>
          )}

          <WeaponPickerModal
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            weapons={selectableWeapons}
            current={weapon}
            ammo={worms?.ammo ?? {}}
            onPick={(id) => inputRef.current?.selectWeapon(id)}
          />
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
