import { buildPrintModel, formatDisplayDate } from '../pdf/printModel';
import { heading, item, makeDraft } from './fixtures';

describe('print model', () => {
  const items = [item('POLO T-SHIRTS', 25, 1200), heading('FLEECE'), item('LONG SLEEVED FLEECE', 25, 3200)];

  it('quotation: line amounts shown, NO total of any kind', () => {
    const m = buildPrintModel(makeDraft({ type: 'quotation', items }));
    expect(m.title).toBe('QUOTATION');
    expect(m.summary).toEqual([]);
    expect(m.rows[0]).toMatchObject({ qty: '25', unitPrice: '1,200', kshs: '30,000', cts: '.00' });
    expect(m.rows[1]).toMatchObject({ kind: 'heading', description: 'FLEECE', kshs: '' });
    expect(m.rows[2]).toMatchObject({ kshs: '80,000' });
  });
  it('quotation never renders discount/tax even if the draft carries them', () => {
    const m = buildPrintModel(makeDraft({ type: 'quotation', items, discount: { mode: 'fixed', cents: 100 }, tax: { label: 'VAT', basisPoints: 1600 } }));
    expect(m.summary).toEqual([]);
  });
  it('invoice: shows TOTAL', () => {
    const m = buildPrintModel(makeDraft({ type: 'invoice', number: 'INV-2026-3999', items }));
    expect(m.title).toBe('INVOICE');
    expect(m.summary).toEqual([{ label: 'TOTAL', kshs: '110,000', cts: '.00', strong: true }]);
  });
  it('invoice: subtotal, discount and tax are explicit', () => {
    const m = buildPrintModel(makeDraft({ type: 'invoice', number: 'INV-2026-3999', items, discount: { mode: 'percent', basisPoints: 1000 }, tax: { label: 'VAT', basisPoints: 1600 } }));
    expect(m.summary.map((s) => s.label)).toEqual(['SUBTOTAL', 'DISCOUNT', 'VAT (16%)', 'TOTAL']);
    expect(m.summary[1].kshs).toBe('-11,000');
    expect(m.summary[3].kshs).toBe('114,840');
  });
  it('formats dates day/month/year', () => {
    expect(formatDisplayDate('2026-10-07')).toBe('7/10/2026');
  });
});
