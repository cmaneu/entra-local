import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'destructive' | 'destructive-solid';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm';
  busy?: boolean;
  children: ReactNode;
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  destructive: 'btn-destructive',
  'destructive-solid': 'btn-destructive solid',
};

/** The portal's button primitive: variants + sizes + a busy (spinner, disabled) state. */
export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  const classes = ['btn', VARIANT_CLASS[variant]];
  if (size === 'sm') classes.push('btn-sm');
  if (className) classes.push(className);
  return (
    <button
      type={type}
      className={classes.join(' ')}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && (
        <span className="spin" aria-hidden="true">
          ◌
        </span>
      )}
      {children}
    </button>
  );
}
