import type { JSX } from 'react';
import type { GameConfig } from '@mg/shared';
import type { DirtConfig } from '@mg/shared/dirt';
import { NumberStepper } from '../../ui/NumberStepper';
import { Toggle } from '../../ui/Toggle';
import { useT } from '../../strings';
import { DirtTrackCarousel } from './TrackCarousel';

interface Props {
  settings: GameConfig;
  isHost: boolean;
  playerCount: number;
  onChange: (patch: Record<string, unknown>) => void;
}

export function DirtSettings({ settings, isHost, onChange }: Props): JSX.Element | null {
  const t = useT();
  if (settings.game !== 'dirt') return null;
  const config: DirtConfig = settings;

  return (
    <div className="settings">
      <DirtTrackCarousel
        value={config.trackId}
        disabled={!isHost}
        onChange={(trackId) => onChange({ trackId })}
      />
      <NumberStepper
        label={t.dirtLaps}
        value={config.laps}
        min={1}
        max={7}
        disabled={!isHost}
        onChange={(laps) => onChange({ laps })}
      />
      <NumberStepper
        label={t.dirtRaces}
        value={config.races}
        min={1}
        max={7}
        disabled={!isHost}
        onChange={(races) => onChange({ races })}
      />
      <Toggle
        label={t.dirtPowerups}
        checked={config.powerupsEnabled}
        disabled={!isHost}
        onChange={(powerupsEnabled) => onChange({ powerupsEnabled })}
      />
    </div>
  );
}
