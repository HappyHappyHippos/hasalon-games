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
  const connecting = Object.values(state.peers).filter(
    (s) => s === 'connecting' || s === 'recovering',
  ).length;

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
            voice.stopMic();
          }}
        >
          {t.voiceLeave}
        </button>
      )}

      {!state.active && !compact && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            sfx.click();
            voice.setDeaf(!state.deaf);
          }}
        >
          {state.deaf ? t.voiceUndeafen : t.voiceDeafen}
        </button>
      )}

      {!compact && (
        <VoiceNote
          error={state.error}
          failed={failed}
          connecting={connecting}
          listening={state.listening}
          active={state.active}
          relay={state.relay}
          playbackBlocked={state.playbackBlocked}
        />
      )}
      {!compact && failed > 0 && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => voice.retryFailed()}>
          {t.voiceRetry}
        </button>
      )}
    </div>
  );
}

function VoiceNote({
  error,
  failed,
  connecting,
  listening,
  active,
  relay,
  playbackBlocked,
}: {
  error: ReturnType<typeof useVoice>['error'];
  failed: number;
  connecting: number;
  listening: boolean;
  active: boolean;
  relay: ReturnType<typeof useVoice>['relay'];
  playbackBlocked: boolean;
}): JSX.Element | null {
  const t = useT();

  let note: string | null = null;
  if (error === 'denied') note = t.voiceDenied;
  else if (error === 'nodevice') note = t.voiceNoDevice;
  else if (error === 'unsupported') note = t.voiceUnsupported;
  else if (failed > 0) note = t.voiceFailed(failed);
  else if (connecting > 0) note = t.voiceConnecting;
  else if (playbackBlocked) note = t.voiceTapToHear;
  else if (relay === 'stun-only') note = t.voiceRelayUnavailable;
  else if (listening && !active) note = t.voiceListening;

  const iosNote = (listening || active) && isIOS() ? t.voiceIosNote : null;
  if (!note && !iosNote) return null;
  return (
    <>
      {note && <p className="muted small">{note}</p>}
      {iosNote && <p className="muted small">{iosNote}</p>}
    </>
  );
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
