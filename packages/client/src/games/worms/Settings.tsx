import type { JSX } from 'react';
import type { GameConfig } from '@mg/shared';
import type { WormsConfig } from '@mg/shared/worms';
import { NumberStepper } from '../../ui/NumberStepper';
import { useT } from '../../strings';
import { StageCarousel } from './StageCarousel';

interface Props {
  settings: GameConfig;
  isHost: boolean;
  playerCount: number;
  onChange: (patch: Record<string, unknown>) => void;
}

export function WormsSettings({ settings, isHost, onChange }: Props): JSX.Element | null {
  const t = useT();
  if (settings.game !== 'worms') return null;
  const config: WormsConfig = settings;

  return (
    <div className="settings">
      <StageCarousel
        value={config.stageId ?? 'random'}
        disabled={!isHost}
        onChange={(stageId) => onChange({ stageId })}
      />

      <NumberStepper
        label={t.setRoundsToWin}
        value={config.targetWins}
        min={1}
        max={5}
        disabled={!isHost}
        onChange={(targetWins) => onChange({ targetWins })}
      />
      <NumberStepper
        label={t.setTurnSeconds}
        value={config.turnSeconds}
        min={15}
        max={60}
        step={5}
        disabled={!isHost}
        onChange={(turnSeconds) => onChange({ turnSeconds })}
      />
      <NumberStepper
        label={t.setHealth}
        value={config.hp}
        min={50}
        max={200}
        step={25}
        disabled={!isHost}
        onChange={(hp) => onChange({ hp })}
      />
    </div>
  );
}

