import type { JSX } from 'react';
import { LEVELS, LEVEL_IDS, type GunMayhemConfig, type LevelId } from '@mg/shared/gunmayhem';
import type { GameConfig } from '@mg/shared';
import { Segmented } from '../../ui/Segmented';
import { Toggle } from '../../ui/Toggle';

interface Props {
  settings: GameConfig;
  isHost: boolean;
  playerCount: number;
  onChange: (patch: Record<string, unknown>) => void;
}

const LEVEL_OPTIONS: Array<{ value: LevelId | 'random'; label: string }> = [
  ...LEVEL_IDS.map((id) => ({ value: id, label: LEVELS[id].name })),
  { value: 'random' as const, label: 'Random' },
];

export function GunMayhemSettings({ settings, isHost, onChange }: Props): JSX.Element | null {
  if (settings.game !== 'gunmayhem') return null;
  const config: GunMayhemConfig = settings;

  return (
    <div className="settings">
      <Segmented
        label="Stage"
        value={config.levelId}
        disabled={!isHost}
        options={LEVEL_OPTIONS}
        onChange={(levelId) => onChange({ levelId })}
      />
      <Toggle
        label="Weapon crates"
        checked={config.weaponsEnabled}
        disabled={!isHost}
        onChange={(weaponsEnabled) => onChange({ weaponsEnabled })}
      />
      <Toggle
        label="Bombs"
        checked={config.bombsEnabled}
        disabled={!isHost}
        onChange={(bombsEnabled) => onChange({ bombsEnabled })}
      />
      <Toggle
        label="Powerups"
        checked={config.powerupsEnabled}
        disabled={!isHost}
        onChange={(powerupsEnabled) => onChange({ powerupsEnabled })}
      />
      <label className="setting">
        <span>Lives each</span>
        <input
          className="input input--number"
          type="number"
          min={1}
          max={9}
          disabled={!isHost}
          value={config.stocks}
          onChange={(event) => onChange({ stocks: Number(event.target.value) })}
        />
      </label>
      <label className="setting">
        <span>Rounds to win</span>
        <input
          className="input input--number"
          type="number"
          min={1}
          max={15}
          disabled={!isHost}
          value={config.targetWins}
          onChange={(event) => onChange({ targetWins: Number(event.target.value) })}
        />
      </label>
    </div>
  );
}
