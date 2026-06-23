import type { ReactNode } from 'react';

type Tone = 'caution' | 'error' | 'success';

const ICON: Record<Tone, string> = { caution: '⚠', error: '✕', success: '✓' };

interface BannerProps {
  tone: Tone;
  children: ReactNode;
  role?: 'alert' | 'status';
  id?: string;
  className?: string;
}

/** Full-width inline message bar (caution / error / success) with a leading icon. */
export function Banner({ tone, children, role, id, className }: BannerProps): JSX.Element {
  return (
    <div className={`banner banner-${tone}${className ? ` ${className}` : ''}`} role={role} id={id}>
      <span className="ic" aria-hidden="true">
        {ICON[tone]}
      </span>
      <span>{children}</span>
    </div>
  );
}
