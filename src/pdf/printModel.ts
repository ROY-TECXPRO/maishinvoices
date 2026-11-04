import { displayTotals, lineAmountCents } from '../domain/calc';
import { formatCtsColumn, formatKshsColumn, formatQuantity, formatUnitPrice } from '../domain/money';
import type { DocumentDraft } from '../domain/types';

export interface PrintRow {
  kind: 'item' | 'heading';
  qty: string;
  description: string;
  unitPrice: string;
  kshs: string;
  cts: string;
}
export interface SummaryRow {
  label: string;
  kshs: string;
  cts: string;
  strong: boolean;
}
export interface PrintModel {
  title: 'QUOTATION' | 'INVOICE';
  numberLabel: 'QUOTE No' | 'INVOICE No';
  number: string;
  orderNumber: string;
  customerName: string;
  contactLines: string[];
  dateDisplay: string;
  rows: PrintRow[];
  /** Empty for quotations. A quotation must never carry a grand total. */
  summary: SummaryRow[];
  terms: string[];
  notes: string[];
}

/** "2026-10-07" -> "7/10/2026" (day/month/year, as on the reference document). */
export function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
}

const splitLines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/**
 * Single source of truth for what is printed. The PDF renderer only draws this model, so
 * tests on the model prove what appears on the page (including "no total on quotations").
 */
export function buildPrintModel(doc: DocumentDraft): PrintModel {
  const isQuote = doc.type === 'quotation';
  const rows: PrintRow[] = doc.items.map((it) => {
    if (it.kind === 'heading') return { kind: 'heading', qty: '', description: it.description, unitPrice: '', kshs: '', cts: '' };
    const amount = lineAmountCents(it.quantity, it.unitPriceCents);
    return {
      kind: 'item',
      qty: formatQuantity(it.quantity),
      description: it.description,
      unitPrice: formatUnitPrice(it.unitPriceCents),
      kshs: formatKshsColumn(amount),
      cts: formatCtsColumn(amount),
    };
  });

  const summary: SummaryRow[] = [];
  const totals = displayTotals(doc);
  if (totals) {
    const row = (label: string, cents: number, strong = false): SummaryRow => ({
      label, kshs: formatKshsColumn(cents), cts: formatCtsColumn(cents), strong,
    });
    if (totals.discountCents > 0 || totals.taxCents > 0) summary.push(row('SUBTOTAL', totals.subtotalCents));
    if (totals.discountCents > 0) summary.push(row('DISCOUNT', -totals.discountCents));
    if (doc.tax && totals.taxCents > 0)
      summary.push(row(`${doc.tax.label.toUpperCase()} (${doc.tax.basisPoints / 100}%)`, totals.taxCents));
    summary.push(row('TOTAL', totals.totalCents, true));
  }

  return {
    title: isQuote ? 'QUOTATION' : 'INVOICE',
    numberLabel: isQuote ? 'QUOTE No' : 'INVOICE No',
    number: doc.number,
    orderNumber: doc.orderNumber,
    customerName: doc.customerName,
    contactLines: [doc.customerPhone, doc.customerEmail, doc.customerAddress].filter(Boolean),
    dateDisplay: formatDisplayDate(doc.issueDate),
    rows,
    summary,
    terms: splitLines(doc.paymentTerms),
    notes: splitLines(doc.notes),
  };
}
