import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, History as HistoryIcon, Search, Trash2, ArrowRightLeft } from 'lucide-react';
import { useRepository } from '../data/RepositoryContext';
import { useLive } from '../hooks/useLive';
import { displayTotals } from '../domain/calc';
import { Money, FiguresToggle } from '../auth/FiguresContext';
import { Modal } from '../components/Modal';
import { STATUS_LABEL, invoiceSummary, paymentsByDocument, type PaymentStatus } from '../domain/payments';
import type { DocumentType } from '../domain/types';
import { formatDisplayDate } from '../pdf/printModel';

export function DocumentsPage() {
  const repo = useRepository();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [type, setType] = useState<DocumentType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; number: string }[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
const [trashSuccess, setTrashSuccess] = useState<string | null>(null);

  const { data: docs, error, loading } = useLive(
    () => repo.listDocuments({ search, type: type || undefined, from: from || undefined, to: to || undefined }),
    ['documents'],
    [search, type, from, to],
  );

  const { data: payments } = useLive(() => repo.listPayments(), ['payments']);
  const paidBy = paymentsByDocument(payments ?? []);

  /** Runs a document action and navigates to the result when one was created. */
  async function runCreatedAction(id: string, label: string, fn: () => Promise<{ id: string }>) {
    setBusyId(id);
    setActionError('');
    setNotice('');
    try {
      const created = await fn();
      setNotice(`${label}. Opening it now.`);
      navigate(`/documents/${created.id}`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : `${label} failed.`);
    } finally {
      setBusyId(null);
    }
  }

  function runTrashAction(id: string, number: string) {
    setConfirmDelete([{ id, number }]);
  }

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const allSelected = !!docs?.length && docs.every((d) => selected.has(d.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set((docs ?? []).map((d) => d.id)));
  const trashSelected = () => {
    const picked = (docs ?? []).filter((d) => selected.has(d.id)).map((d) => ({ id: d.id, number: d.number }));
    if (picked.length) setConfirmDelete(picked);
  };

  // The Delete key moves the ticked documents to the trash (never while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' || selected.size === 0 || confirmDelete || trashSuccess) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
        if (!(el instanceof HTMLInputElement && el.type === 'checkbox')) return;
      }
      e.preventDefault();
      const picked = (docs ?? []).filter((d) => selected.has(d.id)).map((d) => ({ id: d.id, number: d.number }));
      if (picked.length) setConfirmDelete(picked);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, docs, confirmDelete, trashSuccess]);

  async function confirmTrash() {
    if (!confirmDelete) return;
    const items = confirmDelete;
    setBusyId('bulk');
    setActionError('');
    setNotice('');
    setConfirmDelete(null);
    const done: string[] = [];
    const failed: string[] = [];
    for (const item of items) {
      try {
        // Always use the freshest version so a stale list can never block the move.
        const fresh = await repo.getDocument(item.id);
        if (!fresh) throw new Error('Document not found.');
        await repo.setDocumentStatus(item.id, 'trashed', fresh.version);
        done.push(item.number);
      } catch (e) {
        failed.push(`${item.number}: ${e instanceof Error ? e.message : 'could not be moved'}`);
      }
    }
    setSelected((prev) => {
      const next = new Set(prev);
      items.forEach((i) => { if (done.includes(i.number)) next.delete(i.id); });
      return next;
    });
    if (done.length) {
      setTrashSuccess(
        done.length === 1
          ? `${done[0]} has been moved to the Trash. You can restore it from the Trash page.`
          : `${done.length} documents have been moved to the Trash. You can restore them from the Trash page.`,
      );
    }
    if (failed.length) setActionError(`Could not move: ${failed.join('; ')}`);
    setBusyId(null);
  }

  function cancelTrash() {
    setConfirmDelete(null);
  }

  return (
    <section aria-labelledby="docs-h">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 id="docs-h" className="text-xl font-semibold">Documents</h1>
        <FiguresToggle />
        <div className="flex gap-2">
          <Link to="/documents/new?type=quotation" className="btn">New quotation</Link>
          <Link to="/documents/new?type=invoice" className="btn btn-primary">New invoice</Link>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" aria-hidden />
          <input
            className="field pl-8"
            placeholder="Search number, customer or order number"
            aria-label="Search documents"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="field w-auto" aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value as DocumentType | '')}>
          <option value="">All types</option>
          <option value="quotation">Quotations</option>
          <option value="invoice">Invoices</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          From
          <input type="date" className="field w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Issue date from" />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          To
          <input type="date" className="field w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Issue date to" />
        </label>
      </div>

      {notice && <p role="status" className="mb-3 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {actionError && <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{actionError}</p>}
      {error && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 p-2 text-sm">
          <span>{selected.size} selected</span>
          <button className="btn text-red-700" onClick={trashSelected} disabled={busyId !== null}>
            <Trash2 size={14} aria-hidden /> Move to trash
          </button>
          <button className="btn" onClick={() => setSelected(new Set())}>Clear</button>
          <span className="text-xs text-slate-500">Tip: press the Delete key to move the selected documents to the trash.</span>
        </div>
      )}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="w-8 px-3 py-2">
                <input type="checkbox" aria-label="Select all documents" checked={allSelected} onChange={toggleAll} />
              </th>
              <th className="px-3 py-2 font-medium">Number</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Payment</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && !docs && (
              <tr><td className="px-3 py-6 text-slate-500" colSpan={8}>Loading...</td></tr>
            )}
            {docs?.length === 0 && (
              <tr>
                <td className="px-3 py-8 text-center text-slate-500" colSpan={8}>
                  No documents match these filters. Create a quotation or an invoice to get started.
                </td>
              </tr>
            )}
            {docs?.map((d) => {
              const totals = displayTotals(d);
              return (
                <tr key={d.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Select ${d.number}`} checked={selected.has(d.id)} onChange={() => toggleSelected(d.id)} />
                  </td>
                  <td className="px-3 py-2">
                    <Link className="font-medium text-brand-700 hover:underline" to={`/documents/${d.id}`}>{d.number}</Link>
                  </td>
                  <td className="px-3 py-2 capitalize">{d.type}</td>
                  <td className="px-3 py-2">{d.customerName}</td>
                  <td className="px-3 py-2">{formatDisplayDate(d.issueDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {totals ? <Money cents={totals.totalCents} /> : <span className="text-slate-400">Quotation</span>}
                  </td>
                  <td className="px-3 py-2">
                    {d.type === 'invoice' ? <PaymentBadge status={invoiceSummary(d, paidBy.get(d.id) ?? []).status} /> : <span className="text-slate-300">-</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        className="icon-btn"
                        title="Duplicate this document"
                        aria-label={`Duplicate ${d.number}`}
                        disabled={busyId !== null}
                        onClick={() => void runCreatedAction(d.id, `Duplicated ${d.number}`, () => repo.duplicateDocument(d.id))}
                      >
                        <Copy size={15} />
                      </button>
                      {d.type === 'quotation' && (
                        <button
                          className="icon-btn"
                          title="Convert to invoice (creates a new invoice; the quotation is kept)"
                          aria-label={`Convert ${d.number} to invoice`}
                          disabled={busyId !== null}
                          onClick={() => void runCreatedAction(d.id, `Converted ${d.number}`, () => repo.convertToInvoice(d.id))}
                        >
                          <ArrowRightLeft size={15} />
                        </button>
                      )}
                      <Link className="icon-btn" to={`/history/${d.id}`} title="Version history and audit" aria-label={`History of ${d.number}`}>
                        <HistoryIcon size={15} />
                      </Link>
                      <button
                        className="icon-btn"
                        title="Move to trash (recoverable)"
                        aria-label={`Move ${d.number} to trash`}
                        disabled={busyId !== null}
                        onClick={() => runTrashAction(d.id, d.number)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirmDelete && (
        <Modal
          label="Confirm delete"
          tone="danger"
          icon={<Trash2 size={22} aria-hidden />}
          title={confirmDelete.length === 1 ? `Move ${confirmDelete[0].number} to trash?` : `Move ${confirmDelete.length} documents to trash?`}
          onClose={cancelTrash}
          footer={
            <>
              <button className="btn" onClick={cancelTrash}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmTrash} disabled={busyId !== null}>
                {busyId !== null ? 'Moving...' : 'Move to trash'}
              </button>
            </>
          }
        >
          The information will be saved in the Trash and can be restored if it is deleted accidentally. Nothing is permanently removed.
        </Modal>
      )}
      {trashSuccess && (
        <Modal
          label="Moved to trash"
          tone="success"
          title="Moved to trash"
          onClose={() => setTrashSuccess(null)}
          footer={<button className="btn btn-primary" onClick={() => setTrashSuccess(null)}>Thank you</button>}
        >
          {trashSuccess}
        </Modal>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Quotations show no amount here by design - their lines never carry a grand total. Removed documents go to the
        Trash and can be restored.
      </p>
    </section>
  );
}


const BADGE: Record<PaymentStatus, string> = {
  unpaid: 'bg-red-50 text-red-800 border-red-200',
  partial: 'bg-amber-50 text-amber-900 border-amber-200',
  paid: 'bg-green-50 text-green-800 border-green-200',
};

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-xs font-medium ${BADGE[status]}`}>{STATUS_LABEL[status]}</span>;
}
