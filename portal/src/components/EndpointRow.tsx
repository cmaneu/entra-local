import { useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/format';
import { useShell } from '../hooks/useToast';

interface EndpointRowProps {
  label: string;
  /** The full URL (copied in full). */
  value: string;
  /** Optional shorter display value (defaults to the full URL, middle-truncated by CSS). */
  display?: string;
}

/** A dashboard endpoint key/value row with a trailing copy icon button. */
export function EndpointRow({ label, value, display }: EndpointRowProps): JSX.Element {
  const { announce } = useShell();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function onCopy(): Promise<void> {
    const ok = await copyText(value);
    if (!ok) return;
    setCopied(true);
    announce(`Copied ${label} URL`);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="endpoint">
      <span className="ep-k">{label}</span>
      <span className="ep-v" title={value}>
        {display ?? value}
      </span>
      <button
        type="button"
        className="iconbtn"
        aria-label={`Copy ${label} URL`}
        onClick={() => void onCopy()}
        style={copied ? { color: 'var(--success-60)' } : undefined}
      >
        {copied ? '✓' : '⧉'}
      </button>
    </div>
  );
}
