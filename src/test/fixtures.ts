import type { DocumentDraft, LineItem } from '../domain/types';

let n = 0;
export const item = (description: string, quantity: number, unitPriceKsh: number): LineItem => ({
  id: `i${n++}`, kind: 'item', description, quantity, unitPriceCents: Math.round(unitPriceKsh * 100),
});
export const heading = (description: string): LineItem => ({ id: `h${n++}`, kind: 'heading', description });

export function makeDraft(over: Partial<DocumentDraft> = {}): DocumentDraft {
  return {
    type: 'quotation', number: 'QT-2026-3999', issueDate: '2026-10-07', orderNumber: '',
    customerId: null, customerName: 'Olkupelia', customerPhone: '', customerEmail: '', customerAddress: '',
    items: [item('POLO T-SHIRTS', 25, 1200), heading('FLEECE'), item('LONG SLEEVED FLEECE', 25, 3200)],
    discount: null, tax: null,
    paymentTerms: 'Accounts are due on demand\nPay a deposit of 75%',
    notes: 'All invoices and deliveries are submitted and signed by relevant authorized staff of both partners.',
    ...over,
  };
}

/** Mirrors the OLKUPELIA reference quotation (subtotal KSh 330,400). */
export function referenceItems(): LineItem[] {
  return [
    item('POLO T-SHIRTS', 25, 1200), heading('FLEECE'), item('LONG SLEEVED FLEECE', 25, 3200),
    heading('RESTAURANT'), item('TROUSERS', 2, 2500), heading('SHIRTS'),
    item('LONG SLEEVED', 2, 2250), item('SHORT SLEEVED', 2, 1850), item('SLEEVELESS FLEECE', 2, 1800),
    heading('SWIMMING POOL'), item('WATERPROOF OVERALL', 1, 1800),
    heading('HOUSEKEEPING'), heading('SHIRTS'), item('SHORT SLEEVED', 6, 1900), item('TROUSERS', 6, 2500),
    heading('GARDENER'), item('OVERALL', 1, 3800),
    heading('HEAD CHEF'), item('CHEF JACKET', 4, 2500), item('TROUSERS', 4, 2500), item('APRONS', 4, 650), item('CHEF HAT', 4, 500), item('SCARF', 4, 150),
    heading('ASSISTANT CHEF'), item('CHEF JACKET', 4, 2500), item('TROUSERS', 4, 2500), item('APRONS', 4, 650), item('CHEF HATS', 4, 500), item('SCARFS', 4, 150),
    heading('STEWARD'), item('CHEF JACKET', 2, 1800), item('TROUSERS', 2, 1800), item('WATERPROOF APRONS', 2, 850),
    heading('STAFF CHEF'), item('TROUSER', 2, 2500), item('CHEF JACKET', 2, 1800),
    heading('ADMINISTRATION'), item('SHIRT', 4, 2500), item('TROUSER', 4, 2500), item('SLEEVELESS FLEECE', 2, 1800),
    heading('LAUNDRY'), item('ROUND NECK T-SHIRTS', 2, 1000), item('POLO T-SHIRTS', 2, 1200),
    heading('SPAR'), item('ROUND NECK T-SHIRT', 1, 1000),
    heading('SECURITY'), item('TROUSERS', 8, 2500), item('SHIRTS', 8, 2500), item('ROUND NECK T-SHIRTS', 4, 1000), item('CAPS', 8, 800), item('PULLOVER', 2, 2500),
    heading('GUIDE'), item('LONG SLEEVED SHIRTS', 2, 2250), item('TROUSERS', 2, 2500), item('SAFARI BOOTS', 1, 3000), item('SLEEVELESS FLEECE', 1, 1800),
  ];
}
