// @vitest-environment node
import { buildPrintModel } from '../pdf/printModel';
import { renderDocumentPdf } from '../pdf/renderPdf';
import { heading, item, makeDraft, referenceItems } from './fixtures';

const text = (d: ReturnType<typeof renderDocumentPdf>) => d.output();

describe('PDF rendering', () => {
  it('a short document fits on one page', () => {
    expect(renderDocumentPdf(buildPrintModel(makeDraft())).getNumberOfPages()).toBe(1);
  });
  it('a long document paginates and numbers its pages', () => {
    const pdf = renderDocumentPdf(buildPrintModel(makeDraft({ items: referenceItems() })));
    expect(pdf.getNumberOfPages()).toBeGreaterThan(1);
    const n = pdf.getNumberOfPages();
    expect(text(pdf)).toContain(`Page ${n} of ${n}`);
  });
  it('repeats the column header and company heading on every page', () => {
    const pdf = renderDocumentPdf(buildPrintModel(makeDraft({ items: referenceItems() })));
    const n = pdf.getNumberOfPages();
    const out = text(pdf);
    const headers = out.split('(PARTICULARS)').length - 1;
    // Every page that carries table rows repeats the header (a final page may hold only the terms).
    expect(headers).toBeGreaterThanOrEqual(2);
    expect(headers).toBeLessThanOrEqual(n);
    expect(out.split('continued').length - 1).toBe(n - 1);
  });
  it('quotation PDF contains no TOTAL text; invoice PDF does', () => {
    const q = text(renderDocumentPdf(buildPrintModel(makeDraft({ items: referenceItems() }))));
    const i = text(renderDocumentPdf(buildPrintModel(makeDraft({ type: 'invoice', number: 'INV-2026-3999', items: referenceItems() }))));
    expect(q).not.toMatch(/TOTAL/);
    expect(q).toContain('QUOTATION');
    expect(i).toContain('(TOTAL)');
    expect(i).toContain('325,400');
  });
  it('handles very long descriptions by wrapping instead of clipping', () => {
    const long = 'HEAVY DUTY WATERPROOF WORKWEAR OVERALL WITH REFLECTIVE STRIPS AND EMBROIDERED COMPANY BRANDING ON BACK AND CHEST ' .repeat(2);
    const pdf = renderDocumentPdf(buildPrintModel(makeDraft({ items: [heading('GUIDE'), item(long, 1, 100)] })));
    expect(pdf.getNumberOfPages()).toBe(1);
  });
  it('invoice totals stay on the same page as the last item rows', () => {
    const pdf = renderDocumentPdf(buildPrintModel(makeDraft({ type: 'invoice', number: 'INV-2026-3999', items: referenceItems() })));
    const n = pdf.getNumberOfPages();
    const lastPageStart = text(pdf).split('Page ' + (n - 1) + ' of')[1] ?? '';
    expect(lastPageStart).toContain('(TOTAL)');
  });
});
