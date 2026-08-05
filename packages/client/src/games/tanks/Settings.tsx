import type { JSX } from 'react';
import type { GameConfig } from '@mg/shared';
import type { ArenaSize, TanksConfig } from '@mg/shared/tanks';
import { Segmented } from '../../ui/Segmented';
import { Toggle } from '../../ui/Toggle';
import { NumberStepper } from '../../ui/NumberStepper';
import { useT } from '../../strings';

interface Props {
  settings: GameConfig;
  isHost: boolean;
  playerCount: number;
  onChange: (patch: Record<string, unknown>) => void;
}

const SIZES: ArenaSize[] = ['small', 'normal', 'large'];

export function TanksSettings({ settings, isHost, onChange }: Props): JSX.Element | null {
  const t = useT();
  if (settings.game !== 'tanks') return null;
  const config: TanksConfig = settings;

  return (
    <div className="settings">
      <Segmented
        label={t.setArenaSize}
        value={config.arenaSize}
        disabled={!isHost}
        options={SIZES.map((value, i) => ({ value, label: t.arenaSizeLabels[i]! }))}
        onChange={(arenaSize) => onChange({ arenaSize })}
      />
      <Toggle
        label={t.setPowerups}
        checked={config.powerupsEnabled}
        disabled={!isHost}
        onChange={(powerupsEnabled) => onChange({ powerupsEnabled })}
      />
      <NumberStepper label={t.setRoundsToWin} value={config.targetWins} min={1} max={15}
        disabled={!isHost} onChange={(targetWins) => onChange({ targetWins })} />
      <NumberStepper label={t.setRoundSeconds} value={config.roundSeconds} min={30} max={180}
        step={10} disabled={!isHost} onChange={(roundSeconds) => onChange({ roundSeconds })} />
    </div>
  );
}
