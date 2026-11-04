import { normalizeDraft, validateDraft } from '../domain/validation';
import { NUMBER_PREFIX, SEQUENCE_START, formatDocumentNumber, parseDocumentNumber, yearOfIsoDate } from '../domain/numbering';
import type { AuditAction, AuditEntry, Customer, DocumentDraft, DocumentRecord, DocumentType, DocumentVersion, HistoryBatch, Payment, PaymentMethod, Profile } from '../domain/types';
import { calculateTotals } from '../domain/calc';
import { todayInNairobi } from '../domain/editorModel';
import { company, type CompanyProfile } from '../config/company';
import {
  DuplicateNumberError,
  NotFoundError,
  ValidationError,
  VersionConflictError,
  type BackupBundle,
  type CustomerInput,
  type DocumentFilter,
  type ProfileUpdate,
  type Repository,
  type SaveDocumentInput,
} from './repository';

/**
 * DEVELOPMENT ONLY. Data lives in this browser's localStorage. It is NOT shared between
 * computers, numbering is NOT authoritative, and "user" is a fixed placeholder. Production
 * needs the Supabase implementation. Do not enter real customer data here.
 */
export interface KeyValueStore {
  read(): string | null;
  write(value: string): void;
}

export const createMemoryStore = (): KeyValueStore => {
  let v: string | null = null;
  return { read: () => v, write: (x) => (v = x) };
};

export const createLocalStorageStore = (key = 'maish-mock-data-v1'): KeyValueStore => ({
  read: () => window.localStorage.getItem(key),
  write: (x) => window.localStorage.setItem(key, x),
});

interface StoreData {
  documents: Record<string, DocumentRecord>;
  versions: DocumentVersion[];
  audit: AuditEntry[];
  customers: Record<string, Customer>;
  deletedCustomers: Record<string, Customer>;
  profiles: Profile[];
  sequences: { QT: number; INV: number };
  /** number -> document id. Numbers are never released, even if a document's number changes. */
  allocated: Record<string, string>;
  settings: CompanyProfile | null;
  payments: Payment[];
  historyTrash: { deletedAt: string; audit: AuditEntry[]; versions: DocumentVersion[] }[];
}

const seedProfiles = (): Profile[] => [
  {
    id: MOCK_USER,
    fullName: MOCK_USER_NAME,
    email: 'dev@localhost',
    role: 'admin',
    isActive: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
];

const emptyData = (): StoreData => ({
  documents: {},
  versions: [],
  audit: [],
  customers: {},
  deletedCustomers: {},
  profiles: seedProfiles(),
  sequences: { QT: SEQUENCE_START, INV: SEQUENCE_START },
  allocated: {},
  settings: null,
  payments: [],
  historyTrash: [],
});

export const MOCK_USER = 'local-dev-user';
export const MOCK_USER_NAME = 'Local dev user';

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export class MockRepository implements Repository {
  readonly mode = 'mock' as const;
  constructor(private readonly store: KeyValueStore) {}

  private load(): StoreData {
    const raw = this.store.read();
    return raw ? { ...emptyData(), ...(JSON.parse(raw) as Partial<StoreData>) } : emptyData();
  }
  private persist(d: StoreData) {
    this.store.write(JSON.stringify(d));
  }

  async getNextNumber(type: DocumentType, issueDate: string): Promise<string> {
    const data = this.load();
    const prefix = NUMBER_PREFIX[type];
    const year = yearOfIsoDate(issueDate);
    let seq = data.sequences[prefix];
    while (data.allocated[formatDocumentNumber(type, year, seq)]) seq++;
    return formatDocumentNumber(type, year, seq);
  }

  async listDocuments(filter: DocumentFilter = {}): Promise<DocumentRecord[]> {
    const status = filter.status ?? 'active';
    const q = filter.search?.trim().toLowerCase();
    return Object.values(this.load().documents)
      .filter((d) => d.status === status)
      .filter((d) => !filter.type || d.type === filter.type)
      .filter((d) => !filter.from || d.issueDate >= filter.from)
      .filter((d) => !filter.to || d.issueDate <= filter.to)
      .filter((d) => !filter.customerId || d.customerId === filter.customerId)
      .filter(
        (d) =>
          !q ||
          d.number.toLowerCase().includes(q) ||
          d.customerName.toLowerCase().includes(q) ||
          d.orderNumber.toLowerCase().includes(q),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getDocument(id: string) {
    return this.load().documents[id] ?? null;
  }

  async saveDocument(input: SaveDocumentInput): Promise<DocumentRecord> {
    return this.saveRecord(input, input.id ? 'updated' : 'created');
  }

  private async saveRecord(
    { id, expectedVersion, draft }: SaveDocumentInput,
    action: AuditAction,
    detail?: string,
    statusOverride?: DocumentRecord['status'],
  ): Promise<DocumentRecord> {
    const data = this.load();
    const d = normalizeDraft(draft);
    const problems = validateDraft(d);
    if (problems.length) throw new ValidationError(problems);

    const owner = data.allocated[d.number];
    if (owner && owner !== id) throw new DuplicateNumberError(d.number);

    const now = new Date().toISOString();
    const customer = this.upsertCustomer(data, {
      id: d.customerId,
      name: d.customerName,
      phone: d.customerPhone,
      email: d.customerEmail,
      address: d.customerAddress,
    }, now);

    let record: DocumentRecord;
    if (id) {
      const existing = data.documents[id];
      if (!existing) throw new NotFoundError('Document');
      if (expectedVersion !== existing.version) throw new VersionConflictError();
      if (existing.type !== d.type) throw new ValidationError(['Document type cannot change after saving.']);
      record = {
        ...existing, ...d, customerId: customer.id,
        version: existing.version + 1,
        status: statusOverride ?? existing.status,
        updatedAt: now,
      };
    } else {
      record = {
        ...d,
        customerId: customer.id,
        id: newId(),
        version: 1,
        status: statusOverride ?? 'active',
        createdAt: now,
        updatedAt: now,
        createdBy: MOCK_USER,
      };
    }

    data.documents[record.id] = record;
    data.allocated[record.number] = record.id;
    const parsed = parseDocumentNumber(record.number);
    if (parsed) {
      const prefix = NUMBER_PREFIX[parsed.type];
      data.sequences[prefix] = Math.max(data.sequences[prefix], parsed.sequence + 1);
    }
    data.versions.push({
      id: newId(), documentId: record.id, version: record.version, snapshot: record, savedAt: now, savedBy: MOCK_USER,
    });
    data.audit.push({
      id: newId(), at: now, userId: MOCK_USER, userName: MOCK_USER_NAME, action,
      documentId: record.id, documentNumber: record.number, detail: detail ?? `Version ${record.version}`,
    });
    this.persist(data);
    return record;
  }

  async listVersions(documentId: string) {
    return this.load().versions.filter((v) => v.documentId === documentId).sort((a, b) => b.version - a.version);
  }

  async listAudit(documentId?: string) {
    return this.load().audit.filter((a) => !documentId || a.documentId === documentId).reverse();
  }

  async listCustomers() {
    return Object.values(this.load().customers).sort((a, b) => a.name.localeCompare(b.name));
  }

  async listDeletedCustomers() {
    return Object.values(this.load().deletedCustomers).sort((a, b) => a.name.localeCompare(b.name));
  }

  async deleteCustomer(id: string): Promise<void> {
    const data = this.load();
    const c = data.customers[id];
    if (!c) throw new NotFoundError('Customer');
    delete data.customers[id];
    data.deletedCustomers[c.id] = c;
    this.persist(data);
  }

  async purgeCustomer(id: string): Promise<void> {
    const data = this.load();
    if (!data.deletedCustomers[id]) throw new NotFoundError('Customer');
    delete data.deletedCustomers[id];
    this.persist(data);
  }

  async restoreCustomer(id: string): Promise<Customer> {
    const data = this.load();
    const c = data.deletedCustomers[id];
    if (!c) throw new NotFoundError('Customer');
    delete data.deletedCustomers[id];
    data.customers[c.id] = c;
    this.persist(data);
    return c;
  }

  async saveCustomer(input: CustomerInput) {
    const data = this.load();
    const c = this.upsertCustomer(data, input, new Date().toISOString());
    data.audit.push({
      id: newId(), at: c.updatedAt, userId: MOCK_USER, userName: MOCK_USER_NAME, action: 'customer_updated',
      documentId: null, documentNumber: '', detail: `Customer ${c.name}`,
    });
    this.persist(data);
    return c;
  }

  async duplicateDocument(id: string): Promise<DocumentRecord> {
    const src = this.load().documents[id];
    if (!src || src.status !== 'active') throw new NotFoundError('Document');
    const number = await this.getNextNumber(src.type, src.issueDate);
    return this.saveRecord(
      { draft: { ...toDraft(src), number } },
      'duplicated',
      `Duplicated from ${src.number}`,
    );
  }

  async convertToInvoice(id: string): Promise<DocumentRecord> {
    const data = this.load();
    const src = data.documents[id];
    if (!src || src.status !== 'active') throw new NotFoundError('Document');
    if (src.type !== 'quotation') throw new ValidationError(['Only quotations can be converted into invoices.']);
    const issueDate = todayInNairobi();
    const number = await this.getNextNumber('invoice', issueDate);
    const draft: DocumentDraft = {
      ...toDraft(src),
      type: 'invoice',
      number,
      issueDate,
      discount: null,
      tax: null,
    };
    return this.saveRecord({ draft }, 'converted', `Converted from ${src.number}`);
  }

  async setDocumentStatus(
    id: string,
    status: 'active' | 'trashed',
    expectedVersion: number,
  ): Promise<DocumentRecord> {
    const existing = this.load().documents[id];
    if (!existing) throw new NotFoundError('Document');
    return this.saveRecord(
      { id, expectedVersion, draft: toDraft(existing) },
      status === 'trashed' ? 'trashed' : 'restored',
      status === 'trashed' ? 'Moved to trash' : 'Restored from trash',
      status,
    );
  }

  async purgeDocument(id: string): Promise<void> {
    const data = this.load();
    const existing = data.documents[id];
    if (!existing) throw new NotFoundError('Document');
    if (existing.status !== 'trashed')
      throw new ValidationError(['Only documents in the trash can be permanently deleted.']);
    delete data.documents[id];
    data.versions = data.versions.filter((v) => v.documentId !== id);
    // data.allocated keeps the number reserved forever: it is never released.
    data.audit.push({
      id: newId(), at: new Date().toISOString(), userId: MOCK_USER, userName: MOCK_USER_NAME, action: 'purged',
      documentId: id, documentNumber: existing.number, detail: 'Permanently deleted from trash',
    });
    this.persist(data);
  }

  async restoreVersion(documentId: string, version: number): Promise<DocumentRecord> {
    const data = this.load();
    const existing = data.documents[documentId];
    if (!existing) throw new NotFoundError('Document');
    const snap = data.versions.find((v) => v.documentId === documentId && v.version === version);
    if (!snap) throw new NotFoundError('Version');
    return this.saveRecord(
      { id: documentId, expectedVersion: existing.version, draft: toDraft(snap.snapshot) },
      'version_restored',
      `Restored version ${version} (from version ${existing.version})`,
    );
  }

  async getSettings(): Promise<CompanyProfile> {
    return this.load().settings ?? company;
  }

  async saveSettings(profile: CompanyProfile): Promise<CompanyProfile> {
    const data = this.load();
    data.settings = profile;
    data.audit.push({
      id: newId(), at: new Date().toISOString(), userId: MOCK_USER, userName: MOCK_USER_NAME, action: 'settings_updated',
      documentId: null, documentNumber: '', detail: 'Company and document settings updated',
    });
    this.persist(data);
    return profile;
  }

  /** Mock mode has no other computers to listen to. */
  subscribe(): () => void {
    return () => undefined;
  }

  async listProfiles(): Promise<Profile[]> {
    return [...this.load().profiles].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addUser(input: { fullName: string; email: string; password: string; role: 'admin' | 'employee' }): Promise<Profile> {
    const data = this.load();
    if (!input.fullName.trim() || !input.email.trim()) throw new ValidationError(['Full name and email are required.']);
    if (input.password.length < 8) throw new ValidationError(['The password must be at least 8 characters.']);
    const exists = data.profiles.find((p) => p.email.toLowerCase() === input.email.trim().toLowerCase());
    if (exists) throw new ValidationError(['An account with this email already exists.']);
    const now = new Date().toISOString();
    const profile: Profile = {
      id: newId(),
      fullName: input.fullName.trim(),
      email: input.email.trim(),
      role: input.role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    data.profiles.push(profile);
    data.audit.push({
      id: newId(), at: now, userId: MOCK_USER, userName: MOCK_USER_NAME, action: 'user_changed',
      documentId: null, documentNumber: '', detail: `Added employee ${profile.fullName} (${profile.email}) - active`,
    });
    this.persist(data);
    return profile;
  }

  async listPayments(): Promise<Payment[]> {
    return [...this.load().payments].sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.createdAt.localeCompare(a.createdAt));
  }

  async addPayment(input: { documentId: string; amountCents: number; paidOn: string; method: PaymentMethod; note: string }): Promise<Payment> {
    const data = this.load();
    const doc = data.documents[input.documentId];
    if (!doc || doc.status !== 'active') throw new NotFoundError('Document');
    if (doc.type !== 'invoice') throw new ValidationError(['Payments can only be recorded against invoices.']);
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new ValidationError(['Enter an amount greater than zero.']);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) throw new ValidationError(['Enter the payment date.']);
    const total = calculateTotals(doc.items, doc.discount, doc.tax).totalCents;
    const paid = data.payments.filter((p) => p.documentId === doc.id).reduce((s, p) => s + p.amountCents, 0);
    if (paid + input.amountCents > total) throw new ValidationError(['The payment is more than the balance still owed on this invoice.']);
    const payment: Payment = {
      id: newId(), documentId: doc.id, amountCents: input.amountCents, paidOn: input.paidOn,
      method: input.method, note: input.note.trim(), createdAt: new Date().toISOString(),
    };
    data.payments.push(payment);
    data.audit.push({
      id: newId(), at: payment.createdAt, userId: MOCK_USER, userName: MOCK_USER_NAME, action: 'payment_recorded',
      documentId: doc.id, documentNumber: doc.number, detail: `Payment recorded on ${doc.number}`,
    });
    this.persist(data);
    return payment;
  }

  async deletePayment(id: string): Promise<void> {
    const data = this.load();
    const p = data.payments.find((x) => x.id === id);
    if (!p) throw new NotFoundError('Payment');
    data.payments = data.payments.filter((x) => x.id !== id);
    const doc = data.documents[p.documentId];
    data.audit.push({
      id: newId(), at: new Date().toISOString(), userId: MOCK_USER, userName: MOCK_USER_NAME, action: 'payment_deleted',
      documentId: p.documentId, documentNumber: doc?.number ?? '', detail: `Payment removed from ${doc?.number ?? ''}`,
    });
    this.persist(data);
  }

  private figuresHash = '69da06e38c3cbf801682db81226a1847f536c632c2fbb2e2ba21ec256206f7dc';
  private static async sha256(value: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async verifyFiguresPasscode(code: string): Promise<boolean> {
    return (await MockRepository.sha256(code)) === this.figuresHash;
  }
  async setFiguresPasscode(code: string): Promise<void> {
    if (code.length < 6) throw new ValidationError(['The passcode must be at least 6 characters.']);
    this.figuresHash = await MockRepository.sha256(code);
  }

  async deleteProfile(id: string): Promise<void> {
    const data = this.load();
    const target = data.profiles.find((p) => p.id === id);
    if (!target) throw new NotFoundError('Employee');
    const remainingAdmins = data.profiles.filter(
      (p) => p.id !== id && p.role === 'admin' && p.isActive,
    );
    if (target.role === 'admin' && target.isActive && remainingAdmins.length === 0) {
      throw new ValidationError(['At least one active administrator must remain.']);
    }
    data.profiles = data.profiles.filter((p) => p.id !== id);
    const now = new Date().toISOString();
    data.audit.push({
      id: newId(), at: now, userId: MOCK_USER, userName: MOCK_USER_NAME, action: 'user_changed',
      documentId: null, documentNumber: '', detail: `Deleted employee ${target.fullName} (${target.email})`,
    });
    this.persist(data);
  }

  async deleteHistory(): Promise<number> {
    const data = this.load();
    const moved = data.audit.length;
    const deletedAt = new Date().toISOString();
    if (moved > 0 || data.versions.length > 0) {
      data.historyTrash.push({ deletedAt, audit: data.audit, versions: data.versions });
    }
    data.audit = [{
      id: newId(), at: deletedAt, userId: MOCK_USER, userName: MOCK_USER_NAME, action: 'history_cleared',
      documentId: null, documentNumber: '', detail: `History moved to the trash (${moved} audit entries)`,
    }];
    data.versions = [];
    this.persist(data);
    return moved;
  }

  async listTrashedHistory(): Promise<HistoryBatch[]> {
    return [...this.load().historyTrash]
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
      .map((b) => ({ deletedAt: b.deletedAt, auditCount: b.audit.length, versionCount: b.versions.length }));
  }

  async restoreHistory(deletedAt: string): Promise<void> {
    const data = this.load();
    const batch = data.historyTrash.find((b) => b.deletedAt === deletedAt);
    if (!batch) throw new NotFoundError('History');
    data.historyTrash = data.historyTrash.filter((b) => b !== batch);
    data.audit = [...batch.audit, ...data.audit].sort((a, b) => a.at.localeCompare(b.at));
    data.versions = [...batch.versions, ...data.versions];
    data.audit.push({
      id: newId(), at: new Date().toISOString(), userId: MOCK_USER, userName: MOCK_USER_NAME, action: 'history_restored',
      documentId: null, documentNumber: '', detail: `History restored from the trash (${batch.audit.length} audit entries)`,
    });
    this.persist(data);
  }

  async purgeHistory(deletedAt: string): Promise<void> {
    const data = this.load();
    const batch = data.historyTrash.find((b) => b.deletedAt === deletedAt);
    if (!batch) throw new NotFoundError('History');
    data.historyTrash = data.historyTrash.filter((b) => b !== batch);
    data.audit.push({
      id: newId(), at: new Date().toISOString(), userId: MOCK_USER, userName: MOCK_USER_NAME, action: 'history_purged',
      documentId: null, documentNumber: '', detail: `${batch.audit.length} trashed audit entries permanently deleted`,
    });
    this.persist(data);
  }

  async setProfile(input: ProfileUpdate): Promise<Profile> {
    const data = this.load();
    const target = data.profiles.find((p) => p.id === input.id);
    if (!target) throw new NotFoundError('Employee');
    if (!input.fullName.trim()) throw new ValidationError(['Employee name is required.']);
    if (
      target.role === 'admin' &&
      target.isActive &&
      (input.role !== 'admin' || !input.isActive) &&
      !data.profiles.some((p) => p.id !== target.id && p.role === 'admin' && p.isActive)
    ) {
      throw new ValidationError(['At least one active administrator must remain.']);
    }
    const updated: Profile = {
      ...target,
      fullName: input.fullName.trim(),
      role: input.role,
      isActive: input.isActive,
      updatedAt: new Date().toISOString(),
    };
    data.profiles = data.profiles.map((p) => (p.id === input.id ? updated : p));
    data.audit.push({
      id: newId(), at: updated.updatedAt, userId: MOCK_USER, userName: MOCK_USER_NAME, action: 'user_changed',
      documentId: null, documentNumber: '',
      detail: `Updated ${updated.fullName}: role=${updated.role}, active=${updated.isActive}`,
    });
    this.persist(data);
    return updated;
  }

  async exportBundle(): Promise<BackupBundle> {
    const data = this.load();
    return {
      app: 'maish-invoice-manager',
      schema: 1,
      exportedAt: new Date().toISOString(),
      settings: data.settings ?? company,
      profiles: data.profiles,
      customers: Object.values(data.customers),
      documents: Object.values(data.documents),
      versions: data.versions,
      audit: data.audit,
      payments: data.payments,
    };
  }

  private upsertCustomer(data: StoreData, input: CustomerInput, now: string): Customer {
    const byId = input.id ? data.customers[input.id] : undefined;
    const existing =
      byId ?? Object.values(data.customers).find((c) => c.name.toLowerCase() === input.name.trim().toLowerCase());
    const c: Customer = {
      id: existing?.id ?? newId(),
      name: input.name.trim(),
      phone: input.phone.trim(),
      email: input.email.trim(),
      address: input.address.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    data.customers[c.id] = c;
    return c;
  }
}

/** The editable fields of a record as a fresh draft (copies items so callers can mutate freely). */
function toDraft(r: DocumentRecord): DocumentDraft {
  return {
    type: r.type,
    number: r.number,
    issueDate: r.issueDate,
    orderNumber: r.orderNumber,
    customerId: r.customerId,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    customerEmail: r.customerEmail,
    customerAddress: r.customerAddress,
    items: r.items.map((i) => ({ ...i })),
    discount: r.discount ? { ...r.discount } : null,
    tax: r.tax ? { ...r.tax } : null,
    paymentTerms: r.paymentTerms,
    notes: r.notes,
  };
}
