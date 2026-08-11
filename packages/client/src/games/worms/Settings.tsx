import type { JSX } from 'react';
import type { GameConfig } from '@mg/shared';
import { WORMS_STAGE_IDS, type WormsConfig, type WormsStageId } from '@mg/shared/worms';
import { NumberStepper } from '../../ui/NumberStepper';
import { Toggle } from '../../ui/Toggle';
import { useT } from '../../strings';

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

  const options: Array<WormsStageId | 'random'> = ['random', ...WORMS_STAGE_IDS];

  return (
    <div className="settings">
      <div className="worms__stagepick">
        <span className="worms__stagepick-label">{t.wormsStage}</span>
        <div className="worms__stagepick-row">
          {options.map((id) => (
            <button
              key={id}
              type="button"
              disabled={!isHost}
              className={`worms__stagechip${config.stageId === id ? ' worms__stagechip--on' : ''}`}
              onClick={() => onChange({ stageId: id })}
            >
              {id === 'random' ? t.wormsStageRandom : t.wormsStageNames[id]}
            </button>
          ))}
        </div>
      </div>

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
      <Toggle
        label={t.setWind}
        checked={config.windEnabled}
        disabled={!isHost}
        onChange={(windEnabled) => onChange({ windEnabled })}
      />
      <Toggle
        label={t.setExtraWeapons}
        checked={config.extrasEnabled}
        disabled={!isHost}
        onChange={(extrasEnabled) => onChange({ extrasEnabled })}
      />
    </div>
  );
}
