import type { JSX } from 'react';
import type { GameConfig } from '@mg/shared';
import type { GravityConfig, GravityPace } from '@mg/shared/gravity';
import { Segmented } from '../../ui/Segmented';
import { useT } from '../../strings';

interface Props {
  settings: GameConfig;
  isHost: boolean;
  playerCount: number;
  onChange: (patch: Record<string, unknown>) => void;
}

const PACES: GravityPace[] = ['chill', 'normal', 'fast'];

export function GravitySettings({ settings, isHost, onChange }: Props): JSX.Element | null {
  const t = useT();
  if (settings.game !== 'gravity') return null;
  const config: GravityConfig = settings;

  return (
    <div className="settings">
      <Segmented
        label={t.setPace}
        value={config.pace}
        disabled={!isHost}
        options={PACES.map((value, i) => ({ value, label: t.paceLabels[i]! }))}
        onChange={(pace) => onChange({ pace })}
      />
      <label className="setting">
        <span>{t.setRoundsToWin}</span>
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
