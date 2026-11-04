import { describe, it, expect } from 'vitest';
import { dailyReport, monthlyReport, annualReport, customerSummaries, registerRows, summarizeRange } from '../domain/reports';
import type { LineItem } from '../domain/types';

function inv(over: Partial<{ type: 'quotation' | 'invoice'; number: string; issueDate: string; customerName: string; items: any[] }> = {}) {
  const base = {
    id: `doc-${Math.random()}`,
    type: 'invoice' as const,
    number: 'INV-2026-3999',
    issueDate: '2026-10-01',
    orderNumber: '',
    customerId: null,
    customerName: 'Default',
    customerPhone: '',
    customerEmail: '',
    customerAddress: '',
    items: [] as any[],
    discount: null,
    tax: null,
    paymentTerms: '',
    notes: '',
    version: 1,
    status: 'active' as const,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    createdBy: 'test',
  };
  return { ...base, ...over } as any;
}

describe('reports', () => {
  const docs = [
    inv({ number: 'INV-2026-4000', issueDate: '2026-10-01', customerName: 'Acme', items: [item('A', 2, 1000)] }),
    inv({ number: 'INV-2026-4001', issueDate: '2026-10-01', customerName: 'Acme', items: [item('B', 1, 500)] }),
    inv({ number: 'INV-2026-4002', issueDate: '2026-10-15', customerName: 'Bee', items: [item('C', 3, 200)] }),
    inv({ type: 'quotation', number: 'QT-2026-4000', issueDate: '2026-10-05', customerName: 'Acme', items: [item('D', 1, 1000)] }),
    inv({ number: 'INV-2026-4003', issueDate: '2026-11-01', customerName: 'Acme', items: [item('E', 1, 3000)] }),
    inv({ number: 'INV-2027-4000', issueDate: '2027-01-10', customerName: 'Bee', items: [item('F', 1, 1000)] }),
  ];

  describe('dailyReport', () => {
    it('returns one row per day including empty days', () => {
      const rows = dailyReport(docs, '2026-10-01', '2026-10-03');
      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual({ date: '2026-10-01', invoiceCount: 2, invoicedCents: 250000, quotationCount: 0, quotationEstimateCents: 0 });
      expect(rows[1]).toEqual({ date: '2026-10-02', invoiceCount: 0, invoicedCents: 0, quotationCount: 0, quotationEstimateCents: 0 });
    });
  });

  describe('monthlyReport', () => {
    it('pads all 12 months of the year', () => {
      const rows = monthlyReport(docs, 2026);
      expect(rows).toHaveLength(12);
      const oct = rows.find((r) => r.month === '2026-10-01')!;
      expect(oct.invoiceCount).toBe(3);
      expect(oct.quotationCount).toBe(1);
      const nov = rows.find((r) => r.month === '2026-11-01')!;
      expect(nov.invoiceCount).toBe(1);
      const dec = rows.find((r) => r.month === '2026-12-01')!;
      expect(dec.invoiceCount).toBe(0);
    });
  });

  describe('annualReport', () => {
    it('groups by year sorted ascending', () => {
      const rows = annualReport(docs);
      expect(rows.map((r) => r.year)).toEqual([2026, 2027]);
      expect(rows[0].invoiceCount).toBe(4);
      expect(rows[1].invoiceCount).toBe(1);
    });
  });

  describe('customerSummaries', () => {
    it('aggregates per customer sorted by invoiced desc', () => {
      const rows = customerSummaries(docs);
      expect(rows[0].customerName).toBe('Acme');
      expect(rows[0].invoiceCount).toBe(3);
      expect(rows[0].invoicedCents).toBe(550000);
      expect(rows[0].quotationCount).toBe(1);
    });
  });

  describe('registerRows', () => {
    it('returns active documents sorted by date desc', () => {
      const rows = registerRows(docs, 'invoice');
      expect(rows.map((r) => r.number)).toEqual(['INV-2027-4000', 'INV-2026-4003', 'INV-2026-4002', 'INV-2026-4001', 'INV-2026-4000']);
      expect(rows.find((r) => r.number === 'INV-2026-4000')?.amountCents).toBe(200000);
    });
    it('excludes quotations when type is invoice', () => {
      const rows = registerRows(docs, 'invoice');
      expect(rows.some((r) => r.type === 'quotation')).toBe(false);
    });
  });

  describe('summarizeRange', () => {
    it('sums invoiced and quotation estimates', () => {
      const s = summarizeRange(docs, '2026-10-01', '2026-10-31');
      expect(s.invoiceCount).toBe(3);
      expect(s.invoicedCents).toBe(310000);
      expect(s.quotationCount).toBe(1);
      expect(s.quotationEstimateCents).toBe(100000);
    });
  });
});

function item(description: string, quantity: number, unitPriceKsh: number): LineItem {
  return { id: `i-${Math.random()}`, kind: 'item', description, quantity, unitPriceCents: Math.round(unitPriceKsh * 100) };
}
