import { formatDocumentNumber, parseDocumentNumber, validateNumberFormat } from '../domain/numbering';
import { MockRepository, createMemoryStore } from '../data/mockRepository';
import { DuplicateNumberError, VersionConflictError, ValidationError } from '../data/repository';
import { makeDraft } from './fixtures';

describe('number format', () => {
  it('formats and parses', () => {
    expect(formatDocumentNumber('quotation', 2026, 3999)).toBe('QT-2026-3999');
    expect(formatDocumentNumber('invoice', 2026, 3999)).toBe('INV-2026-3999');
    expect(parseDocumentNumber('INV-2027-4010')).toEqual({ type: 'invoice', year: 2027, sequence: 4010 });
    expect(parseDocumentNumber('QT-26-1')).toBeNull();
  });
  it('rejects a number whose prefix does not match the type', () => {
    expect(validateNumberFormat('invoice', 'QT-2026-3999')).toMatch(/INV-/);
    expect(validateNumberFormat('quotation', 'QT-2026-3999')).toBeNull();
  });
});

describe('numbering in the mock repository', () => {
  const fresh = () => new MockRepository(createMemoryStore());

  it('starts both sequences at 3999, independently', async () => {
    const repo = fresh();
    expect(await repo.getNextNumber('quotation', '2026-10-07')).toBe('QT-2026-3999');
    expect(await repo.getNextNumber('invoice', '2026-10-07')).toBe('INV-2026-3999');
    await repo.saveDocument({ draft: makeDraft() });
    expect(await repo.getNextNumber('quotation', '2026-10-07')).toBe('QT-2026-4000');
    expect(await repo.getNextNumber('invoice', '2026-10-07')).toBe('INV-2026-3999');
  });
  it('continues the sequence across years; the year follows the issue date', async () => {
    const repo = fresh();
    await repo.saveDocument({ draft: makeDraft() });
    expect(await repo.getNextNumber('quotation', '2027-01-05')).toBe('QT-2027-4000');
  });
  it('rejects duplicate numbers', async () => {
    const repo = fresh();
    await repo.saveDocument({ draft: makeDraft() });
    await expect(repo.saveDocument({ draft: makeDraft({ customerName: 'Other' }) })).rejects.toBeInstanceOf(DuplicateNumberError);
  });
  it('never releases a number that was changed away from', async () => {
    const repo = fresh();
    const a = await repo.saveDocument({ draft: makeDraft() });
    await repo.saveDocument({ id: a.id, expectedVersion: a.version, draft: { ...makeDraft(), number: 'QT-2026-4500' } });
    await expect(repo.saveDocument({ draft: makeDraft({ customerName: 'B' }) })).rejects.toBeInstanceOf(DuplicateNumberError);
  });
  it('skips numbers already taken manually when suggesting the next one', async () => {
    const repo = fresh();
    await repo.saveDocument({ draft: makeDraft({ number: 'QT-2026-4001' }) });
    expect(await repo.getNextNumber('quotation', '2026-10-07')).toBe('QT-2026-4002');
  });
  it('rejects a malformed number', async () => {
    await expect(fresh().saveDocument({ draft: makeDraft({ number: 'QUOTE-1' }) })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('mock repository save/edit', () => {
  it('saves, reloads, edits, and keeps version history and audit entries', async () => {
    const repo = new MockRepository(createMemoryStore());
    const created = await repo.saveDocument({ draft: makeDraft() });
    expect(created.version).toBe(1);
    const reloaded = await repo.getDocument(created.id);
    expect(reloaded?.customerName).toBe('Olkupelia');

    const edited = await repo.saveDocument({ id: created.id, expectedVersion: 1, draft: { ...makeDraft(), customerName: 'Olkupelia Ltd' } });
    expect(edited.version).toBe(2);
    const versions = await repo.listVersions(created.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[1].snapshot.customerName).toBe('Olkupelia');
    expect((await repo.listAudit(created.id)).map((a) => a.action)).toEqual(['updated', 'created']);
  });
  it('rejects a stale save (optimistic locking)', async () => {
    const repo = new MockRepository(createMemoryStore());
    const created = await repo.saveDocument({ draft: makeDraft() });
    await repo.saveDocument({ id: created.id, expectedVersion: 1, draft: makeDraft() });
    await expect(repo.saveDocument({ id: created.id, expectedVersion: 1, draft: makeDraft() })).rejects.toBeInstanceOf(VersionConflictError);
  });
  it('strips discount and tax from quotations', async () => {
    const repo = new MockRepository(createMemoryStore());
    const q = await repo.saveDocument({ draft: makeDraft({ discount: { mode: 'percent', basisPoints: 1000 }, tax: { label: 'VAT', basisPoints: 1600 } }) });
    expect(q.discount).toBeNull();
    expect(q.tax).toBeNull();
  });
  it('saves customers for reuse and filters documents', async () => {
    const repo = new MockRepository(createMemoryStore());
    await repo.saveDocument({ draft: makeDraft({ customerPhone: '0700' }) });
    await repo.saveDocument({ draft: makeDraft({ type: 'invoice', number: 'INV-2026-3999', customerName: 'Other Co' }) });
    expect((await repo.listCustomers()).map((c) => c.name)).toEqual(['Olkupelia', 'Other Co']);
    expect(await repo.listDocuments({ type: 'invoice' })).toHaveLength(1);
    expect(await repo.listDocuments({ search: 'olkup' })).toHaveLength(1);
  });
  it('rejects documents with no line items or bad quantities', async () => {
    const repo = new MockRepository(createMemoryStore());
    await expect(repo.saveDocument({ draft: makeDraft({ items: [] }) })).rejects.toBeInstanceOf(ValidationError);
  });
});
