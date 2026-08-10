import { useEffect, type JSX } from 'react';
import type { GameConfig } from '@mg/shared';
import type { SkribblConfig } from '@mg/shared/skribbl';
import { Segmented } from '../../ui/Segmented';
import { NumberStepper } from '../../ui/NumberStepper';
import { useStore } from '../../store';
import { useT } from '../../strings';

interface Props {
  settings: GameConfig;
  isHost: boolean;
  playerCount: number;
  onChange: (patch: Record<string, unknown>) => void;
}

export function SkribblSettings({ settings, isHost, onChange }: Props): JSX.Element | null {
  const uiLang = useStore((s) => s.lang);
  const t = useT();

  const config = settings.game === 'skribbl' ? settings : null;
  const wordLang = config?.lang;

  useEffect(() => {
    if (!isHost || !wordLang) return;
    if (wordLang !== uiLang) onChange({ lang: uiLang });
    // Only on mount and on a language change, never in response to our own patch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiLang, isHost]);

  if (!config) return null;

  return (
    <div className="settings">
      <Segmented
        label={t.skribblWordLanguage}
        value={config.lang}
        disabled={!isHost}
        options={[
          { value: 'he' as const, label: t.langHebrew },
          { value: 'en' as const, label: t.langEnglish },
        ]}
        onChange={(lang) => onChange({ lang })}
      />
      <NumberStepper
        label={t.skribblDrawTime}
        value={config.drawSeconds}
        min={20}
        max={180}
        step={10}
        disabled={!isHost}
        onChange={(drawSeconds) => onChange({ drawSeconds })}
      />
      <NumberStepper
        label={t.skribblRounds}
        value={config.rounds}
        min={1}
        max={10}
        disabled={!isHost}
        onChange={(rounds) => onChange({ rounds })}
      />
    </div>
  );
}

export type { SkribblConfig };
