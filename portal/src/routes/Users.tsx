import { useState } from 'react';
import { api, ApiError, type UserBody } from '../api/client';
import type { User } from '../api/types';
import { usePagedList } from '../hooks/usePagedList';
import { useShell } from '../hooks/useToast';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/States';
import { Field, TextInput, Toggle } from '../components/Fields';
import { Pagination } from '../components/Pagination';
import { RowOverflowMenu } from '../components/RowOverflowMenu';
import { SearchBox } from '../components/SearchBox';

type FieldErrors = Partial<Record<string, string>>;

/** Map an Admin API error to inline field errors (409 conflict / 400 validation_error). */
function toFieldErrors(err: ApiError): FieldErrors {
  if (err.isConflict) return { userPrincipalName: err.message };
  if (err.isValidation && err.details.length > 0) {
    const out: FieldErrors = {};
    for (const d of err.details) out[d.field] = d.message;
    return out;
  }
  if (err.target) return { [err.target]: err.message };
  return {};
}

export function Users(): JSX.Element {
  const list = usePagedList<User>((q) => api.listUsers(q));
  const { toast } = useShell();
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function onDelete(): Promise<void> {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.deleteUser(deleting.id);
      toast(`Deleted ${deleting.displayName}.`);
      setDeleting(null);
      list.reload();
    } catch {
      toast("Couldn't delete user.", 'bad');
    } finally {
      setDeleteBusy(false);
    }
  }

  const columns: Column<User>[] = [
    {
      header: 'User principal name',
      cell: (u) => <span className="mono b-sm">{u.userPrincipalName}</span>,
    },
    { header: 'Display name', cell: (u) => u.displayName },
    { header: 'Mail', cell: (u) => <span className="muted">{u.mail ?? '—'}</span> },
    {
      header: 'Enabled',
      cell: (u) =>
        u.accountEnabled ? <span className="yes">● Yes</span> : <span className="no">○ No</span>,
    },
    {
      header: 'Password',
      cell: (u) =>
        u.hasPassword ? <span className="yes">Set</span> : <span className="muted">None</span>,
    },
    {
      header: '',
      actions: true,
      cell: (u) => (
        <RowOverflowMenu
          label={`Actions for ${u.userPrincipalName}`}
          actions={[
            { label: 'Edit', onSelect: () => setEditing(u) },
            { label: 'Delete', destructive: true, onSelect: () => setDeleting(u) },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <div className="pagehead">
        <div>
          <h1 className="display">Users</h1>
          <p className="sub">Directory accounts that can sign in to the emulator.</p>
        </div>
        <div className="toolbar">
          <SearchBox
            value={list.search}
            onChange={list.setSearch}
            placeholder="Search UPN or name"
            ariaLabel="Search users"
          />
          <Button variant="primary" onClick={() => setEditing('new')}>
            ＋ New user
          </Button>
        </div>
      </div>

      {list.error ? (
        <>
          <Banner tone="error" role="alert">
            <strong>Couldn't load users.</strong> {list.error.message}{' '}
            <button type="button" className="link" onClick={list.reload}>
              Retry
            </button>
          </Banner>
        </>
      ) : (
        <div className="card flush">
          <DataTable
            columns={columns}
            rows={list.data?.value ?? []}
            rowKey={(u) => u.id}
            loading={list.loading}
            empty={
              <EmptyState
                icon="◔"
                title="No users yet"
                description="Create a user to sign in to apps, or run seed to load the default directory."
                action={
                  <Button variant="primary" onClick={() => setEditing('new')}>
                    ＋ New user
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

      {editing && (
        <UserDrawer
          user={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete user?"
          confirmLabel="Delete user"
          destructive
          busy={deleteBusy}
          onConfirm={() => void onDelete()}
          onClose={() => setDeleting(null)}
        >
          <p>
            Delete <strong>{deleting.displayName}</strong> (
            <span className="mono b-sm">{deleting.userPrincipalName}</span>)? This removes the
            account and its group memberships. This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

interface UserDrawerProps {
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
}

function UserDrawer({ user, onClose, onSaved }: UserDrawerProps): JSX.Element {
  const { toast } = useShell();
  const isNew = user === null;
  const [upn, setUpn] = useState(user?.userPrincipalName ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [givenName, setGivenName] = useState(user?.givenName ?? '');
  const [surname, setSurname] = useState(user?.surname ?? '');
  const [mail, setMail] = useState(user?.mail ?? '');
  const [enabled, setEnabled] = useState(user?.accountEnabled ?? true);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(): Promise<void> {
    setBusy(true);
    setErrors({});
    try {
      if (isNew) {
        const body: UserBody = {
          userPrincipalName: upn.trim(),
          displayName: displayName.trim(),
          accountEnabled: enabled,
          ...(givenName.trim() ? { givenName: givenName.trim() } : {}),
          ...(surname.trim() ? { surname: surname.trim() } : {}),
          ...(mail.trim() ? { mail: mail.trim() } : {}),
          ...(password ? { password } : {}),
        };
        await api.createUser(body);
        toast(`Created ${body.displayName}.`);
      } else {
        const body: Partial<UserBody> = {
          userPrincipalName: upn.trim(),
          displayName: displayName.trim(),
          givenName: givenName.trim() || null,
          surname: surname.trim() || null,
          mail: mail.trim() || null,
          accountEnabled: enabled,
          ...(password ? { password } : {}),
        };
        await api.updateUser(user.id, body);
        toast(`Saved ${body.displayName}.`);
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(toFieldErrors(err));
        toast(err.message, 'bad');
      } else {
        toast('Unexpected error.', 'bad');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      title={isNew ? 'New user' : 'Edit user'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void onSubmit()} busy={busy}>
            {isNew ? 'Create user' : 'Save changes'}
          </Button>
        </>
      }
    >
      <Field label="User principal name" htmlFor="u-upn" error={errors.userPrincipalName}>
        <TextInput
          id="u-upn"
          mono
          value={upn}
          invalid={!!errors.userPrincipalName}
          onChange={(e) => setUpn(e.target.value)}
          placeholder="user@entralocal.dev"
        />
      </Field>
      <Field label="Display name" htmlFor="u-dn" error={errors.displayName}>
        <TextInput
          id="u-dn"
          value={displayName}
          invalid={!!errors.displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </Field>
      <div className="grid cols-2">
        <Field label="Given name" htmlFor="u-gn">
          <TextInput id="u-gn" value={givenName} onChange={(e) => setGivenName(e.target.value)} />
        </Field>
        <Field label="Surname" htmlFor="u-sn">
          <TextInput id="u-sn" value={surname} onChange={(e) => setSurname(e.target.value)} />
        </Field>
      </div>
      <Field label="Mail" htmlFor="u-mail" optional error={errors.mail}>
        <TextInput
          id="u-mail"
          value={mail}
          invalid={!!errors.mail}
          onChange={(e) => setMail(e.target.value)}
        />
      </Field>
      <div className="field">
        <Toggle checked={enabled} onChange={setEnabled} label="Account enabled" />
      </div>
      <Field
        label="Password"
        htmlFor="u-pwd"
        error={errors.password}
        help={
          <>
            Optional — leave blank for account-picker sign-in. When set,{' '}
            <span className="mono">REQUIRE_PASSWORD</span> mode prompts for it.
          </>
        }
      >
        <TextInput
          id="u-pwd"
          type="password"
          value={password}
          invalid={!!errors.password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={isNew ? 'Set a password' : 'Leave blank to keep current'}
        />
      </Field>
    </Drawer>
  );
}
