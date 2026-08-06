import { useEffect, useRef, type JSX } from 'react';
import { TanksTouchPad } from './TouchPad';
import { attachTanksInput, tanksInput } from './input';

interface Props {
  mySeat: number;
  onButton: (bit: number, down: boolean) => void;
}

/**
 * Tank Trouble mobile touch controls component.
 * Ensures the shoot button is clamped within visible viewport safe-area bounds
 * so it is never pushed off-screen when maximized on Android.
 */
export function Controls({ mySeat, onButton }: Props): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const clampShootButton = (): void => {
      const btn = el.querySelector<HTMLElement>('.pad__btn--shoot');
      if (!btn) return;

      const vv = window.visualViewport;
      const vw = vv ? vv.width : window.innerWidth;
      const vh = vv ? vv.height : window.innerHeight;

      const rect = btn.getBoundingClientRect();
      const w = rect.width || 92;
      const h = rect.height || 92;

      // Compute safe-area clamping bounds
      const maxRightOffset = Math.max(14, vw - w - 14);
      const maxBottomOffset = Math.max(12, vh - h - 12);

      btn.style.setProperty('--max-right', `${maxRightOffset}px`);
      btn.style.setProperty('--max-bottom', `${maxBottomOffset}px`);
    };

    clampShootButton();
    window.addEventListener('resize', clampShootButton);
    window.addEventListener('orientationchange', clampShootButton);
    window.visualViewport?.addEventListener('resize', clampShootButton);
    window.visualViewport?.addEventListener('scroll', clampShootButton);

    return () => {
      window.removeEventListener('resize', clampShootButton);
      window.removeEventListener('orientationchange', clampShootButton);
      window.visualViewport?.removeEventListener('resize', clampShootButton);
      window.visualViewport?.removeEventListener('scroll', clampShootButton);
    };
  }, []);

  return (
    <div ref={wrapperRef} className="tanks-controls-wrapper">
      <TanksTouchPad mySeat={mySeat} onButton={onButton} />
    </div>
  );
}

export { TanksTouchPad, attachTanksInput, tanksInput };
