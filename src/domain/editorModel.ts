import { calculateTotals, lineAmountCents, type Totals } from './calc';
import {
  centsToInput,
  formatQuantity,
  parseMoneyToCents,
  parsePercentToBasisPoints,
  parseQuantity,
} from './money';
import type { DiscountSpec, DocumentDraft, DocumentRecord, DocumentType, LineItem, TaxSpec } from './types';
import { company } from '../config/company';

/** Form state: every editable number is held as text so partial typing ("12.") is safe. */
export interface EditorLine {
  id: string;
  kind: 'item' | 'heading';
  description: string;
  qty: string;
  price: string;
}

export interface EditorState {
  type: DocumentType;
  number: string;
  issueDate: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  lines: EditorLine[];
  discountMode: 'none' | 'percent' | 'fixed';
  discountValue: string;
  taxEnabled: boolean;
  taxLabel: string;
  taxRate: string;
  paymentTerms: string;
  notes: string;
}

let counter = 0;
export const newLineId = () => `line-${Date.now().toString(36)}-${counter++}`;

export const blankItem = (): EditorLine => ({ id: newLineId(), kind: 'item', description: '', qty: '', price: '' });
export const blankHeading = (): EditorLine => ({ id: newLineId(), kind: 'heading', description: '', qty: '', price: '' });

/** Today's date in Africa/Nairobi as YYYY-MM-DD. */
export function todayInNairobi(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function newEditorState(type: DocumentType, number: string, issueDate: string): EditorState {
  return {
    type, number, issueDate, orderNumber: number,
    customerId: null, customerName: '', customerPhone: '', customerEmail: '', customerAddress: '',
    lines: [blankItem()],
    discountMode: 'none', discountValue: '', taxEnabled: false, taxLabel: 'VAT', taxRate: '',
    paymentTerms: company.defaultPaymentTerms, notes: company.defaultNotes,
  };
}

export function stateFromRecord(r: DocumentRecord): EditorState {
  return {
    type: r.type, number: r.number, issueDate: r.issueDate, orderNumber: r.orderNumber,
    customerId: r.customerId, customerName: r.customerName, customerPhone: r.customerPhone,
    customerEmail: r.customerEmail, customerAddress: r.customerAddress,
    lines: r.items.map((i) =>
      i.kind === 'heading'
        ? { id: i.id, kind: 'heading', description: i.description, qty: '', price: '' }
        : { id: i.id, kind: 'item', description: i.description, qty: formatQuantity(i.quantity), price: centsToInput(i.unitPriceCents) },
    ),
    discountMode: r.discount ? r.discount.mode : 'none',
    discountValue: r.discount ? (r.discount.mode === 'percent' ? String(r.discount.basisPoints / 100) : centsToInput(r.discount.cents)) : '',
    taxEnabled: !!r.tax,
    taxLabel: r.tax?.label ?? 'VAT',
    taxRate: r.tax ? String(r.tax.basisPoints / 100) : '',
    paymentTerms: r.paymentTerms, notes: r.notes,
  };
}

/** Parses text fields into a typed draft. Returns parse problems; domain validation runs later. */
export function stateToDraft(s: EditorState): { draft: DocumentDraft; problems: string[] } {
  const problems: string[] = [];
  const items: LineItem[] = s.lines.map((l, idx) => {
    if (l.kind === 'heading') return { id: l.id, kind: 'heading', description: l.description };
    const qty = parseQuantity(l.qty);
    const price = parseMoneyToCents(l.price);
    if (qty === null) problems.push(`Row ${idx + 1}: enter a quantity greater than zero (up to 3 decimals).`);
    if (price === null) problems.push(`Row ${idx + 1}: enter a valid unit price.`);
    return { id: l.id, kind: 'item', description: l.description, quantity: qty ?? 0, unitPriceCents: price ?? 0 };
  });

  let discount: DiscountSpec | null = null;
  if (s.type === 'invoice' && s.discountMode !== 'none') {
    if (s.discountMode === 'percent') {
      const bp = parsePercentToBasisPoints(s.discountValue);
      if (bp === null) problems.push('Discount percentage must be between 0 and 100.');
      else discount = { mode: 'percent', basisPoints: bp };
    } else {
      const c = parseMoneyToCents(s.discountValue);
      if (c === null) problems.push('Enter a valid discount amount.');
      else discount = { mode: 'fixed', cents: c };
    }
  }
  let tax: TaxSpec | null = null;
  if (s.type === 'invoice' && s.taxEnabled) {
    const bp = parsePercentToBasisPoints(s.taxRate);
    if (bp === null) problems.push('Enter the tax rate (0-100%).');
    else tax = { label: s.taxLabel, basisPoints: bp };
  }

  return {
    problems,
    draft: {
      type: s.type, number: s.number, issueDate: s.issueDate, orderNumber: s.orderNumber || s.number,
      customerId: s.customerId, customerName: s.customerName, customerPhone: s.customerPhone,
      customerEmail: s.customerEmail, customerAddress: s.customerAddress,
      items, discount, tax, paymentTerms: s.paymentTerms, notes: s.notes,
    },
  };
}

/** Amount for one editor row; null for headings or rows that do not parse yet. */
export function rowAmountCents(l: EditorLine): number | null {
  if (l.kind !== 'item') return null;
  const q = parseQuantity(l.qty);
  const p = parseMoneyToCents(l.price);
  return q === null || p === null ? null : lineAmountCents(q, p);
}

/** Live totals for the editor (invoice only; null for quotations). */
export function previewTotals(s: EditorState): Totals | null {
  if (s.type === 'quotation') return null;
  const { draft } = stateToDraft(s);
  return calculateTotals(draft.items, draft.discount, draft.tax);
}
