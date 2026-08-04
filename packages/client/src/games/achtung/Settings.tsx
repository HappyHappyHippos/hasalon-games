import type { JSX } from 'react';
import { SPEED_PRESETS, suggestedTargetScore, type AchtungConfig } from '@mg/shared/achtung';
import type { GameConfig } from '@mg/shared';
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

export function AchtungSettings({ settings, isHost, playerCount, onChange }: Props): JSX.Element | null {
  const t = useT();
  if (settings.game !== 'achtung') return null;
  const config: AchtungConfig = settings;

  return (
    <div className="settings">
      <Toggle
        label={t.setPowerups}
        checked={config.powerupsEnabled}
        disabled={!isHost}
        onChange={(powerupsEnabled) => onChange({ powerupsEnabled })}
      />
      <Toggle
        label={t.setWinByTwo}
        checked={config.winByTwo}
        disabled={!isHost}
        onChange={(winByTwo) => onChange({ winByTwo })}
      />
      <Segmented
        label={t.setSpeed}
        value={config.speedScale}
        disabled={!isHost}
        options={SPEED_PRESETS.map((value, i) => ({ value, label: t.speedLabels[i]! }))}
        onChange={(speedScale) => onChange({ speedScale })}
      />
      <NumberStepper label={t.setPlayTo} value={config.targetScore} min={1} max={200}
        disabled={!isHost} onChange={(targetScore) => onChange({ targetScore })} />
      {isHost && (
        <p className="muted small">
          {t.suggestedFor(playerCount, suggestedTargetScore(playerCount))}
        </p>
      )}
    </div>
  );
}
