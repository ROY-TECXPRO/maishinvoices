import { useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { useRepository } from '../data/RepositoryContext';
import { useLive } from '../hooks/useLive';
import {
  MONTH_NAMES,
  annualReport,
  customerSummaries,
  dailyReport,
  monthlyReport,
  registerRows,
  summarizeRange,
  type DayRow,
  type RegisterRow,
} from '../domain/reports';
import { formatMoney } from '../domain/money';
import { FiguresLock, FiguresToggle } from '../auth/FiguresContext';
import type { DocumentType } from '../domain/types';
import { downloadCsv } from '../export/csv';
import { renderReportPdf, reportPdfFileName, type ReportTable } from '../pdf/reportPdf';
import { DataTable, type Column } from '../components/DataTable';

type Scope = 'monthly' | 'daily' | 'annual' | 'customers' | 'register';

interface PeriodRow {
  key: string;
  label: string;
  invoiceCount: number;
  invoicedCents: number;
  quotationCount: number;
  quotationEstimateCents: number;
}

const isoToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());

const monthName = (monthKey: string) => MONTH_NAMES[Number(monthKey.slice(5, 7)) - 1];

export function ReportsPage() {
  return (
    <FiguresLock title="Reports">
      <ReportsContent />
    </FiguresLock>
  );
}

function ReportsContent() {
  const repo = useRepository();
  const today = isoToday();
  const [scope, setScope] = useState<Scope>('monthly');
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [registerType, setRegisterType] = useState<DocumentType | ''>('');
  const [registerSearch, setRegisterSearch] = useState('');

  const { data: docs, error, loading } = useLive(() => repo.listDocuments(), ['documents']);
  const all = docs ?? [];

  const dailyRows = useMemo(
    () => (scope === 'daily' ? dailyReport(all, from, to) : []),
    [scope, all, from, to],
  );
  const monthRows = useMemo(() => (scope === 'monthly' ? monthlyReport(all, year) : []), [scope, all, year]);
  const yearRows = useMemo(() => (scope === 'annual' ? annualReport(all) : []), [scope, all]);
  const customerRows = useMemo(() => (scope === 'customers' ? customerSummaries(all) : []), [scope, all]);
  const register = useMemo(
    () =>
      scope === 'register'
        ? registerRows(all, registerType || undefined).filter((r) => {
            const q = registerSearch.trim().toLowerCase();
            return !q || r.number.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q);
          })
        : [],
    [scope, all, registerType, registerSearch],
  );

  const dayActive = dailyRows.filter((r: DayRow) => r.invoiceCount || r.quotationCount);

  function buildTable(): { csv: (string | number)[][]; pdf: ReportTable } | null {
    if (scope === 'monthly') {
      const csv: (string | number)[][] = [
        ['Month', 'Invoices', 'Invoiced KSh', 'Quotations', 'Quotation estimate KSh'],
        ...monthRows.map((m) => [monthName(m.month), m.invoiceCount, (m.invoicedCents / 100).toFixed(2), m.quotationCount, (m.quotationEstimateCents / 100).toFixed(2)]),
      ];
      const totals = summarizeRange(all, `${year}-01-01`, `${year}-12-31`);
      return {
        csv,
        pdf: {
          title: `Monthly invoicing report ${year}`,
          subtitle: 'Grouped by document issue date. Quotations excluded from invoiced totals.',
          columns: [
            { header: 'Month', width: 45 },
            { header: 'Invoices', align: 'right', width: 25 },
            { header: 'Invoiced', align: 'right', width: 40 },
            { header: 'Quotations', align: 'right', width: 30 },
            { header: 'Quote estimate', align: 'right', width: 40 },
          ],
          rows: monthRows.map((m) => [
            monthName(m.month),
            m.invoiceCount,
            formatMoney(m.invoicedCents),
            m.quotationCount,
            formatMoney(m.quotationEstimateCents),
          ]),
          totals: [
            { label: `Total invoiced ${year}`, value: formatMoney(totals.invoicedCents) },
            { label: `Quotation estimate ${year} (not revenue)`, value: formatMoney(totals.quotationEstimateCents) },
          ],
        },
      };
    }
    if (scope === 'daily') {
      const csv: (string | number)[][] = [
        ['Date', 'Invoices', 'Invoiced KSh', 'Quotations', 'Quotation estimate KSh'],
        ...dailyRows.map((r) => [r.date, r.invoiceCount, (r.invoicedCents / 100).toFixed(2), r.quotationCount, (r.quotationEstimateCents / 100).toFixed(2)]),
      ];
      const totals = summarizeRange(all, from, to);
      return {
        csv,
        pdf: {
          title: `Invoice report ${from} to ${to}`,
          subtitle: 'One row per day by issue date.',
          columns: [
            { header: 'Date', width: 40 },
            { header: 'Invoices', align: 'right', width: 25 },
            { header: 'Invoiced', align: 'right', width: 40 },
            { header: 'Quotations', align: 'right', width: 30 },
            { header: 'Quote estimate', align: 'right', width: 40 },
          ],
          rows: dayActive.map((r) => [r.date, r.invoiceCount, formatMoney(r.invoicedCents), r.quotationCount, formatMoney(r.quotationEstimateCents)]),
          totals: [
            { label: 'Invoiced in range', value: formatMoney(totals.invoicedCents) },
            { label: 'Quotation estimate in range (not revenue)', value: formatMoney(totals.quotationEstimateCents) },
          ],
        },
      };
    }
    if (scope === 'annual') {
      const csv = [
        ['Year', 'Invoices', 'Invoiced KSh', 'Quotations', 'Quotation estimate KSh'],
        ...yearRows.map((y) => [String(y.year), y.invoiceCount, (y.invoicedCents / 100).toFixed(2), y.quotationCount, (y.quotationEstimateCents / 100).toFixed(2)]),
      ];
      const allInvoiced = yearRows.reduce((s, y) => s + y.invoicedCents, 0);
      const allQuotes = yearRows.reduce((s, y) => s + y.quotationEstimateCents, 0);
      return {
        csv,
        pdf: {
          title: 'Annual invoicing report',
          subtitle: 'Invoiced totals are issued invoices, not payments received. Quotations are excluded from invoiced totals.',
          columns: [
            { header: 'Year', width: 40 },
            { header: 'Invoices', align: 'right', width: 25 },
            { header: 'Invoiced', align: 'right', width: 40 },
            { header: 'Quotations', align: 'right', width: 30 },
            { header: 'Quote estimate', align: 'right', width: 40 },
          ],
          rows: yearRows.map((y) => [String(y.year), y.invoiceCount, formatMoney(y.invoicedCents), y.quotationCount, formatMoney(y.quotationEstimateCents)]),
          totals: [
            { label: 'Total invoiced', value: formatMoney(allInvoiced) },
            { label: 'Quotation estimate (not revenue)', value: formatMoney(allQuotes) },
          ],
        },
      };
    }
    if (scope === 'customers') {
      const csv = [
        ['Customer', 'Invoices', 'Invoiced KSh', 'Quotations', 'Quote estimate KSh'],
        ...customerRows.map((c) => [c.customerName, c.invoiceCount, (c.invoicedCents / 100).toFixed(2), c.quotationCount, (c.quotationEstimateCents / 100).toFixed(2)]),
      ];
      const totalInvoiced = customerRows.reduce((s, c) => s + c.invoicedCents, 0);
      return {
        csv,
        pdf: {
          title: 'Customer summary',
          subtitle: 'By customer. Invoices are counted for active documents only.',
          columns: [
            { header: 'Customer', width: 90 },
            { header: 'Invoices', align: 'right', width: 25 },
            { header: 'Invoiced', align: 'right', width: 40 },
            { header: 'Quotations', align: 'right', width: 30 },
            { header: 'Quote estimate', align: 'right', width: 40 },
          ],
          rows: customerRows.map((c) => [c.customerName, c.invoiceCount, formatMoney(c.invoicedCents), c.quotationCount, formatMoney(c.quotationEstimateCents)]),
          totals: [{ label: 'Total invoiced', value: formatMoney(totalInvoiced) }],
        },
      };
    }
    return null;
  }

  const periodRows: PeriodRow[] = useMemo(() => {
    if (scope === 'monthly') return monthRows.map((m) => ({ key: m.month, label: monthName(m.month), invoiceCount: m.invoiceCount, invoicedCents: m.invoicedCents, quotationCount: m.quotationCount, quotationEstimateCents: m.quotationEstimateCents }));
    if (scope === 'daily') return dayActive.map((r) => ({ key: r.date, label: r.date, invoiceCount: r.invoiceCount, invoicedCents: r.invoicedCents, quotationCount: r.quotationCount, quotationEstimateCents: r.quotationEstimateCents }));
    if (scope === 'annual') return yearRows.map((y) => ({ key: String(y.year), label: String(y.year), invoiceCount: y.invoiceCount, invoicedCents: y.invoicedCents, quotationCount: y.quotationCount, quotationEstimateCents: y.quotationEstimateCents }));
    if (scope === 'customers') return customerRows.map((c) => ({ key: c.customerId ?? c.customerName, label: c.customerName, invoiceCount: c.invoiceCount, invoicedCents: c.invoicedCents, quotationCount: c.quotationCount, quotationEstimateCents: c.quotationEstimateCents }));
    return [];
  }, [scope, monthRows, dayActive, yearRows, customerRows]);

  const periodColumns: Column<PeriodRow>[] = useMemo(() => {
    const first = scope === 'monthly' ? 'Month' : scope === 'daily' ? 'Date' : scope === 'annual' ? 'Year' : 'Customer';
    const sum = (f: (r: PeriodRow) => number) => (rows: PeriodRow[]) => rows.reduce((s, r) => s + f(r), 0);
    return [
      { key: 'label', label: first, kind: 'text', get: (r) => r.label },
      { key: 'invoiceCount', label: 'Invoices', kind: 'count', get: (r) => r.invoiceCount, total: sum((r) => r.invoiceCount) },
      { key: 'invoicedCents', label: 'Invoiced', kind: 'money', get: (r) => r.invoicedCents, bar: true, total: sum((r) => r.invoicedCents) },
      { key: 'quotationCount', label: 'Quotations', kind: 'count', get: (r) => r.quotationCount, total: sum((r) => r.quotationCount) },
      { key: 'quotationEstimateCents', label: 'Quote estimate', kind: 'money', muted: true, get: (r) => r.quotationEstimateCents, total: sum((r) => r.quotationEstimateCents) },
    ];
  }, [scope]);

  const registerColumns: Column<RegisterRow>[] = useMemo(() => [
    { key: 'number', label: 'Number', kind: 'text', get: (r) => r.number, render: (r) => <span className="font-medium">{r.number}</span> },
    { key: 'customerName', label: 'Customer', kind: 'text', get: (r) => r.customerName },
    { key: 'type', label: 'Type', kind: 'text', get: (r) => r.type, render: (r) => <span className="capitalize">{r.type}</span> },
    { key: 'issueDate', label: 'Date', kind: 'text', get: (r) => r.issueDate },
    {
      key: 'amountCents', label: 'Amount', kind: 'money', bar: true, get: (r) => r.amountCents,
      total: (rows) => rows.filter((r) => r.type === 'invoice').reduce((s, r) => s + r.amountCents, 0),
    },
  ], []);

  const table = buildTable();

  function exportCsv() {
    if (!table) return;
    downloadCsv(`maish-${scope}-${scope === 'monthly' ? year : `${from}-${to}`}`, table.csv);
  }
  function exportPdf() {
    if (!table) return;
    const doc = renderReportPdf(table.pdf);
    doc.save(reportPdfFileName(table.pdf.title));
  }

  function exportRegisterCsv() {
    downloadCsv('maish-register', [
      ['Number', 'Type', 'Issue date', 'Customer', 'Amount KSh'],
      ...register.map((r) => [r.number, r.type, r.issueDate, r.customerName, (r.amountCents / 100).toFixed(2)]),
    ]);
  }

  return (
    <section aria-labelledby="rep-h">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="rep-h" className="text-xl font-semibold">Reports</h1>
          <p className="mt-1 text-sm text-slate-600">
            Built from saved records by issue date. Invoiced totals are issued invoices - not money collected.
            Quotations are always reported separately and never counted as invoices.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FiguresToggle />
          {table && scope !== 'register' && (
            <>
              <button className="btn" onClick={exportCsv}><Download size={15} aria-hidden /> CSV</button>
              <button className="btn" onClick={exportPdf}><FileText size={15} aria-hidden /> PDF</button>
            </>
          )}
          {scope === 'register' && (
            <button className="btn" onClick={exportRegisterCsv}><Download size={15} aria-hidden /> CSV</button>
          )}
          {scope === 'customers' && (
            <button
              className="btn"
              onClick={() =>
                downloadCsv('maish-customer-summary', [
                  ['Customer', 'Invoices', 'Invoiced KSh', 'Quotations', 'Quote estimate KSh'],
                  ...customerRows.map((c) => [
                    c.customerName,
                    c.invoiceCount,
                    (c.invoicedCents / 100).toFixed(2),
                    c.quotationCount,
                    (c.quotationEstimateCents / 100).toFixed(2),
                  ]),
                ])
              }
            >
              <Download size={15} aria-hidden /> CSV
            </button>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          Report
          <select className="field mt-1 w-auto" value={scope} onChange={(e) => setScope(e.target.value as Scope)} aria-label="Report type">
            <option value="monthly">Monthly invoicing</option>
            <option value="daily">Daily / custom range</option>
            <option value="annual">Annual</option>
            <option value="customers">By customer</option>
            <option value="register">Document register</option>
          </select>
        </label>
        {scope === 'monthly' && (
          <label className="text-xs text-slate-600">
            Year
            <select className="field mt-1 w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[0, 1, 2, 3].map((offset) => (
                <option key={offset} value={Number(today.slice(0, 4)) - offset}>
                  {Number(today.slice(0, 4)) - offset}
                </option>
              ))}
            </select>
          </label>
        )}
        {scope === 'daily' && (
          <>
            <label className="text-xs text-slate-600">
              From
              <input type="date" className="field mt-1 w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="text-xs text-slate-600">
              To
              <input type="date" className="field mt-1 w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        )}
        {scope === 'register' && (
          <>
            <label className="text-xs text-slate-600">
              Type
              <select className="field mt-1 w-auto" value={registerType} onChange={(e) => setRegisterType(e.target.value as DocumentType | '')}>
                <option value="">All</option>
                <option value="invoice">Invoices</option>
                <option value="quotation">Quotations</option>
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Search
              <input className="field mt-1" placeholder="Number or customer" value={registerSearch} onChange={(e) => setRegisterSearch(e.target.value)} />
            </label>
          </>
        )}
      </div>

      {error && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loading && !docs && <p className="text-sm text-slate-500">Loading records...</p>}

      {scope === 'register' ? (
        <DataTable label="Document register" columns={registerColumns} rows={register} rowKey={(r) => r.id} emptyText="Nothing matches this register filter." totalLabel="Invoiced total (invoices only)" />
      ) : (
        <DataTable
          label="Report table"
          columns={periodColumns}
          rows={periodRows}
          rowKey={(r) => r.key}
          emptyText={scope === 'daily' ? 'No documents issued in this range.' : 'Nothing to show.'}
        />
      )}
      <p className="mt-2 text-xs text-slate-500">
        Quotation amounts shown here are internal estimates for workload planning only - the printed quotation never
        contains a total, and these figures must never be counted as invoice revenue.
      </p>
    </section>
  );
}
