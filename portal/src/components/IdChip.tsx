import { useEffect, useRef, useState } from 'react';
import { copyText, middleEllipsis } from '../lib/format';
import { useShell } from '../hooks/useToast';

interface IdChipProps {
  /** The full value (always copied in full). */
  value: string;
  /** Optional shorter label to display (defaults to a middle-ellipsis of `value`). */
  label?: string;
  title?: string;
  /** Disable truncation and show the full value. */
  full?: boolean;
  'data-testid'?: string;
}

/**
 * Renders a machine identifier in Cascadia Mono with a trailing copy button. Copies the full value;
 * shows a check + "Copied" announcement for ~1.5s. Long values truncate (middle ellipsis) but copy
 * in full.
 */
export function IdChip({ value, label, title, full, ...rest }: IdChipProps): JSX.Element {
  const { announce } = useShell();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const shown = label ?? (full ? value : middleEllipsis(value));

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function onCopy(): Promise<void> {
    const ok = await copyText(value);
    if (!ok) return;
    setCopied(true);
    announce('Copied');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <span
      className={`chip${copied ? ' copied' : ''}`}
      title={title ?? value}
      data-testid={rest['data-testid']}
    >
      <span className="val">{shown}</span>
      <button
        type="button"
        className="copy"
        aria-label={`Copy ${title ?? value}`}
        onClick={() => void onCopy()}
      >
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  );
}
