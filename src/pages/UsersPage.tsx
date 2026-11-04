import { useEffect, useState } from 'react';
import { Save, UserPlus, Trash2 } from 'lucide-react';
import { Modal } from '../components/Modal';
import { useRepository } from '../data/RepositoryContext';
import { useLive } from '../hooks/useLive';
import { useAuth } from '../auth/AuthContext';
import type { Profile, UserRole } from '../domain/types';

export function UsersPage() {
  const repo = useRepository();
  const { isAdmin, profile: me } = useAuth();
  const { data: profiles, error: loadError, loading, reload } = useLive(() => repo.listProfiles(), ['profiles']);

  const [edits, setEdits] = useState<Record<string, Profile>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [addUser, setAddUser] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newUser, setNewUser] = useState<{ fullName: string; email: string; password: string; role: UserRole }>({
    fullName: '',
    email: '',
    password: '',
    role: 'employee',
  });
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);

  useEffect(() => {
    if (profiles) setEdits(Object.fromEntries(profiles.map((p) => [p.id, p])));
  }, [profiles]);

  const current = (p: Profile) => edits[p.id] ?? p;
  const dirty = (p: Profile) => {
    const e = current(p);
    return e.fullName !== p.fullName || e.role !== p.role || e.isActive !== p.isActive;
  };

  async function save(p: Profile) {
    const e = current(p);
    setBusyId(p.id);
    setError('');
    setNotice('');
    try {
      await repo.setProfile({ id: p.id, role: e.role, isActive: e.isActive, fullName: e.fullName });
      setNotice(`Updated ${e.fullName}.`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the employee.');
    } finally {
      setBusyId(null);
    }
  }

  async function addNewUser() {
    if (!newUser.fullName.trim() || !newUser.email.trim()) {
      setError('Full name and email are required.');
      return;
    }
    if (newUser.password.length < 8) {
      setError('The password must be at least 8 characters.');
      return;
    }
    setAdding(true);
    setError('');
    setNotice('');
    try {
      await repo.addUser({
        fullName: newUser.fullName,
        email: newUser.email,
        password: newUser.password,
        role: newUser.role,
      });
      setNotice(`${newUser.fullName.trim()} was added and can sign in now with ${newUser.email.trim()}.`);
      setAddUser(false);
      setNewUser({ fullName: '', email: '', password: '', role: 'employee' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the employee.');
    } finally {
      setAdding(false);
    }
  }

  async function deleteUser(id: string) {
    setConfirmDeleteUserId(id);
  }

  async function confirmDeleteUser() {
    if (!confirmDeleteUserId) return;
    setBusyId(confirmDeleteUserId);
    setError('');
    setNotice('');
    try {
      await repo.deleteProfile(confirmDeleteUserId);
      setNotice('Employee removed.');
      setConfirmDeleteUserId(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the employee.');
      setConfirmDeleteUserId(null);
    } finally {
      setBusyId(null);
    }
  }

  function cancelDeleteUser() {
    setConfirmDeleteUserId(null);
  }

  return (
    <section aria-labelledby="users-h">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="users-h" className="text-xl font-semibold">Users</h1>
        </div>
        {isAdmin ? (
          <button className="btn btn-primary" onClick={() => setAddUser((v) => !v)}>
            <UserPlus size={15} aria-hidden /> Add user
          </button>
        ) : null}
      </div>

      {isAdmin && addUser && (
        <form className="mb-4 rounded border border-slate-200 bg-white p-4" onSubmit={(e) => { e.preventDefault(); addNewUser(); }}>
          <h2 className="mb-2 text-sm font-semibold">Add new user</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="u-name">Full name *</label>
              <input id="u-name" className="field" value={newUser.fullName} onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="u-email">Email *</label>
              <input id="u-email" type="email" className="field" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="u-pass">Password * (min. 8 characters)</label>
              <input id="u-pass" type="password" autoComplete="new-password" className="field" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="u-role">Role</label>
              <select id="u-role" className="field w-auto" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}>
                <option value="employee">Employee</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary" type="submit" disabled={adding}>
              {adding ? 'Adding...' : 'Add user'}
            </button>
            <button className="btn" type="button" onClick={() => setAddUser(false)}>Cancel</button>
          </div>
        </form>
      )}

      {notice && <p role="status" className="mb-3 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {error && <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loadError && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-800">{loadError}</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Active</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && !profiles && <tr><td className="px-3 py-6 text-slate-500" colSpan={5}>Loading...</td></tr>}
            {profiles?.map((p) => {
              const e = current(p);
              const isSelf = me?.id === p.id;
              return (
                <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <input
                      className="field min-w-[10rem]"
                      aria-label={`Name of ${p.email}`}
                      value={e.fullName}
                      disabled={!isAdmin || busyId !== null}
                      onChange={(ev) => setEdits((s) => ({ ...s, [p.id]: { ...e, fullName: ev.target.value } }))}
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-600">{p.email || '-'}{isSelf ? ' (you)' : ''}</td>
                  <td className="px-3 py-2">
                    <select
                      className="field w-auto"
                      aria-label={`Role of ${e.fullName || p.email}`}
                      value={e.role}
                      disabled={busyId !== null}
                      onChange={(ev) => setEdits((s) => ({ ...s, [p.id]: { ...e, role: ev.target.value as UserRole } }))}
                    >
                      <option value="employee">Employee</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Active status of ${e.fullName || p.email}`}
                      checked={e.isActive}
                      disabled={busyId !== null}
                      onChange={(ev) => setEdits((s) => ({ ...s, [p.id]: { ...e, isActive: ev.target.checked } }))}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex gap-1 justify-end">
                      <button
                        className="btn"
                        disabled={busyId !== null || !dirty(p) || isSelf}
                        title={isSelf ? 'Cannot change your own account.' : undefined}
                        onClick={() => void save(p)}
                      >
                        <Save size={14} aria-hidden /> {busyId === p.id ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        className="btn text-red-600"
                        disabled={busyId !== null || isSelf}
                        title={isSelf ? 'Cannot remove your own account.' : 'Remove this employee'}
                        aria-label={`Remove ${p.fullName}`}
                        onClick={() => void deleteUser(p.id)}
                      >
                        <Trash2 size={14} aria-hidden /> Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {confirmDeleteUserId && (
        <Modal
          label="Confirm delete user"
          tone="danger"
          icon={<Trash2 size={22} aria-hidden />}
          title="Remove employee?"
          onClose={cancelDeleteUser}
          footer={
            <>
              <button className="btn" onClick={cancelDeleteUser}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDeleteUser} disabled={busyId !== null}>
                {busyId !== null ? 'Removing...' : 'Remove employee'}
              </button>
            </>
          }
        >
          The account will be removed and the person will no longer be able to sign in. Documents they created stay in the system.
        </Modal>
      )}
    </section>
  );
}

