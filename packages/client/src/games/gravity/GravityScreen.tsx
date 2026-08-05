import { useEffect, useRef, type JSX } from 'react';
import { colorFor, type RoomView } from '@mg/shared';
import { useStore } from '../../store';
import { socket } from '../../net/socket';
import { Screen } from '../../ui/Screen';
import { useShowTouchControls } from '../../ui/useTouchControls';
import { useVoice } from '../../ui/useVoice';
import { GravityRenderer } from './Renderer';
import { attachGravityInput } from './input';
import { GravityTapControl } from './TapControl';

interface Props {
  room: RoomView;
  mySeat: number;
}

export function GravityScreen({ room, mySeat }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GravityRenderer | null>(null);
  const inputRef = useRef<ReturnType<typeof attachGravityInput> | null>(null);
  const showTouch = useShowTouchControls();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new GravityRenderer(canvas, {
      mySeat,
      colorBySeat: {},
      nameBySeat: {},
      hatBySeat: {},
      faceBySeat: {},
      paused: false,
    });
    rendererRef.current = renderer;
    renderer.start();

    inputRef.current = attachGravityInput((bits, seq) => socket.sendInput({ seq, bits }));

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
    rendererRef.current?.setContext({ mySeat, colorBySeat, nameBySeat, hatBySeat, faceBySeat, paused: room.paused });
  }, [room.players, room.paused, mySeat]);

  return (
    <Screen
      room={room}
      mySeat={mySeat}
      canvasRef={canvasRef}
      hud={<GravityHud room={room} mySeat={mySeat} />}
      controls={
        mySeat >= 0 && showTouch ? (
          <GravityTapControl onButton={(bit, down) => inputRef.current?.setButton(bit, down)} />
        ) : null
      }
    />
  );
}

function GravityHud({ room, mySeat }: Props): JSX.Element {
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
