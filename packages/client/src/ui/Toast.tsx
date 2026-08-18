import { useEffect, useState, type JSX } from 'react';
import { useStore } from '../store';
import { useT } from '../strings';

/** Only speaks up when something is actually wrong. */
export function Toast(): JSX.Element | null {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const readyNudge = useStore((s) => s.readyNudge);
  const room = useStore((s) => s.room);
  const playerId = useStore((s) => s.playerId);
  const t = useT();
  const [nudgeVisible, setNudgeVisible] = useState(false);

  useEffect(() => {
    if (!readyNudge) return;
    setNudgeVisible(true);
    const timer = window.setTimeout(() => setNudgeVisible(false), 3_500);
    return () => window.clearTimeout(timer);
  }, [readyNudge]);

  if (status === 'closed') {
    return (
      <div className="toast toast--warn" role="status">
        <span className="toast__dot" />
        {t.lostConnection}
      </div>
    );
  }

  if (!error) {
    const me = room?.players.find((player) => player.id === playerId);
    const sender = room?.players.find((player) => player.id === readyNudge?.from);
    if (!nudgeVisible || !readyNudge || !me || me.ready || readyNudge.from === playerId) return null;
    return (
      <div className="toast toast--ready" role="alert">
        {t.readyNudgeMessage(sender?.name ?? '')}
      </div>
    );
  }

  return (
    <div className="toast toast--error" role="alert">
      {t.errors[error]}
      <button
        type="button"
        className="toast__close"
        onClick={() => setError(null)}
        aria-label={t.dismiss}
      >
        ×
      </button>
    </div>
  );
}
