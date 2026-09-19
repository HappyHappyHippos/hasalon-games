import type { JSX } from 'react';
import { selectMySeat, useStore } from '../store';
import { useT } from '../strings';
import { socket } from '../net/socket';
import { sfx } from '../audio';
import { PauseIcon, PlayIcon } from './Icons';

/**
 * The fast path to pausing, sitting in the same top corner as the maximize
 * and settings buttons instead of one submenu deep inside the options panel.
 * Pause is already global server-side (`Room.setPaused` freezes the tick for
 * everyone, and any seated player may toggle it) — this is purely exposing
 * that faster. The options menu keeps its own pause control too; this is
 * additive, not a replacement.
 */
export function PauseButton(): JSX.Element | null {
  const room = useStore((s) => s.room);
  const mySeat = useStore(selectMySeat);
  const setOptionsOpen = useStore((s) => s.setOptionsOpen);
  const t = useT();

  if (!room || room.phase !== 'playing' || mySeat < 0) return null;

  return (
    <button
      type="button"
      className="pausebtn"
      aria-label={room.paused ? t.resume : t.pauseForEveryone}
      title={room.paused ? t.resume : t.pauseForEveryone}
      onClick={() => {
        sfx.click();
        // Live state, not this render's. The icon is allowed to be a round trip
        // behind; what it *does* is not, or a second tap during that round trip
        // re-sends the state the room is already in and the button looks dead.
        const pause = !useStore.getState().room?.paused;
        socket.setPaused(pause);
        // Only on the way *in*. Pausing opens the menu because a pause is
        // almost always somebody leaving the game to do something, and the menu
        // is where that something lives. Resuming is the opposite intent, and
        // opening the menu on top of the arena they just asked to play was one
        // more thing to dismiss — with the added trap that dismissing it sends
        // a second resume for a room already running.
        if (pause) setOptionsOpen(true);
      }}
    >
      {room.paused ? <PlayIcon /> : <PauseIcon />}
    </button>
  );
}
