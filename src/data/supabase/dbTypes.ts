import type { AuditAction, DiscountSpec, TaxSpec } from '../../domain/types';

/** Raw row shapes as returned by PostgREST (snake_case, dates/times as ISO strings). */

export interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'employee';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

export interface DocumentRow {
  id: string;
  type: 'quotation' | 'invoice';
  number: string;
  issue_date: string;
  order_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  customer_address: string;
  discount: DiscountSpec | null;
  tax: TaxSpec | null;
  payment_terms: string;
  notes: string;
  version: number;
  status: 'active' | 'trashed';
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface DocumentItemRow {
  id: string;
  document_id: string;
  position: number;
  kind: 'item' | 'heading';
  description: string;
  /** numeric(12,3) - PostgREST may deliver number or string depending on settings. */
  quantity: number | string | null;
  unit_price_cents: number | string | null;
}

export interface DocumentVersionRow {
  id: string;
  document_id: string;
  version: number;
  /** Full DocumentRecord JSON as built by document_snapshot(). */
  snapshot: unknown;
  saved_at: string;
  saved_by: string | null;
}

export interface AuditRow {
  id: string;
  at: string;
  user_id: string | null;
  user_name: string;
  action: AuditAction;
  document_id: string | null;
  document_number: string;
  detail: string;
}

/** Shape of the JSON returned by document_snapshot() / save_document(). */
export interface SnapshotJson {
  id: string;
  type: 'quotation' | 'invoice';
  number: string;
  issueDate: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  discount: DiscountSpec | null;
  tax: TaxSpec | null;
  paymentTerms: string;
  notes: string;
  items: Array<{
    id?: string;
    kind: 'item' | 'heading';
    description: string;
    quantity?: number | string | null;
    unitPriceCents?: number | string | null;
  }>;
  version: number;
  status: 'active' | 'trashed';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}
