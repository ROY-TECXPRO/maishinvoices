/**
 * Server-side copy of the allowlisted AI action interface.
 * Generated from src/ai/actions.ts and src/ai/validate.ts: edit those, then copy (keep them identical).
 * This is the source of truth for what the AI assistant can execute.
 */

export interface AiItemInput {
  description: string;
  /** Up to 3 decimals. */
  quantity: number;
  /** Integer cents (KSh 1,200 = 120000). */
  unitPriceCents: number;
  kind?: 'item' | 'heading';
}

export interface AiSearchDocuments {
  kind: 'search_documents';
  type?: 'quotation' | 'invoice';
  status?: 'active' | 'trashed';
  search?: string;
  from?: string;
  to?: string;
}
export interface AiGetDocument { kind: 'get_document'; id?: string; number?: string }
export interface AiCreateDocument {
  kind: 'create_document';
  type: 'quotation' | 'invoice';
  customerName: string;
  issueDate?: string;
  orderNumber?: string;
  items: AiItemInput[];
  paymentTerms?: string;
  notes?: string;
}
export interface AiUpdateDocument {
  kind: 'update_document';
  id?: string;
  /** Document number such as INV-2026-4001, used when the id is not known. */
  number?: string;
  set?: Record<string, string>;
  items?: AiItemInput[];
}
export interface AiConvertInvoice { kind: 'convert_to_invoice'; id?: string; number?: string }
export interface AiDuplicateDocument { kind: 'duplicate_document'; id?: string; number?: string }
export interface AiTrashDocument { kind: 'trash_document'; id?: string; number?: string }
export interface AiRestoreDocument { kind: 'restore_document'; id?: string; number?: string }
export interface AiSaveCustomer { kind: 'save_customer'; id?: string; name: string; phone?: string; email?: string; address?: string }
export interface AiTrashCustomer { kind: 'trash_customer'; id?: string; name?: string }
export interface AiRestoreCustomer { kind: 'restore_customer'; id?: string; name?: string }
export interface AiRecordPayment {
  kind: 'record_payment';
  id?: string;
  number?: string;
  /** Integer cents (KSh 5,000 = 500000). */
  amountCents: number;
  paidOn?: string;
  method?: 'cash' | 'mpesa' | 'bank' | 'cheque' | 'other';
  note?: string;
}
export interface AiGetOutstanding { kind: 'get_outstanding' }
export interface AiSearchCustomers { kind: 'search_customers'; query?: string }
export interface AiGetReport {
  kind: 'get_report';
  scope: 'daily' | 'monthly' | 'annual' | 'customers';
  from?: string;
  to?: string;
  year?: number;
  month?: number;
}
export interface AiHelp { kind: 'help'; topic?: string }

export type AiAction =
  | AiSearchDocuments
  | AiGetDocument
  | AiCreateDocument
  | AiUpdateDocument
  | AiConvertInvoice
  | AiDuplicateDocument
  | AiTrashDocument
  | AiRestoreDocument
  | AiSaveCustomer
  | AiTrashCustomer
  | AiRestoreCustomer
  | AiRecordPayment
  | AiGetOutstanding
  | AiSearchCustomers
  | AiGetReport
  | AiHelp;

export type AiActionKind = AiAction['kind'];

export const AI_ACTION_KINDS: AiActionKind[] = [
  'search_documents',
  'get_document',
  'create_document',
  'update_document',
  'convert_to_invoice',
  'duplicate_document',
  'trash_document',
  'restore_document',
  'save_customer',
  'trash_customer',
  'restore_customer',
  'record_payment',
  'get_outstanding',
  'search_customers',
  'get_report',
  'help',
];

export const CONFIRM_REQUIRED: AiActionKind[] = ['trash_document', 'trash_customer'];
