import type { JSX } from 'react';
import { useStore } from '../store';
import { useT } from '../strings';

/** Only speaks up when something is actually wrong. */
export function Toast(): JSX.Element | null {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const t = useT();

  if (status === 'closed') {
    return (
      <div className="toast toast--warn" role="status">
        <span className="toast__dot" />
        {t.lostConnection}
      </div>
    );
  }

  if (!error) return null;

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
