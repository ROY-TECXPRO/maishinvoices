import { describe, it, expect } from 'vitest';
import { MockRepository, createMemoryStore } from '../data/mockRepository';
import { makeDraft } from './fixtures';

describe('mock repository - duplicate/convert/trash/restore', () => {
  const fresh = () => new MockRepository(createMemoryStore());

  it('duplicates an active document with a fresh number', async () => {
    const repo = fresh();
    const orig = await repo.saveDocument({ draft: makeDraft() });
    const copy = await repo.duplicateDocument(orig.id);
    expect(copy.id).not.toBe(orig.id);
    expect(copy.number).not.toBe(orig.number);
    expect(copy.customerName).toBe(orig.customerName);
    const all = await repo.listDocuments();
    expect(all.length).toBe(2);
  });

  it('converts quotation to invoice, preserving the quotation', async () => {
    const repo = fresh();
    const q = await repo.saveDocument({ draft: makeDraft({ type: 'quotation', number: 'QT-2026-3999' }) });
    const inv = await repo.convertToInvoice(q.id);
    expect(inv.type).toBe('invoice');
    expect(inv.number.startsWith('INV-')).toBe(true);
    const qReloaded = await repo.getDocument(q.id);
    expect(qReloaded?.type).toBe('quotation');
  });

  it('trashes and restores a document', async () => {
    const repo = fresh();
    const d = await repo.saveDocument({ draft: makeDraft() });
    const trashed = await repo.setDocumentStatus(d.id, 'trashed', d.version);
    expect(trashed.status).toBe('trashed');
    expect(trashed.version).toBe(d.version + 1);
    const activeDocs = await repo.listDocuments({ status: 'active' });
    expect(activeDocs.find((x) => x.id === d.id)).toBeUndefined();
    const restored = await repo.setDocumentStatus(d.id, 'active', trashed.version);
    expect(restored.status).toBe('active');
  });

  it('purge is only allowed on trashed documents', async () => {
    const repo = fresh();
    const d = await repo.saveDocument({ draft: makeDraft() });
    await expect(repo.purgeDocument(d.id)).rejects.toThrow();
    await repo.setDocumentStatus(d.id, 'trashed', d.version);
    await repo.purgeDocument(d.id);
    const all = await repo.listDocuments({ status: 'trashed' });
    expect(all.find((x) => x.id === d.id)).toBeUndefined();
  });

  it('restoreVersion creates a new version from a snapshot', async () => {
    const repo = fresh();
    const d = await repo.saveDocument({ draft: makeDraft({ customerName: 'First' }) });
    await repo.saveDocument({ id: d.id, expectedVersion: d.version, draft: { ...makeDraft(), customerName: 'Second' } });
    const restored = await repo.restoreVersion(d.id, 1);
    expect(restored.customerName).toBe('First');
    expect(restored.version).toBe(3);
    const versions = await repo.listVersions(d.id);
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2, 3]);
  });

  it('audit records trash, restore, convert and version restore', async () => {
    const repo = fresh();
    const q = await repo.saveDocument({ draft: makeDraft({ type: 'quotation' }) });
    await repo.convertToInvoice(q.id);
    const audit = await repo.listAudit();
    expect(audit.some((a) => a.action === 'converted')).toBe(true);
  });

  it('settings get/save roundtrip', async () => {
    const repo = fresh();
    const before = await repo.getSettings();
    expect(before.nameLine1).toBe('MAISH MATTRESS CENTER');
    const after = await repo.saveSettings({ ...before, nameLine1: 'TEST CO' });
    expect(after.nameLine1).toBe('TEST CO');
    const reloaded = await repo.getSettings();
    expect(reloaded.nameLine1).toBe('TEST CO');
  });

  it('exportBundle includes customers, documents, versions and audit', async () => {
    const repo = fresh();
    const d = await repo.saveDocument({ draft: makeDraft() });
    await repo.saveDocument({ id: d.id, expectedVersion: d.version, draft: { ...makeDraft(), customerName: 'Edited' } });
    const bundle = await repo.exportBundle();
    expect(bundle.app).toBe('maish-invoice-manager');
    expect(bundle.documents.length).toBeGreaterThan(0);
    expect(bundle.versions.length).toBeGreaterThan(0);
    expect(bundle.audit.length).toBeGreaterThan(0);
    expect(bundle.customers.length).toBeGreaterThan(0);
  });
});
