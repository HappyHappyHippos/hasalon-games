import { useState, type JSX } from 'react';
import { useT } from '../strings';
import { isStandalone } from './useFullscreen';
import { Button } from './Button';

const STORAGE_KEY = 'mg.installPromptDismissed';

/**
 * `beforeinstallprompt` never fires on iOS Safari — there is no native
 * install prompt there at all, only the Share sheet's own "Add to Home
 * Screen" entry, which no page can trigger. This is the substitute: a
 * full-screen, unmissable overlay on first visit that walks a new iPhone
 * player through the manual steps, since a small text hint under the
 * maximize button (`FullscreenButton`'s `fullscreenInstallHint`) turned out to
 * be too easy to miss entirely for someone who never taps that button.
 *
 * Shown once ever, not once per session — a returning player who dismissed it
 * should never see it again. `isStandalone()` also stops it outright for
 * anyone who already followed the instructions.
 */
function shouldOffer(): boolean {
  if (typeof window === 'undefined') return false;
  if (isStandalone()) return false;
  if (!isIOS()) return false;
  try {
    if (window.localStorage.getItem(STORAGE_KEY)) return false;
  } catch {
    // Storage blocked (private mode, etc). Offer it rather than loop forever.
  }
  return true;
}

/**
 * Best-effort iOS detection — see the twin of this in `OptionsMenu.tsx` for
 * why `navigator.platform` is still needed for iPadOS.
 */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export function InstallPrompt(): JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  const t = useT();

  if (dismissed || !shouldOffer()) return null;

  const dismiss = (): void => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Nothing to persist to; it'll just offer again next visit.
    }
    setDismissed(true);
  };

  return (
    <div className="overlay overlay--solid installprompt" role="dialog" aria-modal="true">
      <div className="sticker overlay__card installprompt__card">
        <p className="installprompt__icon" aria-hidden="true">
          ⎋
        </p>
        <h2 className="overlay__title">{t.installTitle}</h2>
        <p className="installprompt__body">{t.installBody}</p>
        <Button variant="primary" size="lg" full onClick={dismiss}>
          {t.installDismiss}
        </Button>
      </div>
    </div>
  );
}
