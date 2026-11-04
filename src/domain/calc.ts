import type { Cents } from './money';
import type { DiscountSpec, DocumentDraft, LineItem, TaxSpec } from './types';

/** Quantity x unit price in integer cents, rounded half-up. Quantity has <= 3 decimals. */
export function lineAmountCents(quantity: number, unitPriceCents: Cents): Cents {
  const milli = Math.round(quantity * 1000);
  return Math.floor((milli * unitPriceCents + 500) / 1000);
}

export function itemsSubtotal(items: LineItem[]): Cents {
  return items.reduce(
    (sum, it) => (it.kind === 'item' ? sum + lineAmountCents(it.quantity, it.unitPriceCents) : sum),
    0,
  );
}

const percentOf = (cents: Cents, basisPoints: number): Cents =>
  Math.floor((cents * basisPoints + 5000) / 10000);

export interface Totals {
  subtotalCents: Cents;
  discountCents: Cents;
  taxableCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
}

/** Order of operations: subtotal -> discount -> tax on discounted amount -> total. */
export function calculateTotals(
  items: LineItem[],
  discount: DiscountSpec | null,
  tax: TaxSpec | null,
): Totals {
  const subtotalCents = itemsSubtotal(items);
  let discountCents = 0;
  if (discount) {
    const raw = discount.mode === 'percent' ? percentOf(subtotalCents, discount.basisPoints) : discount.cents;
    discountCents = Math.min(Math.max(raw, 0), subtotalCents);
  }
  const taxableCents = subtotalCents - discountCents;
  const taxCents = tax ? percentOf(taxableCents, tax.basisPoints) : 0;
  return { subtotalCents, discountCents, taxableCents, taxCents, totalCents: taxableCents + taxCents };
}

/**
 * Totals as displayed on the document. Quotations return null: they must never show a
 * grand total, discount or tax. Invoices return the full breakdown.
 */
export function displayTotals(
  doc: Pick<DocumentDraft, 'type' | 'items' | 'discount' | 'tax'>,
): Totals | null {
  if (doc.type === 'quotation') return null;
  return calculateTotals(doc.items, doc.discount, doc.tax);
}

/** Internal reporting only. Never printed on a quotation, never added to invoice revenue. */
export function quotationInternalEstimateCents(items: LineItem[]): Cents {
  return itemsSubtotal(items);
}
