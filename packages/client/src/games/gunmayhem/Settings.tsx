import type { JSX } from 'react';
import type { GunMayhemConfig } from '@mg/shared/gunmayhem';
import type { GameConfig } from '@mg/shared';
import { Toggle } from '../../ui/Toggle';
import { NumberStepper } from '../../ui/NumberStepper';
import { useT } from '../../strings';
import { StageCarousel } from './StageCarousel';

interface Props {
  settings: GameConfig;
  isHost: boolean;
  playerCount: number;
  onChange: (patch: Record<string, unknown>) => void;
}

export function GunMayhemSettings({ settings, isHost, onChange }: Props): JSX.Element | null {
  const t = useT();
  if (settings.game !== 'gunmayhem') return null;
  const config: GunMayhemConfig = settings;

  return (
    <div className="settings">
      <StageCarousel
        value={config.levelId}
        disabled={!isHost}
        onChange={(levelId) => onChange({ levelId })}
      />
      <Toggle
        label={t.setWeaponCrates}
        checked={config.weaponsEnabled}
        disabled={!isHost}
        onChange={(weaponsEnabled) => onChange({ weaponsEnabled })}
      />
      <Toggle
        label={t.setBombs}
        checked={config.bombsEnabled}
        disabled={!isHost}
        onChange={(bombsEnabled) => onChange({ bombsEnabled })}
      />
      <Toggle
        label={t.setPowerups}
        checked={config.powerupsEnabled}
        disabled={!isHost}
        onChange={(powerupsEnabled) => onChange({ powerupsEnabled })}
      />
      <NumberStepper label={t.setLivesEach} value={config.stocks} min={1} max={9}
        disabled={!isHost} onChange={(stocks) => onChange({ stocks })} />
      <NumberStepper label={t.setRoundsToWin} value={config.targetWins} min={1} max={15}
        disabled={!isHost} onChange={(targetWins) => onChange({ targetWins })} />
    </div>
  );
}
