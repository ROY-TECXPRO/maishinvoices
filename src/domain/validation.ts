import { validateNumberFormat } from './numbering';
import type { DocumentDraft } from './types';

function isRealIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Returns a list of human-readable problems. Empty list means the draft may be saved. */
export function validateDraft(d: DocumentDraft): string[] {
  const errors: string[] = [];
  if (!d.customerName.trim()) errors.push('Customer name is required.');
  const numberError = validateNumberFormat(d.type, d.number);
  if (numberError) errors.push(numberError);
  if (!isRealIsoDate(d.issueDate)) errors.push('Date is not valid.');

  const items = d.items.filter((i) => i.kind === 'item');
  if (items.length === 0) errors.push('Add at least one line item.');
  d.items.forEach((it, idx) => {
    const row = idx + 1;
    if (!it.description.trim()) errors.push(`Row ${row}: description is required.`);
    if (it.kind === 'item') {
      if (!(it.quantity > 0)) errors.push(`Row ${row}: quantity must be greater than zero.`);
      if (!Number.isInteger(it.unitPriceCents) || it.unitPriceCents < 0)
        errors.push(`Row ${row}: unit price is not valid.`);
    }
  });
  if (d.discount?.mode === 'percent' && (d.discount.basisPoints < 0 || d.discount.basisPoints > 10000))
    errors.push('Discount percentage must be between 0 and 100.');
  if (d.discount?.mode === 'fixed' && d.discount.cents < 0) errors.push('Discount cannot be negative.');
  if (d.tax && !d.tax.label.trim()) errors.push('Tax needs a label (for example "VAT").');
  return errors;
}

/** Quotations never carry discount or tax. */
export function normalizeDraft(d: DocumentDraft): DocumentDraft {
  const isQuote = d.type === 'quotation';
  return {
    ...d,
    number: d.number.trim().toUpperCase(),
    orderNumber: d.orderNumber.trim(),
    customerName: d.customerName.trim(),
    customerPhone: d.customerPhone.trim(),
    customerEmail: d.customerEmail.trim(),
    customerAddress: d.customerAddress.trim(),
    items: d.items.map((i) => ({ ...i, description: i.description.trim() })),
    discount: isQuote ? null : d.discount,
    tax: isQuote ? null : d.tax,
  };
}
