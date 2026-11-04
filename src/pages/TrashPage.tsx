import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useRepository } from '../data/RepositoryContext';
import { useLive } from '../hooks/useLive';
import { useAuth } from '../auth/AuthContext';
import { Money } from '../auth/FiguresContext';
import { Modal } from '../components/Modal';
import { displayTotals } from '../domain/calc';
import { formatDisplayDate } from '../pdf/printModel';

type PurgeTarget =
  | { kind: 'document'; id: string; label: string }
  | { kind: 'customer'; id: string; label: string }
  | { kind: 'history'; id: string; label: string };

/** The small coloured label that tells you what kind of thing is in the Trash. */
function Tag({ children, tone }: { children: ReactNode; tone: 'blue' | 'red' | 'violet' }) {
  const cls =
    tone === 'blue' ? 'bg-brand-50 text-brand-700 border-brand-100'
    : tone === 'red' ? 'bg-red-50 text-red-800 border-red-200'
    : 'bg-violet-50 text-violet-800 border-violet-200';
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

function formatAt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export function TrashPage() {
  const repo = useRepository();
  const { isAdmin } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [purgeTarget, setPurgeTarget] = useState<PurgeTarget | null>(null);

  const { data: docs, error: loadError, loading, reload } = useLive(() => repo.listDocuments({ status: 'trashed' }), ['documents']);
  const { data: deletedCustomers, reload: reloadCustomers } = useLive(() => repo.listDeletedCustomers(), ['customers']);
  const { data: historyBatches, reload: reloadHistory } = useLive(() => repo.listTrashedHistory(), ['documents']);

  async function run(id: string, action: () => Promise<string>, failMessage: string, after: () => void) {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      setNotice(await action());
      after();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : failMessage);
    } finally {
      setBusyId(null);
    }
  }

  const restoreDocument = (id: string, number: string, version: number) =>
    run(id, async () => {
      const fresh = await repo.getDocument(id);
      await repo.setDocumentStatus(id, 'active', fresh?.version ?? version);
      return `${number} restored to active documents.`;
    }, 'Could not restore the document.', reload);

  const restoreCustomer = (id: string, name: string) =>
    run(id, async () => { await repo.restoreCustomer(id); return `${name} restored to the customer list.`; }, 'Could not restore the customer.', reloadCustomers);

  const restoreHistory = (deletedAt: string) =>
    run(deletedAt, async () => { await repo.restoreHistory(deletedAt); return 'History restored. It is back on the History page.'; }, 'Could not restore the history.', reloadHistory);

  async function confirmPurge() {
    const t = purgeTarget;
    if (!t) return;
    setPurgeTarget(null);
    if (t.kind === 'document') {
      await run(t.id, async () => { await repo.purgeDocument(t.id); return `${t.label} permanently deleted. The action was recorded in the audit history.`; }, 'Could not delete the document.', reload);
    } else if (t.kind === 'customer') {
      await run(t.id, async () => { await repo.purgeCustomer(t.id); return `${t.label} permanently deleted.`; }, 'Could not delete the customer.', reloadCustomers);
    } else {
      await run(t.id, async () => { await repo.purgeHistory(t.id); return 'History permanently deleted.'; }, 'Could not delete the history.', reloadHistory);
    }
  }

  return (
    <section aria-labelledby="trash-h">
      <div className="mb-4">
        <h1 id="trash-h" className="text-xl font-semibold">Trash</h1>
        <p className="mt-1 text-sm text-slate-600">
          Everything that was deleted lands here: documents, customers and history. Restore it any time. Only an administrator can delete permanently.
        </p>
      </div>

      {notice && <p role="status" className="mb-3 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {error && <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loadError && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-800">{loadError}</p>}

      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">Documents <Tag tone="blue">Documents</Tag></h2>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">Number</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && !docs && <tr><td className="px-3 py-6 text-slate-500" colSpan={6}>Loading...</td></tr>}
            {docs?.length === 0 && <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={6}>No deleted documents.</td></tr>}
            {docs?.map((d) => {
              const totals = displayTotals(d);
              return (
                <tr key={d.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2"><Link className="font-medium text-brand-700 hover:underline" to={`/documents/${d.id}`}>{d.number}</Link></td>
                  <td className="px-3 py-2 capitalize">{d.type}</td>
                  <td className="px-3 py-2">{d.customerName}</td>
                  <td className="px-3 py-2">{formatDisplayDate(d.issueDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals ? <Money cents={totals.totalCents} /> : <span className="text-slate-400">Quotation</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button className="btn" title="Restore this document" aria-label={`Restore ${d.number}`} disabled={busyId !== null} onClick={() => void restoreDocument(d.id, d.number, d.version)}>
                        <RotateCcw size={14} aria-hidden /> Restore
                      </button>
                      {isAdmin && (
                        <button className="btn text-red-600" title="Delete permanently (administrator only)" aria-label={`Permanently delete ${d.number}`} disabled={busyId !== null} onClick={() => setPurgeTarget({ kind: 'document', id: d.id, label: d.number })}>
                          <Trash2 size={14} aria-hidden /> Delete permanently
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 mt-6 flex items-center gap-2 text-sm font-semibold" aria-label="Deleted customers">Customers <Tag tone="red">Customers</Tag></h2>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <tbody>
            {(deletedCustomers ?? []).length === 0 && <tr><td className="px-3 py-6 text-center text-slate-500">No deleted customers.</td></tr>}
            {(deletedCustomers ?? []).map((c) => (
              <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">{c.name}</td>
                <td className="px-3 py-2 text-slate-600">{c.phone || '-'}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <button className="btn" title="Restore this customer" aria-label={`Restore customer ${c.name}`} disabled={busyId !== null} onClick={() => void restoreCustomer(c.id, c.name)}>
                      <RotateCcw size={14} aria-hidden /> Restore
                    </button>
                    {isAdmin && (
                      <button className="btn text-red-600" title="Delete permanently (administrator only)" aria-label={`Permanently delete customer ${c.name}`} disabled={busyId !== null} onClick={() => setPurgeTarget({ kind: 'customer', id: c.id, label: c.name })}>
                        <Trash2 size={14} aria-hidden /> Delete permanently
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 mt-6 flex items-center gap-2 text-sm font-semibold" aria-label="Deleted history">History <Tag tone="violet">History</Tag></h2>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <tbody>
            {(historyBatches ?? []).length === 0 && <tr><td className="px-3 py-6 text-center text-slate-500">No deleted history.</td></tr>}
            {(historyBatches ?? []).map((b) => (
              <tr key={b.deletedAt} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2"><Tag tone="violet">History</Tag></td>
                <td className="px-3 py-2">
                  <div className="font-medium">History cleared on {formatAt(b.deletedAt)}</div>
                  <div className="text-xs text-slate-500">{b.auditCount} audit {b.auditCount === 1 ? 'entry' : 'entries'}, {b.versionCount} document {b.versionCount === 1 ? 'version' : 'versions'}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <button className="btn" title="Restore this history" aria-label={`Restore history of ${formatAt(b.deletedAt)}`} disabled={busyId !== null} onClick={() => void restoreHistory(b.deletedAt)}>
                      <RotateCcw size={14} aria-hidden /> Restore
                    </button>
                    {isAdmin && (
                      <button className="btn text-red-600" title="Delete permanently (administrator only)" aria-label={`Permanently delete history of ${formatAt(b.deletedAt)}`} disabled={busyId !== null} onClick={() => setPurgeTarget({ kind: 'history', id: b.deletedAt, label: `the history cleared on ${formatAt(b.deletedAt)}` })}>
                        <Trash2 size={14} aria-hidden /> Delete permanently
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!isAdmin && <p className="mt-2 text-xs text-slate-500">Permanent deletion is restricted to administrators.</p>}

      {purgeTarget && (
        <Modal
          label="Confirm permanent delete"
          tone="danger"
          icon={<Trash2 size={22} aria-hidden />}
          title="Delete permanently?"
          onClose={() => setPurgeTarget(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPurgeTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => void confirmPurge()}>Delete permanently</button>
            </>
          }
        >
          {purgeTarget.kind === 'document'
            ? `${purgeTarget.label} will be permanently deleted. This cannot be undone, and its number stays reserved forever.`
            : `${purgeTarget.label} will be permanently deleted. This cannot be undone.`}
        </Modal>
      )}
    </section>
  );
}
