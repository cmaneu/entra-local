import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { App, AppRole, AppScope, CreatedSecret, RedirectUri } from '../api/types';
import { useAsync } from '../hooks/useAsync';
import { useShell } from '../hooks/useToast';
import { useEmulator } from '../components/EmulatorContext';
import { browserSnippet, nodeSnippet, snippetValues } from '../lib/msalSnippet';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { CodeBlock } from '../components/CodeBlock';
import { ConfirmDialog } from '../components/Dialog';
import { Field, Select, TextInput, Toggle } from '../components/Fields';
import { IdChip } from '../components/IdChip';
import { SecretOnceDialog } from '../components/SecretOnceDialog';
import { SkeletonRows } from '../components/States';
import { Tabs } from '../components/Tabs';

const REDIRECT_TYPES = ['spa', 'web', 'native'] as const;

export function AppDetail(): JSX.Element {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const load = useCallback(() => api.getApp(id), [id]);
  const { data: app, loading, error, reload } = useAsync<App>(load, [id]);

  if (loading && !app) {
    return (
      <table className="dt">
        <tbody>
          <SkeletonRows rows={4} cols={2} />
        </tbody>
      </table>
    );
  }

  if (error || !app) {
    return (
      <>
        <p className="b-sm mb8">
          <button type="button" className="link" onClick={() => navigate('/apps')}>
            ‹ App registrations
          </button>
        </p>
        <Banner tone="error" role="alert">
          <strong>Couldn't load this app registration.</strong> {error?.message ?? 'Not found.'}{' '}
          <button type="button" className="link" onClick={reload}>
            Retry
          </button>
        </Banner>
      </>
    );
  }

  return (
    <>
      <p className="b-sm mb8">
        <button type="button" className="link" onClick={() => navigate('/apps')}>
          ‹ App registrations
        </button>
      </p>
      <div className="pagehead">
        <div>
          <h1 className="display">{app.displayName}</h1>
          <p className="sub" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            Client ID <IdChip value={app.id} full title="Application (client) ID" />
          </p>
        </div>
      </div>

      <div className="stack">
        <BasicsForm app={app} onSaved={reload} />
        <RedirectUriList app={app} onChange={reload} />
        <SecretList app={app} onChange={reload} />
        <ScopeList app={app} onChange={reload} />
        <AppRoleList app={app} onChange={reload} />
        <MsalSnippet app={app} />
        <DeleteAppCard app={app} onDeleted={() => navigate('/apps')} />
      </div>
    </>
  );
}

// --- Basics --------------------------------------------------------------------------------------

function BasicsForm({ app, onSaved }: { app: App; onSaved: () => void }): JSX.Element {
  const { toast } = useShell();
  const [displayName, setDisplayName] = useState(app.displayName);
  const [confidential, setConfidential] = useState(app.isConfidential);
  const [appIdUri, setAppIdUri] = useState(app.appIdUri ?? '');
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);

  const dirty =
    displayName !== app.displayName ||
    confidential !== app.isConfidential ||
    appIdUri !== (app.appIdUri ?? '');

  async function onSave(): Promise<void> {
    setBusy(true);
    setErrors({});
    try {
      await api.updateApp(app.id, {
        displayName: displayName.trim(),
        isConfidential: confidential,
        appIdUri: appIdUri.trim() ? appIdUri.trim() : null,
      });
      toast(`Saved — ${displayName.trim()} updated.`);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        const map: Partial<Record<string, string>> = {};
        if (err.isConflict) map.appIdUri = err.message;
        else for (const d of err.details) map[d.field] = d.message;
        if (Object.keys(map).length === 0 && err.target) map[err.target] = err.message;
        setErrors(map);
        toast(err.message, 'bad');
      } else {
        toast('Unexpected error.', 'bad');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head-flush">
        <h2 className="h-md">Basics</h2>
        <Button variant="primary" onClick={() => void onSave()} busy={busy} disabled={!dirty}>
          Save changes
        </Button>
      </div>
      <Field label="Display name" htmlFor="a-dn" error={errors.displayName}>
        <TextInput
          id="a-dn"
          value={displayName}
          invalid={!!errors.displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </Field>
      <div className="field">
        <Toggle checked={confidential} onChange={setConfidential} label="Confidential client" />
        <div className="help">
          Off = public client (SPA / native, PKCE). On = confidential (web / daemon, supports client
          secrets &amp; <span className="mono">.default</span>).
        </div>
      </div>
      <Field
        label="Application ID URI"
        htmlFor="a-uri"
        optional
        error={errors.appIdUri}
        help={
          <>
            Must be unique across apps. Used for{' '}
            <span className="mono">&lt;appIdUri&gt;/.default</span> scope resolution.
          </>
        }
      >
        <TextInput
          id="a-uri"
          mono
          value={appIdUri}
          invalid={!!errors.appIdUri}
          onChange={(e) => setAppIdUri(e.target.value)}
          placeholder={`api://${app.id}`}
        />
      </Field>
    </section>
  );
}

// --- Redirect URIs -------------------------------------------------------------------------------

function RedirectUriList({ app, onChange }: { app: App; onChange: () => void }): JSX.Element {
  const { toast } = useShell();
  const [uri, setUri] = useState('');
  const [type, setType] = useState<(typeof REDIRECT_TYPES)[number]>('spa');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function add(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await api.addRedirectUri(app.id, { uri: uri.trim(), type });
      toast('Redirect URI added.');
      setUri('');
      onChange();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Unexpected error.';
      setError(message);
      toast(message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: RedirectUri): Promise<void> {
    try {
      await api.removeRedirectUri(app.id, r.id);
      toast('Redirect URI removed.');
      onChange();
    } catch {
      toast("Couldn't remove redirect URI.", 'bad');
    }
  }

  return (
    <section className="card flush">
      <div className="card-head">
        <h2 className="h-md">Redirect URIs</h2>
      </div>
      <table className="dt">
        <thead>
          <tr>
            <th>URI</th>
            <th>Type</th>
            <th className="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          {app.redirectUris.length === 0 && (
            <tr>
              <td colSpan={3} className="muted b-sm">
                No redirect URIs yet. Add one below.
              </td>
            </tr>
          )}
          {app.redirectUris.map((r) => (
            <tr key={r.id}>
              <td className="mono b-sm">{r.uri}</td>
              <td>
                <span className="chip-plain">{r.type}</span>
              </td>
              <td className="col-actions">
                <Button size="sm" onClick={() => void remove(r)}>
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="add-row">
        <TextInput
          mono
          style={{ flex: 1 }}
          value={uri}
          invalid={!!error}
          onChange={(e) => setUri(e.target.value)}
          placeholder="https://localhost:3000/callback"
          aria-label="New redirect URI"
        />
        <Select
          style={{ width: 120 }}
          value={type}
          aria-label="Redirect URI type"
          onChange={(e) => setType(e.target.value as (typeof REDIRECT_TYPES)[number])}
        >
          {REDIRECT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Button onClick={() => void add()} busy={busy} disabled={!uri.trim()}>
          Add
        </Button>
      </div>
      {error && (
        <div className="field-error" style={{ padding: '0 16px 12px' }}>
          {error}
        </div>
      )}
    </section>
  );
}

// --- Secrets -------------------------------------------------------------------------------------

function SecretList({ app, onChange }: { app: App; onChange: () => void }): JSX.Element {
  const { toast } = useShell();
  const [adding, setAdding] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedSecret | null>(null);

  async function create(): Promise<void> {
    setBusy(true);
    try {
      const secret = await api.createSecret(app.id, {
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      });
      setCreated(secret);
      setAdding(false);
      setDisplayName('');
      onChange();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Unexpected error.', 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function remove(secretId: string): Promise<void> {
    try {
      await api.deleteSecret(app.id, secretId);
      toast('Secret deleted.');
      onChange();
    } catch {
      toast("Couldn't delete secret.", 'bad');
    }
  }

  return (
    <section className="card flush">
      <div className="card-head">
        <div>
          <h2 className="h-md">Client secrets</h2>
          <p className="b-sm muted" style={{ marginTop: 2 }}>
            Confidential clients only. Shown once at creation.
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding((v) => !v)}>
          ＋ New secret
        </Button>
      </div>
      <table className="dt">
        <thead>
          <tr>
            <th>Description</th>
            <th>Hint</th>
            <th>Expires</th>
            <th>Created</th>
            <th className="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          {app.secrets.length === 0 && (
            <tr>
              <td colSpan={5} className="muted b-sm">
                No client secrets.
              </td>
            </tr>
          )}
          {app.secrets.map((sec) => (
            <tr key={sec.id}>
              <td>{sec.displayName ?? '—'}</td>
              <td>{sec.hint ? <span className="chip-plain">{sec.hint}</span> : '—'}</td>
              <td>{sec.expiresAt ? sec.expiresAt.slice(0, 10) : '—'}</td>
              <td className="muted">{sec.createdAt.slice(0, 10)}</td>
              <td className="col-actions">
                <Button size="sm" onClick={() => void remove(sec.id)}>
                  Delete
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {adding && (
        <div className="add-row">
          <TextInput
            style={{ flex: 1 }}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Description (optional), e.g. CI pipeline"
            aria-label="Secret description"
          />
          <Button variant="primary" onClick={() => void create()} busy={busy}>
            Create secret
          </Button>
        </div>
      )}
      {created && <SecretOnceDialog secret={created} onClose={() => setCreated(null)} />}
    </section>
  );
}

// --- Exposed scopes ------------------------------------------------------------------------------

function ScopeList({ app, onChange }: { app: App; onChange: () => void }): JSX.Element {
  const { toast } = useShell();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const [display, setDisplay] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function add(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await api.addScope(app.id, {
        value: value.trim(),
        ...(display.trim() ? { adminConsentDisplayName: display.trim() } : {}),
      });
      toast('Scope added.');
      setValue('');
      setDisplay('');
      setAdding(false);
      onChange();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Unexpected error.';
      setError(message);
      toast(message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(scope: AppScope): Promise<void> {
    try {
      await api.updateScope(app.id, scope.id, { isEnabled: !scope.isEnabled });
      onChange();
    } catch {
      toast("Couldn't update scope.", 'bad');
    }
  }

  async function remove(scope: AppScope): Promise<void> {
    try {
      await api.removeScope(app.id, scope.id);
      toast('Scope removed.');
      onChange();
    } catch {
      toast("Couldn't remove scope.", 'bad');
    }
  }

  return (
    <section className="card flush">
      <div className="card-head">
        <h2 className="h-md">Exposed scopes</h2>
        <Button size="sm" onClick={() => setAdding((v) => !v)}>
          ＋ Add scope
        </Button>
      </div>
      <table className="dt">
        <thead>
          <tr>
            <th>Scope value</th>
            <th>Admin consent display name</th>
            <th>State</th>
            <th className="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          {app.exposedScopes.length === 0 && (
            <tr>
              <td colSpan={4} className="muted b-sm">
                No exposed scopes.
              </td>
            </tr>
          )}
          {app.exposedScopes.map((scope) => (
            <tr key={scope.id}>
              <td>
                <span className="chip-plain">{scope.value}</span>
              </td>
              <td>{scope.adminConsentDisplayName ?? '—'}</td>
              <td>
                <Toggle
                  checked={scope.isEnabled}
                  onChange={() => void toggle(scope)}
                  label={
                    <span className={`b-sm${scope.isEnabled ? '' : ' muted'}`}>
                      {scope.isEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  }
                />
              </td>
              <td className="col-actions">
                <Button size="sm" onClick={() => void remove(scope)}>
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {adding && (
        <div className="add-row">
          <TextInput
            style={{ width: 200 }}
            value={value}
            invalid={!!error}
            onChange={(e) => setValue(e.target.value)}
            placeholder="access_as_user"
            aria-label="Scope value"
          />
          <TextInput
            style={{ flex: 1 }}
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
            placeholder="Admin consent display name (optional)"
            aria-label="Admin consent display name"
          />
          <Button onClick={() => void add()} busy={busy} disabled={!value.trim()}>
            Add
          </Button>
        </div>
      )}
      {error && (
        <div className="field-error" style={{ padding: '0 16px 12px' }}>
          {error}
        </div>
      )}
    </section>
  );
}

// --- App roles -----------------------------------------------------------------------------------

function AppRoleList({ app, onChange }: { app: App; onChange: () => void }): JSX.Element {
  const { toast } = useShell();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const [display, setDisplay] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function add(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await api.addRole(app.id, {
        value: value.trim(),
        ...(display.trim() ? { displayName: display.trim() } : {}),
      });
      toast('App role added.');
      setValue('');
      setDisplay('');
      setAdding(false);
      onChange();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Unexpected error.';
      setError(message);
      toast(message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(role: AppRole): Promise<void> {
    try {
      await api.updateRole(app.id, role.id, { isEnabled: !role.isEnabled });
      onChange();
    } catch {
      toast("Couldn't update role.", 'bad');
    }
  }

  async function remove(role: AppRole): Promise<void> {
    try {
      await api.removeRole(app.id, role.id);
      toast('App role removed.');
      onChange();
    } catch {
      toast("Couldn't remove role.", 'bad');
    }
  }

  return (
    <section className="card flush">
      <div className="card-head">
        <h2 className="h-md">App roles</h2>
        <Button size="sm" onClick={() => setAdding((v) => !v)}>
          ＋ Add role
        </Button>
      </div>
      <table className="dt">
        <thead>
          <tr>
            <th>Value</th>
            <th>Display name</th>
            <th>Member types</th>
            <th>State</th>
            <th className="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          {app.appRoles.length === 0 && (
            <tr>
              <td colSpan={5} className="muted b-sm">
                No app roles.
              </td>
            </tr>
          )}
          {app.appRoles.map((role) => (
            <tr key={role.id}>
              <td>
                <span className="chip-plain">{role.value}</span>
              </td>
              <td>{role.displayName ?? '—'}</td>
              <td>
                {role.allowedMemberTypes.map((t) => (
                  <span className="chip-plain" key={t}>
                    {t}
                  </span>
                ))}
              </td>
              <td>
                <Toggle
                  checked={role.isEnabled}
                  onChange={() => void toggle(role)}
                  label={
                    <span className={`b-sm${role.isEnabled ? '' : ' muted'}`}>
                      {role.isEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  }
                />
              </td>
              <td className="col-actions">
                <Button size="sm" onClick={() => void remove(role)}>
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {adding && (
        <div className="add-row">
          <TextInput
            style={{ width: 200 }}
            value={value}
            invalid={!!error}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Tasks.Read"
            aria-label="Role value"
          />
          <TextInput
            style={{ flex: 1 }}
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
            placeholder="Display name (optional)"
            aria-label="Role display name"
          />
          <Button onClick={() => void add()} busy={busy} disabled={!value.trim()}>
            Add
          </Button>
        </div>
      )}
      {error && (
        <div className="field-error" style={{ padding: '0 16px 12px' }}>
          {error}
        </div>
      )}
    </section>
  );
}

// --- MSAL snippet --------------------------------------------------------------------------------

function MsalSnippet({ app }: { app: App }): JSX.Element {
  const { discovery, health } = useEmulator();
  const [tab, setTab] = useState<'browser' | 'node'>('browser');
  const uris = app.redirectUris.map((r) => r.uri);
  const [redirectUri, setRedirectUri] = useState(uris[0] ?? 'https://localhost:3000/auth/callback');

  if (!discovery || !health) {
    return (
      <section className="card">
        <h2 className="h-md mb16">MSAL configuration</h2>
        <p className="muted b-sm">Emulator unreachable — snippet unavailable.</p>
      </section>
    );
  }

  const chosen = uris.includes(redirectUri) ? redirectUri : (uris[0] ?? redirectUri);
  const values = snippetValues({
    app,
    issuer: discovery.issuer,
    tenantId: health.tenantId,
    redirectUri: chosen,
  });
  const lines = tab === 'browser' ? browserSnippet(values) : nodeSnippet(values);
  const host = values.host;

  return (
    <section className="card">
      <div className="msal-head">
        <h2 className="h-md">MSAL configuration</h2>
        {uris.length > 0 && (
          <div className="search" style={{ width: 240 }}>
            <span className="ic" aria-hidden="true">
              ↪
            </span>
            <Select
              style={{ paddingLeft: 30 }}
              value={chosen}
              aria-label="Redirect URI for snippet"
              onChange={(e) => setRedirectUri(e.target.value)}
            >
              {uris.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      <Tabs
        ariaLabel="MSAL flavor"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'browser', label: '@azure/msal-browser' },
          { id: 'node', label: '@azure/msal-node' },
        ]}
      />
      <CodeBlock
        lines={lines}
        ariaLabel={`MSAL ${tab === 'browser' ? 'browser' : 'node'} configuration snippet`}
        data-testid="msal-snippet"
      />
      {uris.length === 0 && (
        <p className="b-sm muted" style={{ marginTop: 8 }}>
          Add a redirect URI above to use it in the snippet. Showing an example value meanwhile.
        </p>
      )}
      <Banner tone="caution" className="mt12">
        Trust the emulator's self-signed cert (or set{' '}
        <span className="mono">NODE_TLS_REJECT_UNAUTHORIZED=0</span> in dev) so MSAL can reach{' '}
        <span className="mono">{host}</span>. Values are deterministic for the current seed/config.
      </Banner>
    </section>
  );
}

// --- Delete --------------------------------------------------------------------------------------

function DeleteAppCard({ app, onDeleted }: { app: App; onDeleted: () => void }): JSX.Element {
  const { toast } = useShell();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove(): Promise<void> {
    setBusy(true);
    try {
      await api.deleteApp(app.id);
      toast(`Deleted ${app.displayName}.`);
      onDeleted();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't delete app.", 'bad');
      setBusy(false);
    }
  }

  return (
    <section className="card danger">
      <h2 className="h-md danger-title">Delete app registration</h2>
      <p className="b-sm muted" style={{ margin: '0 0 12px' }}>
        Deleting <strong>{app.displayName}</strong> permanently removes its client ID, redirect
        URIs, secrets, exposed scopes and app roles. Apps using this client ID will stop
        authenticating. This cannot be undone.
      </p>
      <Button variant="destructive" onClick={() => setConfirm(true)}>
        Delete app
      </Button>
      {confirm && (
        <ConfirmDialog
          title="Delete app registration?"
          confirmLabel="Delete app"
          destructive
          busy={busy}
          onConfirm={() => void remove()}
          onClose={() => setConfirm(false)}
        >
          <p>
            Delete <strong>{app.displayName}</strong> and everything under it? This cannot be
            undone.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
