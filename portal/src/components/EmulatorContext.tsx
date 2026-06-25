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

/**
 * Where to fetch OIDC discovery from (#26). On the legacy compat host (`localhost`/`127.0.0.1`) or
 * when the login origin already matches the current origin, discovery is same-origin (relative).
 * On the dedicated `portal.` host the STS lives on a different origin, so we fetch the advertised
 * `origins.login` absolute URL (CORS reflects the portal origin + credentials).
 */
function discoveryBase(health: Health): string {
  if (typeof window === 'undefined') return '';
  const { hostname, origin } = window.location;
  const isCompatHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (isCompatHost || health.origins.login === origin) return '';
  return health.origins.login;
}

/** Loads `/health` then OIDC discovery once and shares them with the shell + dashboard + snippet. */
export function EmulatorProvider({ children }: { children: ReactNode }): JSX.Element {
  const load = useCallback(async (): Promise<{ health: Health; discovery: Discovery }> => {
    const health = await api.health();
    const discovery = await api.discovery(health.tenantId, discoveryBase(health));
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
