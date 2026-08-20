import { useEffect, useRef, type JSX } from 'react';
import { colorFor, type RoomView } from '@mg/shared';
import { IN_LEFT, IN_RIGHT, IN_STEER_MASK, type DirtPowerup } from '@mg/shared/dirt';

/** Direction bits plus the magnitude field — everything the wheel writes. */
const WHEEL_MASK = IN_LEFT | IN_RIGHT | IN_STEER_MASK;
import { useStore } from '../../store';
import { socket } from '../../net/socket';
import { Screen } from '../../ui/Screen';
import { useShowTouchControls } from '../../ui/useTouchControls';
import { useVoice } from '../../ui/useVoice';
import { useT } from '../../strings';
import { DirtRenderer } from './Renderer';
import { attachDirtInput } from './input';
import { DirtControls } from './Controls';

interface Props {
  room: RoomView;
  mySeat: number;
}

export function DirtScreen({ room, mySeat }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<DirtRenderer | null>(null);
  const inputRef = useRef<ReturnType<typeof attachDirtInput> | null>(null);
  const showTouch = useShowTouchControls();

  // Only the two things the controls have to react to are read here, so the
  // 30 Hz snapshot stream does not re-render this tree — everything else the
  // player sees is on the canvas. See the note on `mirrorHud`.
  const me = useStore((s) => s.hud.players.find((p) => p.seat === mySeat));
  const item = (me?.item as DirtPowerup | undefined) ?? null;

  // Constructed once per mount, deliberately: the renderer owns its own
  // animation frame, and re-creating it whenever a prop changes would restart
  // the loop several times a second. Live data reaches it through `setContext`.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new DirtRenderer(canvas, {
      mySeat,
      colorBySeat: {},
      nameBySeat: {},
      paused: false,
    });
    rendererRef.current = renderer;
    renderer.start();

    inputRef.current = attachDirtInput((bits, seq) => socket.sendInput({ seq, bits }));

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
      hud={<DirtHud room={room} mySeat={mySeat} />}
      controls={
        mySeat >= 0 && showTouch ? (
          <DirtControls
            item={item}
            onButton={(bit, down) => inputRef.current?.setButton(bit, down)}
            onSteer={(bits) => inputRef.current?.setField(WHEEL_MASK, bits)}
          />
        ) : null
      }
    />
  );
}


function DirtHud({ room, mySeat }: Props): JSX.Element {
  const hud = useStore((s) => s.hud);
  const speaking = new Set(useVoice().speaking);
  const t = useT();

  // Race order, not score order. Everywhere else in the app the rail is sorted
  // by score, but a race already has a running order and it is the thing
  // players are actually tracking — showing eighth place above the leader
  // because they won the last race would be actively misleading.
  const seated = room.players
    .filter((p) => p.seat >= 0)
    .map((player) => ({ player, live: hud.players.find((p) => p.seat === player.seat) }))
    .sort(
      (a, b) =>
        (a.live?.position ?? 99) - (b.live?.position ?? 99) || a.player.seat - b.player.seat,
    );

  return (
    <>
      {seated.map(({ player, live }) => (
        <div
          key={player.id}
          className={`hudcard${live && !live.alive ? ' hudcard--out' : ''}${
            player.seat === mySeat ? ' hudcard--me' : ''
          }${speaking.has(player.id) ? ' hudcard--speaking' : ''}`}
          aria-label={`${live?.position ?? '?'}. ${player.name}: ${live?.score ?? player.score}`}
        >
          <span className="hudcard__dot" style={{ background: colorFor(player.colorIndex) }} />
          <div className="hudcard__body">
            <span className="hudcard__name">{player.name}</span>
            <span className="dirt__lap" dir="ltr">
              {live?.lap ? t.dirtLap(live.lap) : ''}
            </span>
          </div>
          {/* Position is the number that matters mid-race; points are the
              match. Both, because the first is what you are doing and the
              second is why. `dir="ltr"` because these are numerals with a
              fixed reading order — see the layout notes in CLAUDE.md. */}
          <span className="dirt__pos" dir="ltr">
            {live?.position ?? '-'}
          </span>
          <span className="hudcard__score">{live?.score ?? player.score}</span>
        </div>
      ))}
    </>
  );
}
