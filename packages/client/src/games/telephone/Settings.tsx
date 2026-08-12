import type { JSX } from 'react';
import type { GameConfig } from '@mg/shared';
import { MAX_DRAW_SECONDS, MAX_VOTE_SECONDS, MAX_WRITE_SECONDS, MIN_DRAW_SECONDS, MIN_VOTE_SECONDS, MIN_WRITE_SECONDS } from '@mg/shared/telephone';
import { NumberStepper } from '../../ui/NumberStepper';
import { useT } from '../../strings';

interface Props {
  settings: GameConfig;
  isHost: boolean;
  playerCount: number;
  onChange: (patch: Record<string, unknown>) => void;
}

export function TelephoneSettings({ settings, isHost, onChange }: Props): JSX.Element | null {
  const t = useT();
  if (settings.game !== 'telephone') return null;
  return (
    <div className="settings">
      <NumberStepper label={t.telephoneWriteTime} value={settings.writeSeconds} min={MIN_WRITE_SECONDS} max={MAX_WRITE_SECONDS} step={5} disabled={!isHost} onChange={(writeSeconds) => onChange({ writeSeconds })} />
      <NumberStepper label={t.telephoneDrawTime} value={settings.drawSeconds} min={MIN_DRAW_SECONDS} max={MAX_DRAW_SECONDS} step={10} disabled={!isHost} onChange={(drawSeconds) => onChange({ drawSeconds })} />
      <NumberStepper label={t.telephoneVoteTime} value={settings.voteSeconds} min={MIN_VOTE_SECONDS} max={MAX_VOTE_SECONDS} disabled={!isHost} onChange={(voteSeconds) => onChange({ voteSeconds })} />
    </div>
  );
}
