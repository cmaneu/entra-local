import type { ReactNode } from 'react';
import { SkeletonRows } from './States';

export interface Column<T> {
  /** Header label (empty string for the trailing actions column). */
  header: string;
  /** Cell renderer. */
  cell: (row: T) => ReactNode;
  /** Mark the trailing actions column (right-aligned). */
  actions?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  /** Rendered (in place of the table body) when not loading and there are no rows. */
  empty?: ReactNode;
}

/** Dense data table with header, hover rows, loading skeletons and an empty slot. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
}: DataTableProps<T>): JSX.Element {
  if (!loading && rows.length === 0 && empty !== undefined) {
    return <>{empty}</>;
  }
  return (
    <table className="dt" aria-busy={loading || undefined}>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i} className={c.actions ? 'col-actions' : undefined}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <SkeletonRows rows={3} cols={columns.length} />
        ) : (
          rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c, i) => (
                <td key={i} className={c.actions ? 'col-actions' : undefined}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
