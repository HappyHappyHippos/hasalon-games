import type { JSX } from 'react';
import { SPEED_PRESETS, suggestedTargetScore, type AchtungConfig } from '@mg/shared/achtung';
import type { GameConfig } from '@mg/shared';
import { Segmented } from '../../ui/Segmented';
import { Toggle } from '../../ui/Toggle';

interface Props {
  settings: GameConfig;
  isHost: boolean;
  playerCount: number;
  onChange: (patch: Record<string, unknown>) => void;
}

const SPEED_LABELS = ['Relaxed', 'Normal', 'Fast'];

export function AchtungSettings({ settings, isHost, playerCount, onChange }: Props): JSX.Element | null {
  if (settings.game !== 'achtung') return null;
  const config: AchtungConfig = settings;

  return (
    <div className="settings">
      <Toggle
        label="Powerups"
        checked={config.powerupsEnabled}
        disabled={!isHost}
        onChange={(powerupsEnabled) => onChange({ powerupsEnabled })}
      />
      <Toggle
        label="Win by two"
        checked={config.winByTwo}
        disabled={!isHost}
        onChange={(winByTwo) => onChange({ winByTwo })}
      />
      <Segmented
        label="Speed"
        value={config.speedScale}
        disabled={!isHost}
        options={SPEED_PRESETS.map((value, i) => ({ value, label: SPEED_LABELS[i]! }))}
        onChange={(speedScale) => onChange({ speedScale })}
      />
      <label className="setting">
        <span>Play to</span>
        <input
          className="input input--number"
          type="number"
          min={1}
          max={200}
          disabled={!isHost}
          value={config.targetScore}
          onChange={(event) => onChange({ targetScore: Number(event.target.value) })}
        />
      </label>
      {isHost && (
        <p className="muted small">
          Suggested for {playerCount} {playerCount === 1 ? 'player' : 'players'}:{' '}
          {suggestedTargetScore(playerCount)}
        </p>
      )}
    </div>
  );
}
