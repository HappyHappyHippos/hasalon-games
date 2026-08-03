import type { JSX } from 'react';
import type { GameConfig } from '@mg/shared';
import { ROUNDS_PRESETS, VOTE_SECONDS_PRESETS, WRITE_SECONDS_PRESETS } from '@mg/shared/memes';
import { useT } from '../../strings';
import { Segmented } from '../../ui/Segmented';
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
      <Segmented label={t.memesWriteTime} value={config.writeSeconds} disabled={!isHost}
        options={WRITE_SECONDS_PRESETS.map((value) => ({ value, label: t.memesSeconds(value) }))}
        onChange={(writeSeconds) => onChange({ writeSeconds })} />
      <Segmented label={t.memesVoteTime} value={config.voteSeconds} disabled={!isHost}
        options={VOTE_SECONDS_PRESETS.map((value) => ({ value, label: t.memesSeconds(value) }))}
        onChange={(voteSeconds) => onChange({ voteSeconds })} />
      <Segmented label={t.memesRounds} value={config.rounds} disabled={!isHost}
        options={ROUNDS_PRESETS.map((value) => ({ value, label: String(value) }))}
        onChange={(rounds) => onChange({ rounds })} />
      <Toggle label={t.memesNudges} checked={config.nudges} disabled={!isHost}
        onChange={(nudges) => onChange({ nudges })} />
      <p className="muted small">{t.memesNudgesHelp}</p>
    </div>
  );
}
