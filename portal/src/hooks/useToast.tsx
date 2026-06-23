import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'bad';
}

interface ShellContextValue {
  /** Show a transient toast (bottom-right) and announce it via the matching live region. */
  toast: (text: string, kind?: 'ok' | 'bad') => void;
  /** Announce a message politely (status) without a toast. */
  announce: (text: string) => void;
  /** Announce a message assertively (alert) without a toast. */
  announceError: (text: string) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

/**
 * Mounts the two `.sr-only` live regions (polite `role=status`, assertive `role=alert`) and the
 * toast stack at the app-shell root, and exposes `toast` / `announce` / `announceError`. Copy /
 * save / seed / reset confirmations route through polite; load / mutation failures route through
 * assertive — per Murdock's accessibility note.
 */
export function ShellProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const nextId = useRef(1);

  const announce = useCallback((text: string) => setPolite(text), []);
  const announceError = useCallback((text: string) => setAssertive(text), []);

  const toast = useCallback((text: string, kind: 'ok' | 'bad' = 'ok') => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, text, kind }]);
    if (kind === 'bad') setAssertive(text);
    else setPolite(text);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const value = useMemo<ShellContextValue>(
    () => ({ toast, announce, announceError }),
    [toast, announce, announceError],
  );

  return (
    <ShellContext.Provider value={value}>
      {children}
      <div className="toaststack">
        {toasts.map((t) => (
          <span key={t.id} className="toast">
            <span className={t.kind}>{t.kind === 'ok' ? '✓' : '✕'}</span>
            {t.text}
          </span>
        ))}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {polite}
      </span>
      <span className="sr-only" role="alert" aria-live="assertive">
        {assertive}
      </span>
    </ShellContext.Provider>
  );
}

/** Access the shell's toast + live-region helpers. */
export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used within <ShellProvider>');
  return ctx;
}
