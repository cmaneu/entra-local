import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client';

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: ApiError | undefined;
  /** Re-run the loader (e.g. after a mutation, or a Retry button). */
  reload: () => void;
}

/**
 * Run an async loader on mount (and whenever `deps` change), tracking loading / data / error.
 * Errors are normalized to {@link ApiError} so callers can render the admin envelope message.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    loader()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err
            : new ApiError(0, 'unknown', err instanceof Error ? err.message : 'Unexpected error.'),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload };
}
