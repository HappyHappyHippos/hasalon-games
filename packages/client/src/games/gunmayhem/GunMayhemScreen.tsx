import { useCallback, useEffect, useRef, type JSX } from 'react';
import { colorFor, type RoomView } from '@mg/shared';
import { WEAPONS, type WeaponKind } from '@mg/shared/gunmayhem';
import { useStore } from '../../store';
import { useT } from '../../strings';
import { socket } from '../../net/socket';
import { GunMayhemRenderer } from './Renderer';
import { attachGunMayhemInput, type InputController } from './input';
import { TouchPad } from './TouchPad';
import { Screen } from '../../ui/Screen';
import { useShowTouchControls } from '../../ui/useTouchControls';
import { useVoice } from '../../ui/useVoice';

interface Props {
  room: RoomView;
  mySeat: number;
}

export function GunMayhemScreen({ room, mySeat }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GunMayhemRenderer | null>(null);
  const inputRef = useRef<InputController | null>(null);
  const showTouch = useShowTouchControls();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new GunMayhemRenderer(canvas, {
      mySeat,
      colorBySeat: {},
      nameBySeat: {},
      hatBySeat: {},
      faceBySeat: {},
      paused: false,
    });
    rendererRef.current = renderer;
    renderer.start();

    // One input per tick, whether or not anything changed. The predictor reads
    // the same buffer `input.ts` records into, so there is nothing to forward
    // here beyond putting it on the wire.
    const input = attachGunMayhemInput((bits, seq) => {
      socket.sendInput({ seq, bits });
    });
    inputRef.current = input;

    return () => {
      input.destroy();
      inputRef.current = null;
      renderer.stop();
      rendererRef.current = null;
    };
    // Seat and colours are pushed in through setContext below, so this only
    // needs to run once for the lifetime of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const colorBySeat: Record<number, number> = {};
    const nameBySeat: Record<number, string> = {};
    const hatBySeat: Record<number, number> = {};
    const faceBySeat: Record<number, number> = {};
    for (const player of room.players) {
      if (player.seat < 0) continue;
      colorBySeat[player.seat] = player.colorIndex;
      nameBySeat[player.seat] = player.name;
      hatBySeat[player.seat] = player.hat;
      faceBySeat[player.seat] = player.face;
    }
    rendererRef.current?.setContext({
      mySeat,
      colorBySeat,
      nameBySeat,
      hatBySeat,
      faceBySeat,
      paused: room.paused,
    });
  }, [room.players, room.paused, mySeat]);

  const onPadButton = useCallback((bit: number, down: boolean) => {
    inputRef.current?.setButton(bit, down);
  }, []);

  return (
    <Screen
      room={room}
      mySeat={mySeat}
      canvasRef={canvasRef}
      hud={<GunMayhemHud room={room} mySeat={mySeat} />}
      controls={mySeat >= 0 && showTouch ? <TouchPad onButton={onPadButton} /> : null}
    />
  );
}

function GunMayhemHud({ room, mySeat }: Props): JSX.Element {
  const hud = useStore((s) => s.hud);
  const t = useT();
  const speaking = new Set(useVoice().speaking);

  const seated = room.players
    .filter((p) => p.seat >= 0)
    .map((player) => ({
      player,
      live: hud.players.find((p) => p.seat === player.seat),
    }))
    .sort((a, b) => (b.live?.score ?? 0) - (a.live?.score ?? 0) || a.player.seat - b.player.seat);

  return (
    <>
      {seated.map(({ player, live }) => {
        const stocks = live?.stocks ?? 0;
        const out = stocks <= 0;
        return (
          <div
            key={player.id}
            className={`hudcard${out ? ' hudcard--out' : ''}${
              player.seat === mySeat ? ' hudcard--me' : ''
            }${speaking.has(player.id) ? ' hudcard--speaking' : ''}`}
            // On small screens every non-`--me` card collapses to a dot plus
            // score (see .hudcard in styles.css); this keeps the name reachable
            // for assistive tech even though it's visually hidden there.
            aria-label={`${player.name}: ${live?.score ?? player.score}`}
          >
            <span className="hudcard__dot" style={{ background: colorFor(player.colorIndex) }} />
            <div className="hudcard__body">
              <span className="hudcard__name">{player.name}</span>
              <span className="hudcard__stocks" aria-label={t.livesLeft(stocks)}>
                {'●'.repeat(Math.max(0, Math.min(stocks, 6)))}
                {stocks > 6 ? `+${stocks - 6}` : ''}
              </span>
            </div>
            <div className="hudcard__right">
              <span className="hudcard__damage">{Math.round(live?.damage ?? 0)}%</span>
              <span className="hudcard__weapon">
                {(() => {
                  const weapon = (live?.weapon ?? 'pistol') as WeaponKind;
                  const ammo = live?.ammo ?? 0;
                  // The pistol is the only weapon that ever sits at 0 ammo —
                  // every other weapon empties straight back to a full pistol
                  // (see `spendRound` in shooting.ts) — so ammo === 0 on the
                  // pistol unambiguously means "reloading" rather than "out".
                  const reloading = weapon === 'pistol' && ammo === 0;
                  if (reloading) return t.weaponReloading;
                  return `${WEAPONS[weapon].icon}${ammo ? ` ${ammo}` : ''}`;
                })()}
              </span>
            </div>
            <span className="hudcard__score">{live?.score ?? player.score}</span>
          </div>
        );
      })}
    </>
  );
}
