import type { JSX } from 'react';
import type { GameConfig } from '@mg/shared';
import { MIN_ROUNDS, MAX_ROUNDS, MIN_WRITE_SECONDS, MAX_WRITE_SECONDS } from '@mg/shared/memes';
import { useT } from '../../strings';
import { NumberStepper } from '../../ui/NumberStepper';
import { Toggle } from '../../ui/Toggle';

interface Props {
  settings: GameConfig;
  isHost: boolean;
  playerCount: number;
  onChange: (patch: Record<string, unknown>) => void;
}

export function MemesSettings({ settings, isHost, onChange }: Props): JSX.Element | null {
  const t = useT();
  const config = settings.game === 'memes' ? settings : null;
  if (!config) return null;
  return (
    <div className="settings">
      <NumberStepper label={t.memesWriteTime} value={config.writeSeconds} min={MIN_WRITE_SECONDS} max={MAX_WRITE_SECONDS}
        step={10} disabled={!isHost} onChange={(writeSeconds) => onChange({ writeSeconds })} />
      <NumberStepper label={t.memesRounds} value={config.rounds} min={MIN_ROUNDS} max={MAX_ROUNDS}
        disabled={!isHost} onChange={(rounds) => onChange({ rounds })} />
      <Toggle label={t.memesNudges} checked={config.nudges} disabled={!isHost}
        onChange={(nudges) => onChange({ nudges })} />
      <p className="muted small">{t.memesNudgesHelp}</p>
    </div>
  );
}
