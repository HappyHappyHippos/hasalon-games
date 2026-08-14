import { useEffect, useRef, type JSX } from 'react';
import { colorFor, type RoomView } from '@mg/shared';
import { useStore } from '../../store';
import { socket } from '../../net/socket';
import { Screen } from '../../ui/Screen';
import { useShowTouchControls } from '../../ui/useTouchControls';
import { useVoice } from '../../ui/useVoice';
import { useT } from '../../strings';
import { BombitRenderer } from './Renderer';
import { attachBombitInput } from './input';
import { BombitTouchPad } from './TouchPad';

interface Props {
  room: RoomView;
  mySeat: number;
}

export function BombitScreen({ room, mySeat }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BombitRenderer | null>(null);
  const inputRef = useRef<ReturnType<typeof attachBombitInput> | null>(null);
  const showTouch = useShowTouchControls();

  // Constructed once per mount, deliberately: the renderer owns its own
  // animation frame, and re-creating it whenever a prop changes would restart
  // the loop several times a second. Live data reaches it through `setContext`.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new BombitRenderer(canvas, {
      mySeat,
      colorBySeat: {},
      nameBySeat: {},
      hatBySeat: {},
      faceBySeat: {},
      paused: false,
    });
    rendererRef.current = renderer;
    renderer.start();

    inputRef.current = attachBombitInput((bits, seq) => socket.sendInput({ seq, bits }));

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

  return (
    <Screen
      room={room}
      mySeat={mySeat}
      canvasRef={canvasRef}
      hud={<BombitHud room={room} mySeat={mySeat} />}
      controls={
        mySeat >= 0 && showTouch ? (
          <BombitTouchPad onButton={(bit, down) => inputRef.current?.setButton(bit, down)} />
        ) : null
      }
    />
  );
}

function BombitHud({ room, mySeat }: Props): JSX.Element {
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
            <span className="bombit__kit" aria-label={t.bombitKit(live?.bombs ?? 0, live?.range ?? 0)}>
              <span className="bombit__kit-item">💣{live?.bombs ?? 0}</span>
              <span className="bombit__kit-item">↔{live?.range ?? 0}</span>
              {(live?.shields ?? 0) > 0 && <span className="bombit__kit-item">🛡{live!.shields}</span>}
            </span>
          </div>
          {live?.effects && live.effects.length > 0 && (
            <div className="hudcard__right">
              <span className="hudcard__effects">
                {live.effects.map((effect) => (
                  <span key={effect} className="bombit__effect" title={t.bombitEffects[effect as 'slow' | 'reverse']}>
                    {effect === 'reverse' ? '⇄' : '≈'}
                  </span>
                ))}
              </span>
            </div>
          )}
          <span className="hudcard__score">{live?.score ?? player.score}</span>
        </div>
      ))}
    </>
  );
}
