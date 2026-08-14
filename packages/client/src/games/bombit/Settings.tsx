import type { JSX } from 'react';
import type { GameConfig } from '@mg/shared';
import type { BlockDensity, BombitConfig } from '@mg/shared/bombit';
import { NumberStepper } from '../../ui/NumberStepper';
import { Segmented } from '../../ui/Segmented';
import { Toggle } from '../../ui/Toggle';
import { useT } from '../../strings';
import { BombitMapCarousel } from './MapCarousel';

interface Props {
  settings: GameConfig;
  isHost: boolean;
  playerCount: number;
  onChange: (patch: Record<string, unknown>) => void;
}

const DENSITIES: BlockDensity[] = ['sparse', 'normal', 'packed'];

export function BombitSettings({ settings, isHost, onChange }: Props): JSX.Element | null {
  const t = useT();
  if (settings.game !== 'bombit') return null;
  const config: BombitConfig = settings;

  return (
    <div className="settings">
      <BombitMapCarousel
        value={config.mapId}
        disabled={!isHost}
        onChange={(mapId) => onChange({ mapId })}
      />
      <Segmented
        label={t.setBlocks}
        value={config.density}
        options={DENSITIES.map((density, index) => ({
          value: density,
          label: t.blockDensityLabels[index] ?? density,
        }))}
        disabled={!isHost}
        onChange={(density) => onChange({ density })}
      />
      <NumberStepper
        label={t.setRoundsToWin}
        value={config.targetWins}
        min={1}
        max={15}
        disabled={!isHost}
        onChange={(targetWins) => onChange({ targetWins })}
      />
      <NumberStepper
        label={t.setRoundSeconds}
        value={config.roundSeconds}
        min={30}
        max={180}
        step={10}
        disabled={!isHost}
        onChange={(roundSeconds) => onChange({ roundSeconds })}
      />
      <Toggle
        label={t.setPowerups}
        checked={config.powerupsEnabled}
        disabled={!isHost}
        onChange={(powerupsEnabled) => onChange({ powerupsEnabled })}
      />
    </div>
  );
}
