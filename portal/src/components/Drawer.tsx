import { useId, type ReactNode } from 'react';
import { useModal } from '../hooks/useModal';

interface DrawerProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  /** Footer actions (right-aligned). */
  footer: ReactNode;
  wide?: boolean;
  children: ReactNode;
}

/**
 * Right-anchored, focus-trapped panel for create/edit surfaces. `role="dialog" aria-modal="true"`,
 * dismissible via Esc / scrim / Cancel; returns focus to the invoking control on close.
 */
export function Drawer({
  title,
  subtitle,
  onClose,
  footer,
  wide,
  children,
}: DrawerProps): JSX.Element {
  const ref = useModal<HTMLElement>(onClose);
  const titleId = useId();
  return (
    <>
      <div className="drawer-scrim" onMouseDown={onClose} />
      <aside
        ref={ref}
        className={`drawer${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="drawer-head">
          <div>
            <h2 id={titleId} className="h-md">
              {title}
            </h2>
            {subtitle && <p className="b-sm muted">{subtitle}</p>}
          </div>
          <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        <div className="drawer-foot">{footer}</div>
      </aside>
    </>
  );
}
