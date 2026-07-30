import type { JSX } from 'react';
import { useStore } from '../store';

/** Only speaks up when something is actually wrong. */
export function Toast(): JSX.Element | null {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);

  if (status === 'closed') {
    return (
      <div className="toast toast--warn" role="status">
        <span className="toast__dot" />
        Lost the connection — trying again…
      </div>
    );
  }

  if (!error) return null;

  return (
    <div className="toast toast--error" role="alert">
      {error}
      <button type="button" className="toast__close" onClick={() => setError(null)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
