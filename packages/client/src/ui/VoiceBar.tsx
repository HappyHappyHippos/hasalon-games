import type { JSX } from 'react';
import { useStore } from '../store';
import { useT } from '../strings';
import { voice } from '../net/voice';
import { useVoice } from './useVoice';
import { sfx } from '../audio';

interface Props {
  /** Compact form for the in-match HUD; the lobby gets the full thing. */
  compact?: boolean;
}

/**
 * The microphone control, and the only place voice failures are reported.
 *
 * That second job is the important one. On STUN alone a peer behind carrier-grade
 * NAT — the norm on Israeli mobile — simply never connects, and the failure is
 * *silent*: everyone else sounds fine and one person is inexplicably missing. So
 * the count of failed peers is on screen rather than in a console nobody opens.
 */
export function VoiceBar({ compact = false }: Props): JSX.Element | null {
  const room = useStore((s) => s.room);
  const playerId = useStore((s) => s.playerId);
  const t = useT();
  const state = useVoice();

  if (!room || !playerId) return null;

  const failed = Object.values(state.peers).filter((s) => s === 'failed').length;
  const connecting = Object.values(state.peers).filter((s) => s === 'connecting').length;

  const toggle = (): void => {
    sfx.click();
    if (!state.active) void voice.start(playerId);
    else voice.setMuted(!state.muted);
  };

  const label = !state.active ? t.voiceJoin : state.muted ? t.voiceUnmute : t.voiceMute;
  const icon = !state.active ? '🎙' : state.muted ? '🔇' : '🎤';

  return (
    <div className={`voicebar${compact ? ' voicebar--compact' : ''}`}>
      <button
        type="button"
        className={`voicebtn${state.active && !state.muted ? ' voicebtn--live' : ''}`}
        onClick={toggle}
        aria-pressed={state.active && !state.muted}
        title={label}
      >
        <span aria-hidden="true">{icon}</span>
        {!compact && <span>{label}</span>}
      </button>

      {state.active && !compact && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            sfx.click();
            voice.stop();
          }}
        >
          {t.voiceLeave}
        </button>
      )}

      {!compact && <VoiceNote error={state.error} failed={failed} connecting={connecting} />}
    </div>
  );
}

function VoiceNote({
  error,
  failed,
  connecting,
}: {
  error: ReturnType<typeof useVoice>['error'];
  failed: number;
  connecting: number;
}): JSX.Element | null {
  const t = useT();

  if (error === 'denied') return <p className="muted small">{t.voiceDenied}</p>;
  if (error === 'nodevice') return <p className="muted small">{t.voiceNoDevice}</p>;
  if (error === 'unsupported') return <p className="muted small">{t.voiceUnsupported}</p>;
  if (failed > 0) return <p className="muted small">{t.voiceFailed(failed)}</p>;
  if (connecting > 0) return <p className="muted small">{t.voiceConnecting}</p>;
  return null;
}
