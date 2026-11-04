import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, HandCoins } from 'lucide-react';
import { useRepository } from '../data/RepositoryContext';
import { useLive } from '../hooks/useLive';
import { useCompanySettings } from '../config/SettingsContext';
import { FiguresLock, FiguresToggle, Money } from '../auth/FiguresContext';
import { DEFAULT_OVERDUE_DAYS, outstandingInvoices, whatsappLink, whatsappPhone } from '../domain/payments';
import { formatMoney } from '../domain/money';
import { formatDisplayDate } from '../pdf/printModel';
import { PaymentBadge } from './DocumentsPage';

const todayNairobi = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function OutstandingPage() {
  return (
    <FiguresLock title="Outstanding invoices">
      <OutstandingContent />
    </FiguresLock>
  );
}

function OutstandingContent() {
  const repo = useRepository();
  const { settings } = useCompanySettings();
  const [overdueOnly, setOverdueOnly] = useState(false);
  const overdueDays = settings.overdueAfterDays ?? DEFAULT_OVERDUE_DAYS;
  const { data, error, loading } = useLive(
    async () => ({
      documents: await repo.listDocuments(),
      payments: await repo.listPayments(),
      customers: await repo.listCustomers(),
    }),
    ['documents', 'payments', 'customers'],
  );

  const rows = outstandingInvoices(data?.documents ?? [], data?.payments ?? [], todayNairobi(), overdueDays);
  const shown = overdueOnly ? rows.filter((r) => r.overdue) : rows;
  const total = rows.reduce((s, r) => s + r.summary.balanceCents, 0);
  const overdueRows = rows.filter((r) => r.overdue);
  const overdueTotal = overdueRows.reduce((s, r) => s + r.summary.balanceCents, 0);
  const phoneOf = (customerId: string | null, fallback: string) =>
    data?.customers.find((c) => c.id === customerId)?.phone || fallback;

  return (
    <section aria-labelledby="out-h">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 id="out-h" className="text-xl font-semibold">Outstanding invoices</h1>
        <FiguresToggle />
      </div>

      {error && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Money still owed</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(total)}</div>
          <div className="text-xs text-slate-500">{rows.length} invoice{rows.length === 1 ? '' : 's'}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Overdue ({overdueDays}+ days)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-red-700">{formatMoney(overdueTotal)}</div>
          <div className="text-xs text-slate-500">{overdueRows.length} invoice{overdueRows.length === 1 ? '' : 's'}</div>
        </div>
        <label className="flex items-center gap-2 rounded border border-slate-200 bg-white p-4 text-sm">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          Show overdue only
        </label>
      </div>

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">Invoice</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Issued</th>
              <th className="px-3 py-2 text-right font-medium">Days</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && <tr><td className="px-3 py-6 text-slate-500" colSpan={7}>Loading...</td></tr>}
            {data && shown.length === 0 && (
              <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={7}>
                {overdueOnly ? 'No overdue invoices.' : 'Nothing is owed. Every invoice is paid.'}
              </td></tr>
            )}
            {shown.map((r) => {
              const phone = whatsappPhone(phoneOf(r.doc.customerId, r.doc.customerPhone));
              const text =
                `Hello ${r.doc.customerName}, this is a friendly reminder that invoice ${r.doc.number} ` +
                `dated ${formatDisplayDate(r.doc.issueDate)} has a balance of ${formatMoney(r.summary.balanceCents)} outstanding. ` +
                `Kindly arrange payment. Thank you. - ${settings.nameLine1} ${settings.nameLine2}`;
              return (
                <tr key={r.doc.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2"><Link className="font-medium text-brand-700 hover:underline" to={`/documents/${r.doc.id}`}>{r.doc.number}</Link></td>
                  <td className="px-3 py-2">{r.doc.customerName}</td>
                  <td className="px-3 py-2">{formatDisplayDate(r.doc.issueDate)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.overdue ? 'font-semibold text-red-700' : ''}`}>
                    {r.daysOutstanding}{r.overdue ? ' - overdue' : ''}
                  </td>
                  <td className="px-3 py-2"><PaymentBadge status={r.summary.status} /></td>
                  <td className="px-3 py-2 text-right tabular-nums"><Money cents={r.summary.balanceCents} /></td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Link className="icon-btn" title="Record a payment" aria-label={`Record payment for ${r.doc.number}`} to={`/documents/${r.doc.id}`}>
                        <HandCoins size={15} />
                      </Link>
                      <a
                        className="icon-btn"
                        title={phone ? 'Send a WhatsApp reminder' : 'WhatsApp reminder (no phone number saved: choose the contact in WhatsApp)'}
                        aria-label={`WhatsApp reminder for ${r.doc.number}`}
                        href={whatsappLink(phone, text)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircle size={15} />
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
