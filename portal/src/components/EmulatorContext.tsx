import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { api, type ApiError } from '../api/client';
import type { Discovery, Health } from '../api/types';
import { useAsync } from '../hooks/useAsync';

interface Emulator {
  health: Health | undefined;
  discovery: Discovery | undefined;
  loading: boolean;
  error: ApiError | undefined;
  reload: () => void;
}

const EmulatorContext = createContext<Emulator | null>(null);

/** Loads `/health` then OIDC discovery once and shares them with the shell + dashboard + snippet. */
export function EmulatorProvider({ children }: { children: ReactNode }): JSX.Element {
  const load = useCallback(async (): Promise<{ health: Health; discovery: Discovery }> => {
    const health = await api.health();
    // Discovery is served same-origin on every host that also serves the portal (the `portal.` host
    // and the loopback compat host), so fetch it relative. Fetching it cross-origin from the login
    // host would fail on the `portal.` subdomain until that host's self-signed cert is trusted.
    const discovery = await api.discovery(health.tenantId);
    return { health, discovery };
  }, []);

  const { data, loading, error, reload } = useAsync(load, []);

  const value: Emulator = {
    health: data?.health,
    discovery: data?.discovery,
    loading,
    error,
    reload,
  };
  return <EmulatorContext.Provider value={value}>{children}</EmulatorContext.Provider>;
}

/** Access the loaded emulator health + discovery. */
export function useEmulator(): Emulator {
  const ctx = useContext(EmulatorContext);
  if (!ctx) throw new Error('useEmulator must be used within <EmulatorProvider>');
  return ctx;
}
