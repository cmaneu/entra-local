interface StatusDotProps {
  tone: 'ok' | 'bad' | 'warn';
}

/** A status dot — always paired with a text label by the caller (color is never the only signal). */
export function StatusDot({ tone }: StatusDotProps): JSX.Element {
  return <span className={`dot ${tone}`} aria-hidden="true" />;
}
