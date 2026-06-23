import { useCallback, useState } from 'react';
import { api, ApiError, type GroupBody } from '../api/client';
import type { Group, User } from '../api/types';
import { useAsync } from '../hooks/useAsync';
import { usePagedList } from '../hooks/usePagedList';
import { useShell } from '../hooks/useToast';
import { avatarColor, initials } from '../lib/format';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/Dialog';
import { DataTable, type Column } from '../components/DataTable';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/States';
import { Field, TextInput } from '../components/Fields';
import { Pagination } from '../components/Pagination';
import { RowOverflowMenu } from '../components/RowOverflowMenu';
import { SearchBox } from '../components/SearchBox';

export function Groups(): JSX.Element {
  const list = usePagedList<Group>((q) => api.listGroups(q));
  const { toast } = useShell();
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  const [managing, setManaging] = useState<Group | null>(null);
  const [deleting, setDeleting] = useState<Group | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function onDelete(): Promise<void> {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.deleteGroup(deleting.id);
      toast(`Deleted ${deleting.displayName}.`);
      setDeleting(null);
      list.reload();
    } catch {
      toast("Couldn't delete group.", 'bad');
    } finally {
      setDeleteBusy(false);
    }
  }

  const columns: Column<Group>[] = [
    { header: 'Display name', cell: (g) => <strong>{g.displayName}</strong> },
    { header: 'Description', cell: (g) => <span className="muted">{g.description ?? '—'}</span> },
    { header: 'Members', cell: (g) => String(g.memberCount) },
    {
      header: '',
      actions: true,
      cell: (g) => (
        <span className="row-actions">
          <Button size="sm" onClick={() => setManaging(g)}>
            Manage members
          </Button>
          <RowOverflowMenu
            label={`Actions for ${g.displayName}`}
            actions={[
              { label: 'Edit', onSelect: () => setEditing(g) },
              { label: 'Delete', destructive: true, onSelect: () => setDeleting(g) },
            ]}
          />
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="pagehead">
        <div>
          <h1 className="display">Groups</h1>
          <p className="sub">Directory groups and their members.</p>
        </div>
        <div className="toolbar">
          <SearchBox
            value={list.search}
            onChange={list.setSearch}
            placeholder="Search groups"
            ariaLabel="Search groups"
            width={200}
          />
          <Button variant="primary" onClick={() => setEditing('new')}>
            ＋ New group
          </Button>
        </div>
      </div>

      {list.error ? (
        <Banner tone="error" role="alert">
          <strong>Couldn't load groups.</strong> {list.error.message}{' '}
          <button type="button" className="link" onClick={list.reload}>
            Retry
          </button>
        </Banner>
      ) : (
        <div className="card flush">
          <DataTable
            columns={columns}
            rows={list.data?.value ?? []}
            rowKey={(g) => g.id}
            loading={list.loading}
            empty={
              <EmptyState
                icon="◑"
                title="No groups yet"
                description="Create a group to organize users and test group-based access."
                action={
                  <Button variant="primary" onClick={() => setEditing('new')}>
                    ＋ New group
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
        <GroupDrawer
          group={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}

      {managing && (
        <MembersDrawer
          group={managing}
          onClose={() => {
            setManaging(null);
            list.reload();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete group?"
          confirmLabel="Delete group"
          destructive
          busy={deleteBusy}
          onConfirm={() => void onDelete()}
          onClose={() => setDeleting(null)}
        >
          <p>
            Delete <strong>{deleting.displayName}</strong>? This removes the group and its
            memberships (member accounts are not deleted). This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

interface GroupDrawerProps {
  group: Group | null;
  onClose: () => void;
  onSaved: () => void;
}

function GroupDrawer({ group, onClose, onSaved }: GroupDrawerProps): JSX.Element {
  const { toast } = useShell();
  const isNew = group === null;
  const [displayName, setDisplayName] = useState(group?.displayName ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function onSubmit(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const body: GroupBody = {
        displayName: displayName.trim(),
        ...(description.trim()
          ? { description: description.trim() }
          : isNew
            ? {}
            : { description: null }),
      };
      if (isNew) {
        await api.createGroup(body);
        toast(`Created ${body.displayName}.`);
      } else {
        await api.updateGroup(group.id, body);
        toast(`Saved ${body.displayName}.`);
      }
      onSaved();
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
      title={isNew ? 'New group' : 'Edit group'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void onSubmit()} busy={busy}>
            {isNew ? 'Create group' : 'Save changes'}
          </Button>
        </>
      }
    >
      <Field label="Display name" htmlFor="g-dn" error={error}>
        <TextInput
          id="g-dn"
          value={displayName}
          invalid={!!error}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </Field>
      <Field label="Description" htmlFor="g-desc" optional>
        <textarea
          id="g-desc"
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
    </Drawer>
  );
}

interface MembersDrawerProps {
  group: Group;
  onClose: () => void;
}

function MembersDrawer({ group, onClose }: MembersDrawerProps): JSX.Element {
  const { toast } = useShell();
  const [search, setSearch] = useState('');
  const loadMembers = useCallback(() => api.groupMembers(group.id), [group.id]);
  const members = useAsync(loadMembers, []);
  const loadAll = useCallback(
    () => api.listUsers(search ? { search, top: 50 } : { top: 50 }),
    [search],
  );
  const all = useAsync(loadAll, [search]);

  const memberIds = new Set((members.data?.value ?? []).map((u) => u.id));
  const candidates = (all.data?.value ?? []).filter(() => true);

  async function add(user: User): Promise<void> {
    try {
      await api.addMember(group.id, user.id);
      toast(`Added ${user.displayName}.`);
      members.reload();
    } catch {
      toast("Couldn't add member.", 'bad');
    }
  }

  async function remove(user: User): Promise<void> {
    try {
      await api.removeMember(group.id, user.id);
      toast(`Removed ${user.displayName}.`);
      members.reload();
    } catch {
      toast("Couldn't remove member.", 'bad');
    }
  }

  return (
    <Drawer
      title={group.displayName}
      subtitle={`Members · ${members.data?.count ?? group.memberCount}`}
      onClose={onClose}
      wide
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <h3 className="lbl-caps mb8">Members</h3>
      {members.data && members.data.value.length === 0 && (
        <p className="muted b-sm">No members yet.</p>
      )}
      {(members.data?.value ?? []).map((u) => (
        <div className="member" key={u.id}>
          <span className="avatar" style={{ background: avatarColor(u.id) }} aria-hidden="true">
            {initials(u.displayName)}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{u.displayName}</div>
            <div className="b-sm muted mono">{u.userPrincipalName}</div>
          </div>
          <Button size="sm" onClick={() => void remove(u)}>
            Remove
          </Button>
        </div>
      ))}

      <h3 className="lbl-caps" style={{ margin: '24px 0 8px' }}>
        Add member
      </h3>
      <div className="mb8">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search users to add"
          ariaLabel="Search users to add"
          width={420}
        />
      </div>
      <div className="picker-list">
        {candidates.map((u) => {
          const isMember = memberIds.has(u.id);
          return (
            <div className={`picker-row${isMember ? '' : ' clickable'}`} key={u.id}>
              <span className="avatar" style={{ background: avatarColor(u.id) }} aria-hidden="true">
                {initials(u.displayName)}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{u.displayName}</div>
                <div className="b-sm muted mono">
                  {isMember ? 'already a member' : u.userPrincipalName}
                </div>
              </div>
              {!isMember && (
                <button type="button" className="link" onClick={() => void add(u)}>
                  Add
                </button>
              )}
            </div>
          );
        })}
        {candidates.length === 0 && <div className="picker-row muted b-sm">No users found.</div>}
      </div>
    </Drawer>
  );
}
