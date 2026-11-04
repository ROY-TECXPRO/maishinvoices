import type { Cents } from './money';

export type DocumentType = 'quotation' | 'invoice';
export type DocumentStatus = 'active' | 'trashed';

export interface ItemLine {
  id: string;
  kind: 'item';
  description: string;
  /** Up to 3 decimal places. */
  quantity: number;
  unitPriceCents: Cents;
}

/** Group heading such as "FLEECE" or "HEAD CHEF". Carries no quantity or amount. */
export interface HeadingLine {
  id: string;
  kind: 'heading';
  description: string;
}

export type LineItem = ItemLine | HeadingLine;

export type DiscountSpec =
  | { mode: 'percent'; basisPoints: number }
  | { mode: 'fixed'; cents: Cents };

/** Optional, explicit, per-document. No tax is ever applied unless this is set. */
export interface TaxSpec {
  label: string;
  basisPoints: number;
}

export interface DocumentDraft {
  type: DocumentType;
  number: string;
  /** ISO date, YYYY-MM-DD */
  issueDate: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  items: LineItem[];
  /** Invoices only. Always null on quotations. */
  discount: DiscountSpec | null;
  /** Invoices only. Always null on quotations. */
  tax: TaxSpec | null;
  paymentTerms: string;
  notes: string;
}

export interface DocumentRecord extends DocumentDraft {
  id: string;
  /** Optimistic-lock counter. Incremented on every save. */
  version: number;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  version: number;
  snapshot: DocumentRecord;
  savedAt: string;
  savedBy: string;
}

export type AuditAction =
  | 'created'
  | 'updated'
  | 'trashed'
  | 'restored'
  | 'duplicated'
  | 'converted'
  | 'version_restored'
  | 'purged'
  | 'customer_updated'
  | 'settings_updated'
  | 'user_changed'
  | 'customer_trashed'
  | 'customer_restored'
  | 'customer_purged'
  | 'passcode_changed'
  | 'payment_recorded'
  | 'payment_deleted'
  | 'history_cleared'
  | 'history_restored'
  | 'history_purged';

export interface AuditEntry {
  id: string;
  at: string;
  userId: string;
  /** Display name captured at write time (profiles can be renamed later). */
  userName: string;
  action: AuditAction;
  /** null for entries that are not tied to one document (settings, users). */
  documentId: string | null;
  documentNumber: string;
  detail: string;
}

export type UserRole = 'admin' | 'employee';

export interface Profile {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PaymentMethod = 'cash' | 'mpesa' | 'bank' | 'cheque' | 'other';

/** Money received against an invoice. Integer cents; never against a quotation. */
export interface Payment {
  id: string;
  documentId: string;
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  note: string;
  createdAt: string;
}

/** History (audit entries + version snapshots) that was cleared into the Trash in one go. */
export interface HistoryBatch {
  /** ISO timestamp of the clearing; identifies the batch. */
  deletedAt: string;
  auditCount: number;
  versionCount: number;
}
