import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Search, X, Trash2, RotateCcw } from 'lucide-react';
import { useRepository } from '../data/RepositoryContext';
import { useLive } from '../hooks/useLive';
import type { Customer } from '../domain/types';
import { Modal } from '../components/Modal';

const emptyForm = { id: null as string | null, name: '', phone: '', email: '', address: '' };

export function CustomersPage() {
  const repo = useRepository();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);

  const { data: customers, error: loadError, loading, reload } = useLive(() => repo.listCustomers(), ['customers']);
  const { data: deletedCustomers, reload: reloadDeleted } = useLive(() => repo.listDeletedCustomers(), ['customers']);

  const filtered = (customers ?? []).filter((c) => {
    const q = search.trim().toLowerCase();
    return (
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q)
    );
  });

  function startEdit(c: Customer) {
    setForm({ id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address });
    setNotice('');
    setError('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.name.trim()) {
      setError('Customer name is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const saved = await repo.saveCustomer(form);
      setForm(null);
      setNotice(`Saved ${saved.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the customer.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteCustomer(id: string) {
    setConfirmDeleteId(id);
  }

  async function confirmDeleteCustomer() {
    if (!confirmDeleteId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await repo.deleteCustomer(confirmDeleteId);
      setNotice('Customer moved to the trash. It can be restored from the Trash page.');
      reload();
      reloadDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the customer.');
    } finally {
      setBusy(false);
      setConfirmDeleteId(null);
    }
  }

  function cancelDeleteCustomer() {
    setConfirmDeleteId(null);
  }

  async function restoreCustomer(id: string, name: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await repo.restoreCustomer(id);
      setNotice(`${name} restored.`);
      reload();
      reloadDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore the customer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="cust-h">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 id="cust-h" className="text-xl font-semibold">Customers</h1>
        <button className="btn btn-primary" onClick={() => { setForm({ ...emptyForm }); setError(''); setNotice(''); }}>
          <Plus size={15} aria-hidden /> New customer
        </button>
        <button className="btn" onClick={() => setShowDeleted((v) => !v)}>
          {showDeleted ? 'Hide deleted' : 'View deleted'}
        </button>
      </div>

      <div className="mb-3 relative max-w-md">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" aria-hidden />
        <input
          className="field pl-8"
          placeholder="Search name, phone or email"
          aria-label="Search customers"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {notice && <p role="status" className="mb-3 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {error && <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loadError && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-800">{loadError}</p>}

      {form && (
        <form className="mb-4 rounded border border-slate-200 bg-white p-4" onSubmit={onSubmit} aria-label="Customer form">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{form.id ? 'Edit customer' : 'New customer'}</h2>
            <button type="button" className="icon-btn" aria-label="Close form" onClick={() => setForm(null)}><X size={15} /></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="c-name">Name *</label>
              <input id="c-name" className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="c-phone">Phone</label>
              <input id="c-phone" className="field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="c-email">Email</label>
              <input id="c-email" type="email" className="field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="c-address">Address</label>
              <input id="c-address" className="field" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save customer'}</button>
            <button className="btn" type="button" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Address</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && !customers && (
              <tr><td className="px-3 py-6 text-slate-500" colSpan={5}>Loading...</td></tr>
            )}
            {filtered.length === 0 && (
              <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={5}>No customers found.</td></tr>
            )}
            {filtered.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">{c.name}</td>
                <td className="px-3 py-2">{c.phone}</td>
                <td className="px-3 py-2">{c.email}</td>
                <td className="px-3 py-2">{c.address}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex gap-1 justify-end">
                    <button className="icon-btn" aria-label={`Edit ${c.name}`} onClick={() => startEdit(c)}>
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-btn text-red-600"
                      title={`Delete ${c.name} (moves to trash)`}
                      aria-label={`Delete ${c.name}`}
                      disabled={busy}
                      onClick={() => void deleteCustomer(c.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showDeleted && deletedCustomers && deletedCustomers.length > 0 && (
        <div className="mt-4 rounded border border-slate-200 bg-white p-4" aria-label="Deleted customers">
          <h2 className="mb-2 text-sm font-semibold">Deleted customers (trash)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Deleted customers are saved in the trash and can be restored.
          </p>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 text-right font-medium">Restore</th>
                </tr>
              </thead>
              <tbody>
                {deletedCustomers.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2">{c.phone}</td>
                    <td className="px-3 py-2">{c.email}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => void restoreCustomer(c.id, c.name)}
                      >
                        <RotateCcw size={14} aria-hidden /> Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Customers are shared across the company. Saving a document also updates the linked customer&apos;s contact
        details, and each document keeps its own snapshot of the customer details as printed.
      </p>

      {confirmDeleteId && (
        <Modal
          label="Confirm delete customer"
          tone="danger"
          icon={<Trash2 size={22} aria-hidden />}
          title="Delete customer?"
          onClose={cancelDeleteCustomer}
          footer={
            <>
              <button className="btn" onClick={cancelDeleteCustomer}>Cancel</button>
              <button className="btn btn-danger" onClick={() => void confirmDeleteCustomer()} disabled={busy}>
                {busy ? 'Deleting...' : 'Delete customer'}
              </button>
            </>
          }
        >
          The customer will be moved to the trash and can be restored if deleted accidentally. Nothing is permanently removed.
        </Modal>
      )}
    </section>
  );
}

