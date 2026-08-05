import { useEffect, useState, type JSX } from 'react';
import { useT } from '../strings';
import {
  fullscreenNeedsInstall,
  isStandalone,
  useIsFullscreen,
  useToggleFullscreen,
} from './useFullscreen';

/**
 * The maximize button.
 *
 * On Android this is an ordinary fullscreen toggle. On iPhone there is no
 * fullscreen API for a normal tab at all, so the button's job changes: it says
 * how to get one — the home-screen shortcut, which opens standalone with no URL
 * bar because of the manifest. Saying that out loud beats a button that quietly
 * does nothing, and it is hidden entirely once you are already standalone.
 */
export function FullscreenButton(): JSX.Element | null {
  const [hint, setHint] = useState(false);
  const fullscreen = useIsFullscreen();
  const toggleFullscreen = useToggleFullscreen();
  const t = useT();

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(false), 6000);
    return () => window.clearTimeout(timer);
  }, [hint]);

  if (isStandalone()) return null;

  const needsInstall = fullscreenNeedsInstall();

  return (
    <div className="fullscreenbtn__wrap">
      {hint && <p className="fullscreenbtn__hint">{t.fullscreenInstallHint}</p>}
      <button
        type="button"
        className="fullscreenbtn"
        onClick={() => (needsInstall ? setHint((on) => !on) : toggleFullscreen())}
        aria-label={fullscreen ? t.exitFullscreen : t.enterFullscreen}
        title={fullscreen ? t.exitFullscreen : t.enterFullscreen}
      >
        {fullscreen ? '⤡' : '⛶'}
      </button>
    </div>
  );
}
