import { useEffect, useRef, type JSX } from 'react';
import { colorFor, type RoomView } from '@mg/shared';
import { useStore } from '../../store';
import { socket } from '../../net/socket';
import { Screen } from '../../ui/Screen';
import { useShowTouchControls } from '../../ui/useTouchControls';
import { useVoice } from '../../ui/useVoice';
import { TanksRenderer } from './Renderer';
import { attachTanksInput } from './input';
import { TanksTouchPad } from './TouchPad';

interface Props {
  room: RoomView;
  mySeat: number;
}

export function TanksScreen({ room, mySeat }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<TanksRenderer | null>(null);
  const inputRef = useRef<ReturnType<typeof attachTanksInput> | null>(null);
  const showTouch = useShowTouchControls();

  // Constructed once per mount, deliberately: the renderer owns its own
  // animation frame, and re-creating it whenever a prop changes would restart
  // the loop several times a second. Live data reaches it through `setContext`.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new TanksRenderer(canvas, {
      mySeat,
      colorBySeat: {},
      nameBySeat: {},
      paused: false,
    });
    rendererRef.current = renderer;
    renderer.start();

    inputRef.current = attachTanksInput((bits, seq) => socket.sendInput({ seq, bits }));

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

  return (
    <Screen
      room={room}
      mySeat={mySeat}
      canvasRef={canvasRef}
      hud={<TanksHud room={room} mySeat={mySeat} />}
      controls={
        mySeat >= 0 && showTouch ? (
          <TanksTouchPad mySeat={mySeat} onButton={(bit, down) => inputRef.current?.setButton(bit, down)} />
        ) : null
      }
    />
  );
}

function TanksHud({ room, mySeat }: Props): JSX.Element {
  const hud = useStore((s) => s.hud);
  const speaking = new Set(useVoice().speaking);

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
        >
          <span className="hudcard__dot" style={{ background: colorFor(player.colorIndex) }} />
          <div className="hudcard__body">
            <span className="hudcard__name">{player.name}</span>
          </div>
          <span className="hudcard__score">{live?.score ?? player.score}</span>
        </div>
      ))}
    </>
  );
}
