import { useCallback, useState } from 'react';
import { api } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { useShell } from '../hooks/useToast';
import { useEmulator } from '../components/EmulatorContext';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { CertTrustCard } from '../components/CertTrustCard';
import { ConfirmDialog } from '../components/Dialog';
import { EndpointRow } from '../components/EndpointRow';
import { IdChip } from '../components/IdChip';
import { StatTile } from '../components/StatTile';
import { StatusDot } from '../components/StatusDot';

/** Dashboard: emulator status, endpoint URLs, live directory counts, and seed/reset controls. */
export function Dashboard(): JSX.Element {
  const { health, discovery, error: emuError, reload: reloadEmu } = useEmulator();
  const { toast } = useShell();
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState<'seed' | 'reset' | null>(null);

  const loadCounts = useCallback(async () => {
    const [users, groups, apps] = await Promise.all([
      api.listUsers({ top: 1 }),
      api.listGroups({ top: 1 }),
      api.listApps({ top: 1 }),
    ]);
    return { users: users.count, groups: groups.count, apps: apps.count };
  }, []);
  const counts = useAsync(loadCounts, []);

  async function onSeed(): Promise<void> {
    setBusy('seed');
    try {
      await api.seed();
      toast('Seeded — default directory loaded.');
      counts.reload();
      reloadEmu();
    } catch {
      toast("Couldn't seed.", 'bad');
    } finally {
      setBusy(null);
    }
  }

  async function onReset(): Promise<void> {
    setBusy('reset');
    try {
      await api.reset();
      toast('Reset — data reseeded.');
      setConfirmReset(false);
      counts.reload();
      reloadEmu();
    } catch {
      toast("Couldn't reset.", 'bad');
    } finally {
      setBusy(null);
    }
  }

  const origin = discovery ? new URL(discovery.issuer).origin : window.location.origin;
  const tenantId = health?.tenantId ?? '';
  const discoveryUrl = tenantId
    ? `${origin}/${tenantId}/v2.0/.well-known/openid-configuration`
    : '';

  return (
    <>
      <div className="pagehead">
        <div>
          <h1 className="display">Dashboard</h1>
          <p className="sub">Local Entra ID emulator — directory and endpoint overview.</p>
        </div>
        <div className="toolbar">
          <Button onClick={() => void onSeed()} busy={busy === 'seed'}>
            ⟳ Seed
          </Button>
          <Button variant="destructive" onClick={() => setConfirmReset(true)}>
            Reset…
          </Button>
        </div>
      </div>

      <Banner tone="caution" className="mb16">
        <strong>Not for production use.</strong> Entra Local is a local emulator of Microsoft Entra
        ID. Tokens, accounts and secrets here are fake; the server is intentionally insecure.
      </Banner>

      {emuError && (
        <Banner tone="error" role="alert" className="mb16">
          <strong>Couldn't reach the emulator.</strong> {emuError.message}
        </Banner>
      )}

      <div className="stats mb16">
        <StatTile n={counts.data?.users ?? '—'} k="Users" />
        <StatTile n={counts.data?.groups ?? '—'} k="Groups" />
        <StatTile n={counts.data?.apps ?? '—'} k="App registrations" />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2 className="h-md mb16">Emulator status</h2>
          <div className="kv">
            <div className="k">Status</div>
            <div>
              {health ? (
                <>
                  <StatusDot tone="ok" /> <span className="yes">Healthy</span>
                </>
              ) : (
                <>
                  <StatusDot tone="bad" /> <span className="no">Unreachable</span>
                </>
              )}
            </div>
            <div className="k">Version</div>
            <div className="mono b-sm">{health?.version ?? '—'}</div>
            <div className="k">Tenant ID</div>
            <div>{tenantId ? <IdChip value={tenantId} full title="Tenant ID" /> : '—'}</div>
            <div className="k">TLS</div>
            <div>
              {health ? (
                <>
                  <StatusDot tone={health.tls ? 'ok' : 'warn'} />{' '}
                  {health.tls ? 'Enabled (self-signed)' : 'Disabled'}
                </>
              ) : (
                '—'
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="h-md mb16">Endpoints</h2>
          {discovery ? (
            <>
              <EndpointRow label="Issuer" value={discovery.issuer} />
              <EndpointRow label="Discovery" value={discoveryUrl} />
              <EndpointRow label="JWKS" value={discovery.jwks_uri} />
              <EndpointRow label="Authorize" value={discovery.authorization_endpoint} />
              <EndpointRow label="Token" value={discovery.token_endpoint} />
            </>
          ) : (
            <p className="muted b-sm">Endpoints unavailable — emulator unreachable.</p>
          )}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <CertTrustCard />
      </div>

      {confirmReset && (
        <ConfirmDialog
          title="Reset emulator data?"
          confirmLabel="Reset data"
          destructive
          busy={busy === 'reset'}
          onConfirm={() => void onReset()}
          onClose={() => setConfirmReset(false)}
        >
          <p>
            This empties all users, groups, app registrations, secrets, codes and sessions, then
            re-applies the deterministic seed. The tenant and signing keys are preserved.{' '}
            <strong>This cannot be undone.</strong>
          </p>
          <Banner tone="caution" className="mb16">
            Current data will be replaced by the deterministic seed.
          </Banner>
        </ConfirmDialog>
      )}
    </>
  );
}
