import { Button } from './Button';

interface PaginationProps {
  /** Zero-based offset (`skip`). */
  skip: number;
  /** Page size (`top`). */
  top: number;
  /** Total matching rows (`count`). */
  count: number;
  onPrev: () => void;
  onNext: () => void;
}

/** Pagination footer: a range label, page size, and Prev/Next (disabled at the ends). */
export function Pagination({ skip, top, count, onPrev, onNext }: PaginationProps): JSX.Element {
  const from = count === 0 ? 0 : skip + 1;
  const to = Math.min(skip + top, count);
  return (
    <div className="pager">
      <span>
        {from}–{to} of {count}
      </span>
      <div className="grp">
        <span>
          Rows: <strong>{top}</strong>
        </span>
        <Button size="sm" onClick={onPrev} disabled={skip === 0}>
          ‹ Prev
        </Button>
        <Button size="sm" onClick={onNext} disabled={to >= count}>
          Next ›
        </Button>
      </div>
    </div>
  );
}
