import { calculateTotals, displayTotals, lineAmountCents, quotationInternalEstimateCents } from '../domain/calc';
import { heading, item, makeDraft, referenceItems } from './fixtures';

describe('line amounts', () => {
  it('quantity x unit price', () => {
    expect(lineAmountCents(25, 120_000)).toBe(3_000_000);
    expect(lineAmountCents(3, 1999)).toBe(5997);
  });
  it('avoids floating point drift', () => {
    expect(lineAmountCents(3, 10)).toBe(30); // 3 x 0.10
    expect(lineAmountCents(7, 1999)).toBe(13_993);
  });
  it('handles fractional quantities with half-up rounding', () => {
    expect(lineAmountCents(2.5, 10_001)).toBe(25_003); // 25002.5 -> 25003
    expect(lineAmountCents(0.5, 3)).toBe(2); // 1.5 -> 2
  });
});

describe('totals', () => {
  const items = [item('A', 2, 500), heading('H'), item('B', 1, 250)]; // 1,250.00
  it('ignores headings and sums items', () => {
    expect(calculateTotals(items, null, null).totalCents).toBe(125_000);
  });
  it('applies percent discount then tax on the discounted amount', () => {
    const t = calculateTotals(items, { mode: 'percent', basisPoints: 1000 }, { label: 'VAT', basisPoints: 1600 });
    expect(t.subtotalCents).toBe(125_000);
    expect(t.discountCents).toBe(12_500);
    expect(t.taxableCents).toBe(112_500);
    expect(t.taxCents).toBe(18_000);
    expect(t.totalCents).toBe(130_500);
  });
  it('caps a fixed discount at the subtotal', () => {
    const t = calculateTotals(items, { mode: 'fixed', cents: 999_999_00 }, null);
    expect(t.discountCents).toBe(125_000);
    expect(t.totalCents).toBe(0);
  });
  it('never adds tax or discount unless explicitly set', () => {
    const t = calculateTotals(items, null, null);
    expect(t.taxCents).toBe(0);
    expect(t.discountCents).toBe(0);
  });
  it('quotations have no display totals at all', () => {
    expect(displayTotals(makeDraft({ type: 'quotation', items }))).toBeNull();
  });
  it('invoices display totals', () => {
    expect(displayTotals(makeDraft({ type: 'invoice', items }))?.totalCents).toBe(125_000);
  });
  it('internal quotation estimate is just the line sum', () => {
    expect(quotationInternalEstimateCents(items)).toBe(125_000);
  });
  it('reference quotation: correct total is KSh 325,400 (reference PDF shows 330,400 because it prints 2 x 2,500 PULLOVER as 10,000)', () => {
    expect(calculateTotals(referenceItems(), null, null).totalCents).toBe(32_540_000);
  });
});
