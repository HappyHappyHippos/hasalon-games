import { useEffect, useRef, type JSX } from 'react';
import { colorFor, type RoomView } from '@mg/shared';
import { defaultConfig, type AchtungConfig } from '@mg/shared/achtung';
import { useStore } from '../../store';
import { socket } from '../../net/socket';
import { AchtungRenderer } from './Renderer';
import { attachInput, resetAchtungInput } from './input';
import { Screen } from '../../ui/Screen';
import { useShowTouchControls } from '../../ui/useTouchControls';
import { useVoice } from '../../ui/useVoice';
import { useT } from '../../strings';

interface Props {
  room: RoomView;
  mySeat: number;
}

const EFFECT_ICONS: Record<string, string> = {
  speedUp: '»',
  speedDown: '«',
  thin: '−',
  thick: '+',
  ghost: '○',
  invert: '↔',
};

export function AchtungScreen({ room, mySeat }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<AchtungRenderer | null>(null);
  const showTouch = useShowTouchControls();
  const matchNonce = useStore((state) => state.matchNonce);

  const settings: AchtungConfig =
    room.settings.game === 'achtung' ? room.settings : defaultConfig(room.players.length);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new AchtungRenderer(canvas, {
      mySeat,
      colorBySeat: {},
      nameBySeat: {},
      hatBySeat: {},
      settings,
      paused: false,
    });
    rendererRef.current = renderer;
    renderer.start();

    // The whole arena is the touch surface: left half turns left, right turns right.
    const surface = surfaceRef.current ?? canvas;
    const input = attachInput(surface, (turn) => socket.sendInput(turn));

    return () => {
      input.destroy();
      renderer.stop();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    resetAchtungInput();
    rendererRef.current?.reset();
    socket.sendInput(0);
  }, [matchNonce]);

  useEffect(() => {
    const colorBySeat: Record<number, number> = {};
    const nameBySeat: Record<number, string> = {};
    const hatBySeat: Record<number, number> = {};
    for (const player of room.players) {
      if (player.seat < 0) continue;
      colorBySeat[player.seat] = player.colorIndex;
      nameBySeat[player.seat] = player.name;
      hatBySeat[player.seat] = player.hat;
    }
    rendererRef.current?.setContext({
      mySeat,
      colorBySeat,
      nameBySeat,
      hatBySeat,
      settings,
      paused: room.paused,
    });
  }, [room.players, room.paused, mySeat, settings]);

  return (
    <Screen
      room={room}
      mySeat={mySeat}
      canvasRef={canvasRef}
      paperArena
      hud={<AchtungHud room={room} mySeat={mySeat} />}
      controls={
        // Always mounted, enabled by class. `attachInput` binds to this element
        // once on mount, and `useShowTouchControls` can flip to true *later* —
        // the detector latches on the first touch, precisely so an Android phone
        // in "Desktop site" mode still gets controls. Unmounting and remounting
        // the surface under a listener that never re-attaches would leave
        // steering bound to an element no longer on screen.
        <div
          className={`touchsurface${mySeat >= 0 && showTouch ? ' touchsurface--on' : ''}`}
          ref={surfaceRef}
        >
          <span className="touchsurface__hint touchsurface__hint--left">◀</span>
          <span className="touchsurface__hint touchsurface__hint--right">▶</span>
        </div>
      }
    />
  );
}

function AchtungHud({ room, mySeat }: Props): JSX.Element {
  const hud = useStore((s) => s.hud);
  const speaking = new Set(useVoice().speaking);
  const t = useT();

  const seated = room.players
    .filter((p) => p.seat >= 0)
    .map((player) => ({ player, live: hud.players.find((p) => p.seat === player.seat) }))
    .sort((a, b) => (b.live?.score ?? 0) - (a.live?.score ?? 0) || a.player.seat - b.player.seat);

  return (
    <>
      {seated.map(({ player, live }) => (
        <div
          key={player.id}
          className={`hudcard${live && !live.alive ? ' hudcard--out' : ''}${
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
          </div>
          <span className="hudcard__effects">
            {(live?.effects ?? []).map((effect) => (
              <span
                key={effect}
                className="hudcard__effect"
                title={t.achtungEffects[effect as keyof typeof t.achtungEffects] ?? effect}
              >
                <span aria-hidden="true">{EFFECT_ICONS[effect] ?? '•'}</span>
                <span className="hudcard__effectlabel">
                  {t.achtungEffects[effect as keyof typeof t.achtungEffects] ?? effect}
                </span>
              </span>
            ))}
          </span>
          <span className="hudcard__score">{live?.score ?? player.score}</span>
        </div>
      ))}
    </>
  );
}
