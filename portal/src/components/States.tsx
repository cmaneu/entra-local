import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  action?: ReactNode;
}

/** Centered empty state: muted icon, title, one line of guidance, and a primary action. */
export function EmptyState({ icon, title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="empty">
      <div className="ic" aria-hidden="true">
        {icon}
      </div>
      <div className="t">{title}</div>
      <div className="d">{description}</div>
      {action && <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>{action}</div>}
    </div>
  );
}

interface SkeletonRowsProps {
  rows: number;
  cols: number;
}

/** Loading skeleton rows for a data table (rendered inside `<tbody>`). */
export function SkeletonRows({ rows, cols }: SkeletonRowsProps): JSX.Element {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c}>
              <span className="skel" style={{ width: `${40 + ((r + c) % 4) * 12}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
