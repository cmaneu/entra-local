import { useId, type ReactNode } from 'react';
import { useModal } from '../hooks/useModal';
import { Button } from './Button';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  describedById?: string;
  wide?: boolean;
  /** Right-aligned action buttons. */
  actions: ReactNode;
}

/** Centered, focus-trapped modal dialog over a scrim (Esc / scrim click / actions dismiss). */
export function Dialog({
  title,
  onClose,
  children,
  describedById,
  wide,
  actions,
}: DialogProps): JSX.Element {
  const ref = useModal<HTMLDivElement>(onClose);
  const titleId = useId();
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`dialog${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedById}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  onConfirm: () => void;
  onClose: () => void;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  children: ReactNode;
}

/** A short confirmation modal (used for reset / delete-user / delete-app). */
export function ConfirmDialog({
  title,
  onConfirm,
  onClose,
  confirmLabel,
  destructive,
  busy,
  children,
}: ConfirmDialogProps): JSX.Element {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={destructive ? 'destructive-solid' : 'primary'}
            onClick={onConfirm}
            busy={busy}
            autoFocus
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
