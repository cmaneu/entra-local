import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type AppBody } from '../api/client';
import type { App } from '../api/types';
import { usePagedList } from '../hooks/usePagedList';
import { useShell } from '../hooks/useToast';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/States';
import { Field, TextInput, Toggle } from '../components/Fields';
import { IdChip } from '../components/IdChip';
import { Pagination } from '../components/Pagination';
import { RowOverflowMenu } from '../components/RowOverflowMenu';
import { SearchBox } from '../components/SearchBox';

export function Apps(): JSX.Element {
  const navigate = useNavigate();
  const list = usePagedList<App>((q) => api.listApps(q));
  const { toast } = useShell();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<App | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function onDelete(): Promise<void> {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.deleteApp(deleting.id);
      toast(`Deleted ${deleting.displayName}.`);
      setDeleting(null);
      list.reload();
    } catch {
      toast("Couldn't delete app.", 'bad');
    } finally {
      setDeleteBusy(false);
    }
  }

  const columns: Column<App>[] = [
    {
      header: 'Display name',
      cell: (a) => (
        <button type="button" className="link" onClick={() => navigate(`/apps/${a.id}`)}>
          {a.displayName}
        </button>
      ),
    },
    {
      header: 'Application (client) ID',
      cell: (a) => <IdChip value={a.id} title="Application (client) ID" />,
    },
    {
      header: 'Type',
      cell: (a) =>
        a.isConfidential ? (
          <span className="yes">● Confidential</span>
        ) : (
          <span className="no">Public</span>
        ),
    },
    { header: 'Redirect URIs', cell: (a) => String(a.redirectUris.length) },
    {
      header: '',
      actions: true,
      cell: (a) => (
        <RowOverflowMenu
          label={`Actions for ${a.displayName}`}
          actions={[
            { label: 'Open', onSelect: () => navigate(`/apps/${a.id}`) },
            { label: 'Delete', destructive: true, onSelect: () => setDeleting(a) },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <div className="pagehead">
        <div>
          <h1 className="display">App registrations</h1>
          <p className="sub">Client apps that authenticate against the emulator.</p>
        </div>
        <div className="toolbar">
          <SearchBox
            value={list.search}
            onChange={list.setSearch}
            placeholder="Search apps"
            ariaLabel="Search apps"
            width={200}
          />
          <Button variant="primary" onClick={() => setCreating(true)}>
            ＋ New app
          </Button>
        </div>
      </div>

      {list.error ? (
        <Banner tone="error" role="alert">
          <strong>Couldn't load app registrations.</strong> {list.error.message}{' '}
          <button type="button" className="link" onClick={list.reload}>
            Retry
          </button>
        </Banner>
      ) : (
        <div className="card flush">
          <DataTable
            columns={columns}
            rows={list.data?.value ?? []}
            rowKey={(a) => a.id}
            loading={list.loading}
            empty={
              <EmptyState
                icon="▤"
                title="No app registrations yet"
                description="Register an app to get a client ID and a ready-to-paste MSAL config."
                action={
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    ＋ New app
                  </Button>
                }
              />
            }
          />
          {list.data && list.data.count > 0 && (
            <Pagination
              skip={list.skip}
              top={list.top}
              count={list.data.count}
              onPrev={list.prev}
              onNext={list.next}
            />
          )}
        </div>
      )}

      {creating && (
        <NewAppDrawer
          onClose={() => setCreating(false)}
          onCreated={(app) => {
            setCreating(false);
            list.reload();
            navigate(`/apps/${app.id}`);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete app registration?"
          confirmLabel="Delete app"
          destructive
          busy={deleteBusy}
          onConfirm={() => void onDelete()}
          onClose={() => setDeleting(null)}
        >
          <p>
            Delete <strong>{deleting.displayName}</strong>? This permanently removes its client ID,
            redirect URIs, secrets, exposed scopes and app roles. Apps using this client ID will
            stop authenticating. This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

interface NewAppDrawerProps {
  onClose: () => void;
  onCreated: (app: App) => void;
}

function NewAppDrawer({ onClose, onCreated }: NewAppDrawerProps): JSX.Element {
  const { toast } = useShell();
  const [displayName, setDisplayName] = useState('');
  const [confidential, setConfidential] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function onSubmit(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const body: AppBody = { displayName: displayName.trim(), isConfidential: confidential };
      const app = await api.createApp(body);
      toast(`Created ${app.displayName}.`);
      onCreated(app);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Unexpected error.';
      setError(message);
      toast(message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      title="New app registration"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void onSubmit()} busy={busy}>
            Create app
          </Button>
        </>
      }
    >
      <Field label="Display name" htmlFor="na-dn" error={error}>
        <TextInput
          id="na-dn"
          value={displayName}
          invalid={!!error}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="My SPA"
        />
      </Field>
      <div className="field">
        <Toggle checked={confidential} onChange={setConfidential} label="Confidential client" />
        <div className="help">
          Off = public client (SPA / native, PKCE). On = confidential (web / daemon, supports client
          secrets &amp; <span className="mono">.default</span>). Add redirect URIs, scopes, roles
          and secrets after creating.
        </div>
      </div>
    </Drawer>
  );
}
