import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { useRepository } from '../data/RepositoryContext';
import { useLive } from '../hooks/useLive';
import { calculateTotals } from '../domain/calc';
import { formatMoney, parseMoneyToCents, centsToInput } from '../domain/money';
import { METHOD_LABEL, STATUS_LABEL, summarizePayment } from '../domain/payments';
import { formatDisplayDate } from '../pdf/printModel';
import type { DocumentRecord, PaymentMethod } from '../domain/types';

const todayNairobi = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Money received against one saved invoice: status, balance, payment list and the "add payment" form. */
export function PaymentsPanel({ record }: { record: DocumentRecord }) {
  const repo = useRepository();
  const { data, reload } = useLive(() => repo.listPayments(), ['payments']);
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(todayNairobi());
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mine = (data ?? []).filter((p) => p.documentId === record.id);
  const total = calculateTotals(record.items, record.discount, record.tax).totalCents;
  const s = summarizePayment(total, mine);

  async function add(e: FormEvent) {
    e.preventDefault();
    const cents = parseMoneyToCents(amount);
    if (cents === null || cents <= 0) { setError('Enter the amount received, for example 5000 or 5,000.50.'); return; }
    setBusy(true);
    setError('');
    try {
      await repo.addPayment({ documentId: record.id, amountCents: cents, paidOn, method, note });
      setAmount('');
      setNote('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the payment.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Remove this payment? The balance owed will go back up.')) return;
    setBusy(true);
    setError('');
    try {
      await repo.deletePayment(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the payment.');
    } finally {
      setBusy(false);
    }
  }

  const tone = s.status === 'paid' ? 'text-green-800' : s.status === 'partial' ? 'text-amber-900' : 'text-red-800';

  return (
    <section className="mt-4 rounded border border-slate-200 bg-white p-4" aria-label="Payments">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Payments</h2>
        <span className={`text-sm font-semibold ${tone}`} aria-label="Payment status">{STATUS_LABEL[s.status]}</span>
      </div>
      <dl className="mt-2 grid max-w-sm grid-cols-2 gap-y-1 text-sm">
        <dt className="text-slate-600">Invoice total</dt><dd className="text-right tabular-nums">{formatMoney(s.totalCents)}</dd>
        <dt className="text-slate-600">Paid so far</dt><dd className="text-right tabular-nums">{formatMoney(s.paidCents)}</dd>
        <dt className="font-medium">Balance owed</dt><dd className="text-right font-semibold tabular-nums" aria-label="Balance owed">{formatMoney(s.balanceCents)}</dd>
      </dl>

      {mine.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {mine.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>{formatDisplayDate(p.paidOn)} - {METHOD_LABEL[p.method] ?? p.method}{p.note ? ` - ${p.note}` : ''}</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{formatMoney(p.amountCents)}</span>
                <button type="button" className="icon-btn" title="Remove this payment" aria-label={`Remove payment of ${formatMoney(p.amountCents)}`} disabled={busy} onClick={() => void remove(p.id)}>
                  <Trash2 size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {s.balanceCents > 0 && (
        <form className="mt-3 grid gap-2 sm:grid-cols-[8rem_9rem_8rem_1fr_auto] sm:items-end" onSubmit={(e) => void add(e)}>
          <div>
            <label className="label" htmlFor="pay-amount">Amount received (KSh)</label>
            <input id="pay-amount" className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={centsToInput(s.balanceCents)} />
          </div>
          <div>
            <label className="label" htmlFor="pay-date">Date</label>
            <input id="pay-date" type="date" className="field" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="pay-method">Method</label>
            <select id="pay-method" className="field" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="pay-note">Note (optional)</label>
            <input id="pay-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. M-Pesa code" />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn" disabled={busy} onClick={() => setAmount(centsToInput(s.balanceCents))}>Full balance</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Record payment'}</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}
