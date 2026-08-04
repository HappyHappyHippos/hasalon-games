import { useState, type JSX } from 'react';
import { useT } from '../strings';
import { isStandalone } from './useFullscreen';
import { Button } from './Button';

const STORAGE_KEY = 'mg.installPromptDismissed';

/**
 * iOS Safari has no native install prompt a site can open. This first-visit
 * overlay shows the exact Safari share glyph and the two manual steps instead.
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

/** Best-effort iOS detection, including iPadOS devices reporting as a Mac. */
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
        <h2 className="overlay__title">{t.installTitle}</h2>
        <p className="installprompt__benefit">{t.installBenefit}</p>
        <ol className="installprompt__steps">
          <li>
            <span className="installprompt__step-number">1</span>
            <span>{t.installStepShare}</span>
            <span className="installprompt__share-demo" aria-hidden="true">
              <ShareIcon />
            </span>
          </li>
          <li>
            <span className="installprompt__step-number">2</span>
            <span>{t.installStepHome}</span>
            <span className="installprompt__home-demo" aria-hidden="true">
              <PlusSquareIcon />
            </span>
          </li>
        </ol>
        <Button variant="primary" size="lg" full onClick={dismiss}>
          {t.installDismiss}
        </Button>
      </div>
    </div>
  );
}

/** Safari's real share symbol: a square with an arrow leaving its top edge. */
function ShareIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" focusable="false">
      <path d="M16 3v17M10 9l6-6 6 6" />
      <path d="M9 13H6v15h20V13h-3" />
    </svg>
  );
}

function PlusSquareIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" focusable="false">
      <rect x="4" y="4" width="24" height="24" rx="5" />
      <path d="M16 10v12M10 16h12" />
    </svg>
  );
}
