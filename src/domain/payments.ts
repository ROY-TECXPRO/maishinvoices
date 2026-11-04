import { calculateTotals } from './calc';
import type { DocumentRecord, Payment } from './types';

export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  partial: 'Part paid',
  paid: 'Paid',
};

export const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  mpesa: 'M-Pesa',
  bank: 'Bank',
  cheque: 'Cheque',
  other: 'Other',
};

/** Invoices unpaid for this many days are flagged overdue (administrator can change it in Settings). */
export const DEFAULT_OVERDUE_DAYS = 30;

export interface PaymentSummary {
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  status: PaymentStatus;
}

export function summarizePayment(totalCents: number, payments: Pick<Payment, 'amountCents'>[]): PaymentSummary {
  const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
  const balanceCents = Math.max(totalCents - paidCents, 0);
  const status: PaymentStatus = paidCents <= 0 ? 'unpaid' : balanceCents === 0 ? 'paid' : 'partial';
  return { totalCents, paidCents, balanceCents, status };
}

export function paymentsByDocument(payments: Payment[]): Map<string, Payment[]> {
  const map = new Map<string, Payment[]>();
  for (const p of payments) {
    const list = map.get(p.documentId);
    if (list) list.push(p); else map.set(p.documentId, [p]);
  }
  return map;
}

export function invoiceSummary(doc: DocumentRecord, payments: Payment[]): PaymentSummary {
  return summarizePayment(calculateTotals(doc.items, doc.discount, doc.tax).totalCents, payments);
}

/** Whole days from one ISO date (YYYY-MM-DD) to another. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export interface OutstandingRow {
  doc: DocumentRecord;
  summary: PaymentSummary;
  daysOutstanding: number;
  overdue: boolean;
}

/** Active invoices with a balance still owed, oldest first. */
export function outstandingInvoices(
  docs: DocumentRecord[],
  payments: Payment[],
  todayIso: string,
  overdueDays: number = DEFAULT_OVERDUE_DAYS,
): OutstandingRow[] {
  const by = paymentsByDocument(payments);
  return docs
    .filter((d) => d.type === 'invoice' && d.status === 'active')
    .map((doc) => {
      const summary = invoiceSummary(doc, by.get(doc.id) ?? []);
      const daysOutstanding = Math.max(daysBetween(doc.issueDate, todayIso), 0);
      return { doc, summary, daysOutstanding, overdue: daysOutstanding >= overdueDays };
    })
    .filter((r) => r.summary.balanceCents > 0)
    .sort((a, b) => a.doc.issueDate.localeCompare(b.doc.issueDate));
}

/** Kenyan-friendly WhatsApp number (digits only, country code first), or null if it cannot be one. */
export function whatsappPhone(raw: string): string | null {
  let d = (raw ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 10) d = `254${d.slice(1)}`;
  else if ((d.startsWith('7') || d.startsWith('1')) && d.length === 9) d = `254${d}`;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

export function whatsappLink(phone: string | null, text: string): string {
  const base = phone ? `https://wa.me/${phone}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(text)}`;
}
