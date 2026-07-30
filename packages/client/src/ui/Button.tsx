import type { ButtonHTMLAttributes, CSSProperties, JSX, ReactNode } from 'react';
import { sfx } from '../audio';

type Variant = 'primary' | 'plain' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  /** Overrides the variant's fill, for per-player colours. */
  tone?: string;
  full?: boolean;
}

const VARIANT_TONE: Record<Variant, string | undefined> = {
  primary: 'var(--yellow)',
  plain: 'var(--surface)',
  ghost: undefined,
  danger: 'var(--red)',
};

/**
 * Chunky and physical: it sits on a hard shadow and, when pressed, moves down
 * into it. All of that lives in CSS so the travel distance always matches the
 * shadow offset.
 */
export function Button({
  children,
  variant = 'plain',
  size = 'md',
  tone,
  full,
  className,
  onClick,
  ...rest
}: Props): JSX.Element {
  const fill = tone ?? VARIANT_TONE[variant];

  return (
    <button
      type="button"
      className={[
        'btn',
        `btn--${variant}`,
        `btn--${size}`,
        full ? 'btn--full' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={fill ? ({ '--btn-fill': fill } as CSSProperties) : undefined}
      onClick={(event) => {
        sfx.click();
        onClick?.(event);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
