interface StatTileProps {
  n: number | string;
  k: string;
}

/** A dashboard stat tile: a large count over an uppercase key. */
export function StatTile({ n, k }: StatTileProps): JSX.Element {
  return (
    <div className="stat">
      <div className="n">{n}</div>
      <div className="k">{k}</div>
    </div>
  );
}
