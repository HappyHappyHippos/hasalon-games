import type { JSX } from 'react';
import type { GameConfig } from '@mg/shared';
import type { TanksConfig } from '@mg/shared/tanks';
import { NumberStepper } from '../../ui/NumberStepper';
import { TankStageCarousel } from './TankStageCarousel';
import { useT } from '../../strings';

interface Props {
  settings: GameConfig;
  isHost: boolean;
  playerCount: number;
  onChange: (patch: Record<string, unknown>) => void;
}

export function TanksSettings({ settings, isHost, onChange }: Props): JSX.Element | null {
  const t = useT();
  if (settings.game !== 'tanks') return null;
  const config: TanksConfig = settings;

  return (
    <div className="settings">
      <TankStageCarousel
        value={config.stageId ?? 'random'}
        disabled={!isHost}
        onChange={(stageId) => onChange({ stageId })}
      />
      <NumberStepper label={t.setRoundsToWin} value={config.targetWins} min={1} max={15}
        disabled={!isHost} onChange={(targetWins) => onChange({ targetWins })} />
      <NumberStepper label={t.setRoundSeconds} value={config.roundSeconds} min={30} max={180}
        step={10} disabled={!isHost} onChange={(roundSeconds) => onChange({ roundSeconds })} />
    </div>
  );
}
