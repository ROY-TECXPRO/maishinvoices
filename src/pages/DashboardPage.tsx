import { Link } from 'react-router-dom';
import { ArrowRight, FilePlus2 } from 'lucide-react';
import { useRepository } from '../data/RepositoryContext';
import { useLive } from '../hooks/useLive';
import { FiguresToggle, useFigures } from '../auth/FiguresContext';
import { useCompanySettings } from '../config/SettingsContext';
import { DEFAULT_OVERDUE_DAYS, outstandingInvoices } from '../domain/payments';
import { DashboardAccessScreen } from './DashboardAccessScreen';
import { calculateTotals, quotationInternalEstimateCents } from '../domain/calc';
import { formatMoney } from '../domain/money';
import { MONTH_NAMES, dailyReport } from '../domain/reports';
import type { Customer, DocumentRecord } from '../domain/types';
import { formatDisplayDate } from '../pdf/printModel';

/** Today's calendar date in Africa/Nairobi (issue dates are plain calendar dates). */
function todayNairobi(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function DashboardPage() {
  const repo = useRepository();
  const { data, error, loading } = useLive(
    async () => ({
      documents: await repo.listDocuments(),
      customers: await repo.listCustomers(),
      payments: await repo.listPayments(),
    }),
    ['documents', 'customers', 'payments'],
  );

  const docs = data?.documents ?? [];
  const customers: Customer[] = data?.customers ?? [];
  const today = todayNairobi();
  const year = today.slice(0, 4);
  const monthStart = `${year}-${today.slice(5, 7)}-01`;

  const invoiceTotal = (list: DocumentRecord[]) =>
    list.reduce(
      (sum, d) => (d.type === 'invoice' ? sum + calculateTotals(d.items, d.discount, d.tax).totalCents : sum),
      0,
    );

  const monthDocs = docs.filter((d) => d.issueDate >= monthStart && d.issueDate <= today);
  const monthInvoices = monthDocs.filter((d) => d.type === 'invoice');
  const monthQuotations = monthDocs.filter((d) => d.type === 'quotation');
  const yearDocs = docs.filter((d) => d.issueDate.slice(0, 4) === year);
  const yearInvoiced = invoiceTotal(yearDocs);
  const dayRows = dailyReport(docs, monthStart, today).filter((r) => r.invoiceCount || r.quotationCount);

  const recent = [...docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);

  const { revealed: figuresRevealed } = useFigures();
  const { settings } = useCompanySettings();
  const owed = outstandingInvoices(docs, data?.payments ?? [], today, settings.overdueAfterDays ?? DEFAULT_OVERDUE_DAYS);
  const owedTotal = owed.reduce((s, r) => s + r.summary.balanceCents, 0);
  const overdueCount = owed.filter((r) => r.overdue).length;

  return (
    <>
      <DashboardAccessScreen />
      <section aria-labelledby="dash-h">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 id="dash-h" className="text-xl font-semibold">Dashboard</h1>
        <div className="flex gap-2">
          <Link to="/documents/new?type=quotation" className="btn"><FilePlus2 size={15} aria-hidden /> New quotation</Link>
          <Link to="/documents/new?type=invoice" className="btn btn-primary"><FilePlus2 size={15} aria-hidden /> New invoice</Link>
          <FiguresToggle />
        </div>
      </div>

      {error && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loading && !data && <p className="text-sm text-slate-500">Loading summary...</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={`Invoiced in ${MONTH_NAMES[Number(today.slice(5, 7)) - 1]} (to date)`}
          value={figuresRevealed ? formatMoney(invoiceTotal(monthInvoices)) : '••••'}
          hint={figuresRevealed ? `${monthInvoices.length} invoices issued so far - not collected` : 'Hidden'}
        />
        <Stat
          label={`Invoiced in ${year} (year to date)`}
          value={figuresRevealed ? formatMoney(yearInvoiced) : '••••'}
          hint={figuresRevealed ? `${yearDocs.filter((d) => d.type === 'invoice').length} invoices` : 'Hidden'}
        />
        <Stat
          label={`${MONTH_NAMES[Number(today.slice(5, 7)) - 1]} quotations`}
          value={figuresRevealed ? String(monthQuotations.length) : '••••'}
          hint={figuresRevealed ? `${formatMoney(monthQuotations.reduce((s, d) => s + quotationInternalEstimateCents(d.items), 0))} estimate (not revenue)` : 'Hidden'}
        />
        <Stat label="Customers" value={figuresRevealed ? String(customers.length) : '••••'} hint={figuresRevealed ? `${docs.length} active documents in total` : 'Hidden'} />
        <Stat
          label="Money still owed"
          value={figuresRevealed ? formatMoney(owedTotal) : '••••'}
          hint={figuresRevealed ? `${owed.length} unpaid or part-paid invoice${owed.length === 1 ? '' : 's'}` : 'Hidden'}
        />
        <Stat
          label="Overdue invoices"
          value={figuresRevealed ? String(overdueCount) : '••••'}
          hint={figuresRevealed ? `Unpaid for ${settings.overdueAfterDays ?? DEFAULT_OVERDUE_DAYS}+ days` : 'Hidden'}
        />
        <Link to="/outstanding" className="flex items-center justify-center rounded border border-slate-200 bg-white p-4 text-sm font-medium text-brand-700 hover:bg-slate-50">
          Open outstanding invoices <ArrowRight size={14} className="ml-1" aria-hidden />
        </Link>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="rounded border border-slate-200 bg-white p-4" aria-label="Recent documents">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recently updated</h2>
            <Link className="text-xs font-medium text-brand-700 hover:underline" to="/documents">
              All documents <ArrowRight size={12} className="inline" aria-hidden />
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No documents yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {recent.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                  <Link className="font-medium text-brand-700 hover:underline" to={`/documents/${d.id}`}>{d.number}</Link>
                  <span className="min-w-0 flex-1 truncate px-2 text-slate-600">{d.customerName}</span>
                  <span className="tabular-nums text-slate-500">
                    {!figuresRevealed ? '••••' : d.type === 'invoice' ? formatMoney(calculateTotals(d.items, d.discount, d.tax).totalCents) : 'Quotation'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded border border-slate-200 bg-white p-4" aria-label="Activity this month">
          <h2 className="mb-2 text-sm font-semibold">Activity this month</h2>
          {dayRows.length === 0 ? (
            <p className="text-sm text-slate-500">No documents issued so far this month.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {dayRows.map((r) => (
                <li key={r.date} className="flex justify-between gap-2 tabular-nums">
                  <span className="text-slate-600">{formatDisplayDate(r.date)}</span>
                  <span className="text-slate-700">{figuresRevealed ? `${r.invoiceCount} inv / ${r.quotationCount} qt` : '••••'}</span>
                  <span className="font-medium">{figuresRevealed ? formatMoney(r.invoicedCents) : '••••'}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Invoiced amounts are issued invoice totals - they are NOT payments received. Quotations are counted
            separately and never included in invoiced totals.
          </p>
        </section>
      </div>
    </section>

    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat-card rounded border border-slate-200 bg-white p-4" data-accent={/owed|overdue/i.test(label) ? 'red' : 'blue'}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-brand-700">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

