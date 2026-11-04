import { describe, it, expect } from 'vitest';
import {
  validateAiAction,
  extractAiActionCandidates,
  extractAiReply,
} from '../ai/validate';
import type { AiAction } from '../ai/actions';

/** Runs the same pipeline the Edge Function uses: extract candidates, then validate. */
function firstAction(text: string): AiAction | null {
  return extractAiActionCandidates(text).map((c) => validateAiAction(c)).find(Boolean) ?? null;
}

describe('AI action validation', () => {
  it('validates search_documents', () => {
    const a = validateAiAction({ kind: 'search_documents', type: 'invoice', status: 'active', search: 'oct', from: '2026-10-01', to: '2026-10-31' });
    expect(a).toMatchObject({ kind: 'search_documents', type: 'invoice', status: 'active', search: 'oct' });
  });
  it('rejects unknown kind', () => {
    expect(validateAiAction({ kind: 'delete_all_documents' })).toBeNull();
    expect(validateAiAction({ kind: 'exec_sql', sql: 'SELECT * FROM users' })).toBeNull();
  });
  it('validates create_document with items', () => {
    const a = validateAiAction({
      kind: 'create_document',
      type: 'quotation',
      customerName: 'Olkupelia',
      items: [
        { description: 'Shirts', quantity: 10, unitPriceCents: 120000 },
        { description: 'FLEECE', kind: 'heading' },
      ],
    });
    expect(a).toMatchObject({ kind: 'create_document', type: 'quotation', customerName: 'Olkupelia' });
    expect((a as AiAction & { items: unknown[] }).items).toHaveLength(2);
  });
  it('rejects create_document with no items', () => {
    expect(validateAiAction({ kind: 'create_document', type: 'invoice', customerName: 'X', items: [] })).toBeNull();
  });
  it('validates trash_document requires id', () => {
    const a = validateAiAction({ kind: 'trash_document', id: 'doc-123' });
    expect(a).toMatchObject({ kind: 'trash_document', id: 'doc-123' });
    expect(validateAiAction({ kind: 'trash_document' })).toBeNull();
  });
  it('validates get_report', () => {
    const a = validateAiAction({ kind: 'get_report', scope: 'monthly', year: 2026, month: 10 });
    expect(a).toMatchObject({ kind: 'get_report', scope: 'monthly', year: 2026, month: 10 });
  });
  it('rejects out-of-range month', () => {
    expect(validateAiAction({ kind: 'get_report', scope: 'monthly', month: 13 })).toBeNull();
  });
  it('rejects negative cents', () => {
    expect(validateAiAction({ kind: 'create_document', type: 'invoice', customerName: 'X', items: [{ description: 'A', quantity: 1, unitPriceCents: -5 }] })).toBeNull();
  });
  it('rejects quantity with more than 3 decimals', () => {
    expect(validateAiAction({ kind: 'create_document', type: 'invoice', customerName: 'X', items: [{ description: 'A', quantity: 1.0005, unitPriceCents: 100 }] })).toBeNull();
  });
});

describe('AI reply normalisation', () => {
  it('parses a canonical action object', () => {
    const a = firstAction('{"kind":"create_document","type":"quotation","customerName":"Olkupelia Ltd","items":[{"description":"Consulting","quantity":1,"unitPriceCents":200000}]}');
    expect(a).toMatchObject({ kind: 'create_document', type: 'quotation', customerName: 'Olkupelia Ltd' });
  });

  it('flattens an action envelope with snake_case parameters', () => {
    const a = firstAction(JSON.stringify({
      action: 'create_document',
      parameters: {
        type: 'quotation',
        customer_name: 'AI Smoke Test',
        items: [{ description: 'Consulting', quantity: 1, unit_price: 200000 }],
      },
    }));
    expect(a).toMatchObject({ kind: 'create_document', type: 'quotation', customerName: 'AI Smoke Test' });
    expect((a as AiAction & { items: { unitPriceCents: number }[] }).items[0].unitPriceCents).toBe(200000);
  });

  it('parses an action envelope with camelCase parameters', () => {
    const a = firstAction('{"action":"search_documents","parameters":{"type":"invoice","status":"active"}}');
    expect(a).toMatchObject({ kind: 'search_documents', type: 'invoice', status: 'active' });
  });

  it('strips markdown fences', () => {
    const a = firstAction('```json\n{"kind":"trash_document","id":"doc-1"}\n```');
    expect(a).toMatchObject({ kind: 'trash_document', id: 'doc-1' });
  });

  it('finds an action embedded in surrounding prose', () => {
    const a = firstAction('Sure! Here you go:\n{"kind":"get_document","number":"QT-2026-4002"}\nLet me know.');
    expect(a).toMatchObject({ kind: 'get_document', number: 'QT-2026-4002' });
  });

  it('extracts a conversational reply object', () => {
    expect(extractAiReply('{"reply":"Which customer should this quotation be for?"}')).toBe(
      'Which customer should this quotation be for?',
    );
  });

  it('returns plain text replies unchanged', () => {
    expect(extractAiReply('  How can I help?  ')).toBe('How can I help?');
  });

  it('produces no action for a pure reply', () => {
    expect(firstAction('{"reply":"Which customer?"}')).toBeNull();
  });
});
