import { calculateTotals, quotationInternalEstimateCents } from './calc';
import type { DocumentRecord, DocumentType } from './types';

/**
 * Reporting over saved DocumentRecords only. Inclusion rule: a document counts towards
 * invoiced figures when type === 'invoice' and status === 'active', grouped by issue date.
 * Quotations are reported separately and never added to invoiced totals. Invoiced amounts
 * are NOT money collected - payment tracking does not exist yet.
 */

export interface DayRow {
  /** YYYY-MM-DD */
  date: string;
  invoiceCount: number;
  invoicedCents: number;
  quotationCount: number;
  quotationEstimateCents: number;
}

export interface MonthRow {
  /** YYYY-MM-01 */
  month: string;
  invoiceCount: number;
  invoicedCents: number;
  quotationCount: number;
  quotationEstimateCents: number;
}

export interface YearRow {
  year: number;
  invoiceCount: number;
  invoicedCents: number;
  quotationCount: number;
  quotationEstimateCents: number;
}

export interface CustomerSummaryRow {
  customerId: string | null;
  customerName: string;
  invoiceCount: number;
  invoicedCents: number;
  quotationCount: number;
  quotationEstimateCents: number;
}

export interface RegisterRow {
  id: string;
  number: string;
  type: DocumentType;
  issueDate: string;
  customerName: string;
  status: DocumentRecord['status'];
  /** Invoices: grand total. Quotations: internal estimate (never shown on the document). */
  amountCents: number;
}

const activeOnly = (docs: DocumentRecord[]) => docs.filter((d) => d.status === 'active');

const amountOf = (d: DocumentRecord): number =>
  d.type === 'invoice'
    ? calculateTotals(d.items, d.discount, d.tax).totalCents
    : quotationInternalEstimateCents(d.items);

const monthKey = (isoDate: string) => isoDate.slice(0, 7);
const yearOf = (isoDate: string) => Number(isoDate.slice(0, 4));

function accumulate<K extends string>(
  docs: DocumentRecord[],
  keyOf: (d: DocumentRecord) => K,
): Record<K, DayRow> {
  const out = {} as Record<K, DayRow>;
  for (const d of activeOnly(docs)) {
    const k = keyOf(d);
    const row =
      out[k] ??
      (out[k] = { date: k, invoiceCount: 0, invoicedCents: 0, quotationCount: 0, quotationEstimateCents: 0 });
    if (d.type === 'invoice') {
      row.invoiceCount += 1;
      row.invoicedCents += amountOf(d);
    } else {
      row.quotationCount += 1;
      row.quotationEstimateCents += amountOf(d);
    }
  }
  return out;
}

const sortedValues = <T>(m: Record<string, T>): T[] =>
  Object.keys(m)
    .sort()
    .map((k) => m[k]);

/** One row per day within [from, to] (ISO dates, inclusive), including empty days. */
export function dailyReport(docs: DocumentRecord[], from: string, to: string): DayRow[] {
  const byDay = accumulate(docs, (d) => d.issueDate);

  const rows: DayRow[] = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (let t = new Date(`${from}T00:00:00Z`); t <= end; t.setUTCDate(t.getUTCDate() + 1)) {
    const key = t.toISOString().slice(0, 10);
    rows.push(
      byDay[key] ?? { date: key, invoiceCount: 0, invoicedCents: 0, quotationCount: 0, quotationEstimateCents: 0 },
    );
  }
  return rows;
}

/** Months with any activity in the given year, padded to all 12 months. */
export function monthlyReport(docs: DocumentRecord[], year: number): MonthRow[] {
  const byMonth = accumulate(docs, (d) => monthKey(d.issueDate));
  const rows: MonthRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const r = byMonth[key];
    rows.push({
      month: `${key}-01`,
      invoiceCount: r?.invoiceCount ?? 0,
      invoicedCents: r?.invoicedCents ?? 0,
      quotationCount: r?.quotationCount ?? 0,
      quotationEstimateCents: r?.quotationEstimateCents ?? 0,
    });
  }
  return rows;
}

/** Same shape as MonthRow but grouped by calendar year, sorted ascending. */
export function annualReport(docs: DocumentRecord[]): YearRow[] {
  const byYear = accumulate(docs, (d) => String(yearOf(d.issueDate)));
  return sortedValues(byYear)
    .map((r) => ({
      year: Number(r.date.slice(0, 4)),
      invoiceCount: r.invoiceCount,
      invoicedCents: r.invoicedCents,
      quotationCount: r.quotationCount,
      quotationEstimateCents: r.quotationEstimateCents,
    }))
    .sort((a, b) => a.year - b.year);
}

export function summarizeRange(docs: DocumentRecord[], from: string, to: string) {
  const rows = dailyReport(docs, from, to).filter((r) => r.invoiceCount || r.quotationCount);
  return rows.reduce(
    (acc, r) => ({
      invoiceCount: acc.invoiceCount + r.invoiceCount,
      invoicedCents: acc.invoicedCents + r.invoicedCents,
      quotationCount: acc.quotationCount + r.quotationCount,
      quotationEstimateCents: acc.quotationEstimateCents + r.quotationEstimateCents,
    }),
    { invoiceCount: 0, invoicedCents: 0, quotationCount: 0, quotationEstimateCents: 0 },
  );
}

export function customerSummaries(docs: DocumentRecord[]): CustomerSummaryRow[] {
  const map = new Map<string, CustomerSummaryRow>();
  for (const d of activeOnly(docs)) {
    const key = d.customerId ?? d.customerName.trim().toLowerCase();
    const row =
      map.get(key) ??
      ({
        customerId: d.customerId,
        customerName: d.customerName,
        invoiceCount: 0,
        invoicedCents: 0,
        quotationCount: 0,
        quotationEstimateCents: 0,
      } satisfies CustomerSummaryRow);
    if (d.type === 'invoice') {
      row.invoiceCount += 1;
      row.invoicedCents += amountOf(d);
    } else {
      row.quotationCount += 1;
      row.quotationEstimateCents += amountOf(d);
    }
    if (d.customerName) row.customerName = d.customerName;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.invoicedCents - a.invoicedCents);
}

/** Searchable register rows (amounts follow the same rules as amountOf). */
export function registerRows(docs: DocumentRecord[], type?: DocumentType): RegisterRow[] {
  return activeOnly(docs)
    .filter((d) => !type || d.type === type)
    .map((d) => ({
      id: d.id,
      number: d.number,
      type: d.type,
      issueDate: d.issueDate,
      customerName: d.customerName,
      status: d.status,
      amountCents: amountOf(d),
    }))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number));
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

