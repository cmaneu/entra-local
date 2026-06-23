import { useEffect, useRef, useState } from 'react';

export interface MenuAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

interface RowOverflowMenuProps {
  label: string;
  actions: MenuAction[];
}

/** A trailing `…` overflow menu of row actions (Edit / Delete / Manage). Closes on Esc / blur. */
export function RowOverflowMenu({ label, actions }: RowOverflowMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="iconbtn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        …
      </button>
      {open && (
        <div className="menu" role="menu">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              className={a.destructive ? 'destructive' : undefined}
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
