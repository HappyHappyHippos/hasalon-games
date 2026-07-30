import type { CSSProperties, JSX, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Background colour; defaults to the surface paper. */
  tone?: string;
  /** Degrees of tilt. A degree or two is what stops a grid looking machine-made. */
  tilt?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * The one card primitive: heavy outline, hard offset shadow, optional tilt.
 * Everything else in the UI is built from this.
 */
export function Sticker({ children, tone, tilt = 0, className, style }: Props): JSX.Element {
  return (
    <div
      className={`sticker${className ? ` ${className}` : ''}`}
      style={{
        ...(tone ? { background: tone } : null),
        ...(tilt ? { transform: `rotate(${tilt}deg)` } : null),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
