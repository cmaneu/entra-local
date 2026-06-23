import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import type { Paged } from '../api/types';

const PAGE_SIZE = 50;

export interface PagedListState<T> {
  data: Paged<T> | undefined;
  loading: boolean;
  error: ApiError | undefined;
  search: string;
  setSearch: (next: string) => void;
  skip: number;
  next: () => void;
  prev: () => void;
  reload: () => void;
  top: number;
}

/**
 * Manage a searchable, offset-paginated Admin API list: debounced `search`, `top`/`skip`, and a
 * manual `reload` (called after mutations). The loader receives the current query.
 */
export function usePagedList<T>(
  loader: (q: { top: number; skip: number; search?: string }) => Promise<Paged<T>>,
): PagedListState<T> {
  const [search, setSearchRaw] = useState('');
  const [debounced, setDebounced] = useState('');
  const [skip, setSkip] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [data, setData] = useState<Paged<T> | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  const setSearch = useCallback((next: string) => {
    setSearchRaw(next);
    setSkip(0);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    loader({ top: PAGE_SIZE, skip, ...(debounced ? { search: debounced } : {}) })
      .then((res) => !cancelled && setData(res))
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err
            : new ApiError(0, 'unknown', err instanceof Error ? err.message : 'Unexpected error.'),
        );
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, skip, nonce]);

  const next = useCallback(() => setSkip((s) => s + PAGE_SIZE), []);
  const prev = useCallback(() => setSkip((s) => Math.max(0, s - PAGE_SIZE)), []);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, search, setSearch, skip, next, prev, reload, top: PAGE_SIZE };
}
