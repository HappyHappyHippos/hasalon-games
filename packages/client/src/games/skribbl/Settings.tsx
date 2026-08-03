import { useEffect, type JSX } from 'react';
import type { GameConfig } from '@mg/shared';
import { DRAW_SECONDS_PRESETS, ROUNDS_PRESETS, type SkribblConfig } from '@mg/shared/skribbl';
import { Segmented } from '../../ui/Segmented';
import { Toggle } from '../../ui/Toggle';
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

  /**
   * Follow the host's interface language, once.
   *
   * The word list is a property of the room and the server has no idea what
   * language anyone is reading the site in, so it has to be told. A host who
   * has the site in Hebrew almost always wants Hebrew words, and making them
   * find a second setting to say so is a papercut on the very first round. They
   * can still change it — this only fires when the two disagree, which after
   * the first render they no longer do.
   */
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
      <Segmented
        label={t.skribblDrawTime}
        value={config.drawSeconds}
        disabled={!isHost}
        options={DRAW_SECONDS_PRESETS.map((value) => ({
          value,
          label: t.skribblSeconds(value),
        }))}
        onChange={(drawSeconds) => onChange({ drawSeconds })}
      />
      <Segmented
        label={t.skribblRounds}
        value={config.rounds}
        disabled={!isHost}
        options={ROUNDS_PRESETS.map((value) => ({ value, label: String(value) }))}
        onChange={(rounds) => onChange({ rounds })}
      />
      <Toggle
        label={t.skribblHints}
        checked={config.hints}
        disabled={!isHost}
        onChange={(hints) => onChange({ hints })}
      />
      <p className="muted small">{t.skribblHintsHelp}</p>
    </div>
  );
}

export type { SkribblConfig };
