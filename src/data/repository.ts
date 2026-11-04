import type {
  AuditEntry,
  Customer,
  DocumentDraft,
  DocumentRecord,
  DocumentStatus,
  DocumentType,
  DocumentVersion,
  HistoryBatch,
  Payment,
  PaymentMethod,
  Profile,
} from '../domain/types';
import type { CompanyProfile } from '../config/company';

export class ValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join(' '));
    this.name = 'ValidationError';
  }
}
export class DuplicateNumberError extends Error {
  constructor(public readonly number: string) {
    super(`Number ${number} is already allocated to another document.`);
    this.name = 'DuplicateNumberError';
  }
}
export class VersionConflictError extends Error {
  constructor() {
    super('This document was changed by someone else. Reload it before saving.');
    this.name = 'VersionConflictError';
  }
}
export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} was not found.`);
    this.name = 'NotFoundError';
  }
}

export interface DocumentFilter {
  search?: string;
  type?: DocumentType;
  status?: DocumentStatus;
  /** ISO date, inclusive lower bound on issue date. */
  from?: string;
  /** ISO date, inclusive upper bound on issue date. */
  to?: string;
  customerId?: string;
}

export interface SaveDocumentInput {
  /** Omit to create. */
  id?: string;
  /** Required when updating; must equal the stored version (optimistic locking). */
  expectedVersion?: number;
  draft: DocumentDraft;
}

export interface CustomerInput {
  id?: string | null;
  name: string;
  phone: string;
  email: string;
  address: string;
}

/** Result of a bulk or state-changing operation that the UI should surface. */
export type ChangeAction = 'duplicated' | 'converted' | 'trashed' | 'restored' | 'purged';

export interface ProfileUpdate {
  id: string;
  role: 'admin' | 'employee';
  isActive: boolean;
  fullName: string;
}

/** Complete business-data export for backup/restore (administrator only). */
export interface BackupBundle {
  app: 'maish-invoice-manager';
  schema: number;
  exportedAt: string;
  settings: CompanyProfile;
  profiles: Profile[];
  customers: Customer[];
  documents: DocumentRecord[];
  versions: DocumentVersion[];
  audit: AuditEntry[];
  payments?: Payment[];
}

/**
 * The only thing the UI talks to. `MockRepository` implements it for development and tests;
 * `SupabaseRepository` implements it against the real database. Authoritative numbering,
 * identity and audit MUST be enforced server-side in the Supabase version.
 */
export interface Repository {
  readonly mode: 'mock' | 'supabase';
  /** Suggested next number. Not a reservation; the save call is authoritative. */
  getNextNumber(type: DocumentType, issueDate: string): Promise<string>;
  listDocuments(filter?: DocumentFilter): Promise<DocumentRecord[]>;
  getDocument(id: string): Promise<DocumentRecord | null>;
  saveDocument(input: SaveDocumentInput): Promise<DocumentRecord>;
  /** Copies an active document as a new draft with a fresh number. Original untouched. */
  duplicateDocument(id: string): Promise<DocumentRecord>;
  /** Creates a NEW invoice from a quotation. The quotation is preserved unchanged. */
  convertToInvoice(id: string): Promise<DocumentRecord>;
  /** Move to trash / restore. Recoverable; bumps the version and writes audit. */
  setDocumentStatus(id: string, status: 'active' | 'trashed', expectedVersion: number): Promise<DocumentRecord>;
  /** Permanently remove a trashed document. Admin-only in Supabase mode. */
  purgeDocument(id: string): Promise<void>;
  listVersions(documentId: string): Promise<DocumentVersion[]>;
  /** Saves the chosen snapshot's contents as a new version of the same document. */
  restoreVersion(documentId: string, version: number): Promise<DocumentRecord>;
  listAudit(documentId?: string): Promise<AuditEntry[]>;
  listCustomers(): Promise<Customer[]>;
  /** Admin only. Creates a login account that is ACTIVE immediately: the person can sign in with this email and password and use the whole software. */
  addUser(input: { fullName: string; email: string; password: string; role: 'admin' | 'employee' }): Promise<Profile>;
  /** Checks the dashboard passcode on the server. Never returns the passcode. Throws after too many wrong attempts. */
  verifyFiguresPasscode(code: string): Promise<boolean>;
  /** Administrator only: replaces the dashboard passcode. */
  setFiguresPasscode(code: string): Promise<void>;
  /** Deletes an employee account. Admin only; the last active administrator cannot be removed. */
  deleteProfile(id: string): Promise<void>;
  /** Permanently clears all audit/history entries. Admin only. */
  /** Administrator only. Moves ALL audit entries and version snapshots to the Trash (nothing is destroyed). Returns how many audit entries moved. */
  deleteHistory(): Promise<number>;
  /** History batches currently in the Trash, newest first. */
  listTrashedHistory(): Promise<HistoryBatch[]>;
  /** Brings a trashed history batch back. */
  restoreHistory(deletedAt: string): Promise<void>;
  /** Administrator only. Permanently deletes a trashed history batch. */
  purgeHistory(deletedAt: string): Promise<void>;
  saveCustomer(input: CustomerInput): Promise<Customer>;
  /** Soft-delete a customer (move to trash, keep recoverable). Admin only in Supabase mode. */
  deleteCustomer(id: string): Promise<void>;
  /** Restore a deleted customer from the trash. */
  /** Administrator only. Permanently deletes a customer that is in the Trash. */
  purgeCustomer(id: string): Promise<void>;
  restoreCustomer(id: string): Promise<Customer>;
  /** Deleted (trashed) customers. */
  listDeletedCustomers(): Promise<Customer[]>;
  /** Company + document defaults. Saving requires admin in Supabase mode. */
  getSettings(): Promise<CompanyProfile>;
  saveSettings(profile: CompanyProfile): Promise<CompanyProfile>;
  /** Employee accounts (admin-managed). Reading requires an active account. */
  listProfiles(): Promise<Profile[]>;
  /** Admin-only in Supabase mode; enforces the last-administrator rule server-side. */
  setProfile(input: ProfileUpdate): Promise<Profile>;
  /** Every payment recorded against invoices. */
  listPayments(): Promise<Payment[]>;
  /** Records money received. Invoices only; cannot exceed the balance still owed. */
  addPayment(input: { documentId: string; amountCents: number; paidOn: string; method: PaymentMethod; note: string }): Promise<Payment>;
  deletePayment(id: string): Promise<void>;
  /** Full business-data export for backup (admin in Supabase mode). */
  exportBundle(): Promise<BackupBundle>;
  /**
   * Notifies when records changed elsewhere (Supabase Realtime; a no-op in mock mode).
   * Returns an unsubscribe function. Handlers must refetch - they never receive payloads
   * that could overwrite unsaved editor state.
   */
  subscribe(onChange: (info: { table: string }) => void): () => void;
}
