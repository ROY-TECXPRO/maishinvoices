import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { normalizeDraft, validateDraft } from '../domain/validation';
import type {
  AuditEntry,
  Customer,
  DocumentDraft,
  DocumentRecord,
  DocumentType,
  DocumentVersion,
  HistoryBatch,
  Payment,
  PaymentMethod,
  Profile,
} from '../domain/types';
import { company, type CompanyProfile } from '../config/company';
import {
  ValidationError,
  type BackupBundle,
  type DocumentFilter,
  type ProfileUpdate,
  type Repository,
  type SaveDocumentInput,
} from './repository';
import { getSupabase } from './supabase/client';
import { functionErrorMessage } from './supabase/errors';
import {
  mapAudit,
  mapCustomer,
  mapDocument,
  mapProfile,
  mapSnapshotToRecord,
  mapVersion,
} from './supabase/mappers';
import type { AuditRow, CustomerRow, DocumentItemRow, DocumentRow, DocumentVersionRow, ProfileRow } from './supabase/dbTypes';
import { toRepositoryError } from './supabase/errors';

/** Converts the existing domain draft into the JSON payload save_document() expects. */
export function draftToJson(draft: DocumentDraft): Record<string, unknown> {
  return {
    type: draft.type,
    number: draft.number,
    issueDate: draft.issueDate,
    orderNumber: draft.orderNumber,
    customerId: draft.customerId,
    customerName: draft.customerName,
    customerPhone: draft.customerPhone,
    customerEmail: draft.customerEmail,
    customerAddress: draft.customerAddress,
    items: draft.items.map((i) =>
      i.kind === 'heading'
        ? { kind: 'heading', description: i.description }
        : { kind: 'item', description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents },
    ),
    discount: draft.discount,
    tax: draft.tax,
    paymentTerms: draft.paymentTerms,
    notes: draft.notes,
  };
}

/**
 * Real, authoritative repository. Reads go through RLS-protected tables; every
 * document write goes through the atomic save_document() PostgreSQL function
 * (validation + numbering reservation + items + version snapshot + audit in ONE
 * transaction). Optimistic locking errors surface as VersionConflictError.
 */
export class SupabaseRepository implements Repository {
  readonly mode = 'supabase' as const;
  private channel: RealtimeChannel | null = null;
  private listeners = new Set<(info: { table: string }) => void>();

  constructor(private readonly supabase: SupabaseClient = getSupabase()) {}

  async getNextNumber(type: DocumentType, issueDate: string): Promise<string> {
    const { data, error } = await this.supabase.rpc('next_document_number', {
      p_type: type,
      p_issue_date: issueDate,
    });
    if (error) throw toRepositoryError(error);
    return data as string;
  }

  private async fetchItemsFor(docIds: string[]): Promise<Map<string, DocumentItemRow[]>> {
    const map = new Map<string, DocumentItemRow[]>();
    if (!docIds.length) return map;
    const { data, error } = await this.supabase
      .from('document_items')
      .select('*')
      .in('document_id', docIds)
      .order('position', { ascending: true });
    if (error) throw toRepositoryError(error);
    for (const row of (data ?? []) as DocumentItemRow[]) {
      const list = map.get(row.document_id) ?? [];
      list.push(row);
      map.set(row.document_id, list);
    }
    return map;
  }

  async listDocuments(filter: DocumentFilter = {}): Promise<DocumentRecord[]> {
    let query = this.supabase
      .from('documents')
      .select('*')
      .eq('status', filter.status ?? 'active')
      .order('updated_at', { ascending: false });
    if (filter.type) query = query.eq('type', filter.type);
    if (filter.from) query = query.gte('issue_date', filter.from);
    if (filter.to) query = query.lte('issue_date', filter.to);
    if (filter.customerId) query = query.eq('customer_id', filter.customerId);
    const search = filter.search?.trim();
    if (search) {
      const safe = search.replace(/[%_,()]/g, ' ').trim();
      if (safe) query = query.or(`number.ilike.%${safe}%,customer_name.ilike.%${safe}%,order_number.ilike.%${safe}%`);
    }
    const { data, error } = await query;
    if (error) throw toRepositoryError(error);
    const rows = (data ?? []) as DocumentRow[];
    const items = await this.fetchItemsFor(rows.map((r) => r.id));
    return rows.map((r) => mapDocument(r, items.get(r.id) ?? []));
  }

  async getDocument(id: string): Promise<DocumentRecord | null> {
    const { data, error } = await this.supabase
      .from('documents')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw toRepositoryError(error);
    if (!data) return null;
    const items = await this.fetchItemsFor([id]);
    return mapDocument(data as DocumentRow, items.get(id) ?? []);
  }

  async saveDocument({ id, expectedVersion, draft }: SaveDocumentInput): Promise<DocumentRecord> {
    // Fast client-side validation (identical rules run again inside save_document()).
    const normalized = normalizeDraft(draft);
    const problems = validateDraft(normalized);
    if (problems.length) throw new ValidationError(problems);

    const { data, error } = await this.supabase.rpc('save_document', {
      p_id: id ?? null,
      p_expected_version: expectedVersion ?? null,
      p_draft: draftToJson(draft),
    });
    if (error) throw toRepositoryError(error, 'Document');
    return mapSnapshotToRecord(data);
  }

  async duplicateDocument(id: string): Promise<DocumentRecord> {
    const { data, error } = await this.supabase.rpc('duplicate_document', { p_id: id });
    if (error) throw toRepositoryError(error, 'Document');
    return mapSnapshotToRecord(data);
  }

  async convertToInvoice(id: string): Promise<DocumentRecord> {
    const { data, error } = await this.supabase.rpc('convert_to_invoice', { p_id: id });
    if (error) throw toRepositoryError(error, 'Document');
    return mapSnapshotToRecord(data);
  }

  async setDocumentStatus(
    id: string,
    status: 'active' | 'trashed',
    expectedVersion: number,
  ): Promise<DocumentRecord> {
    const { data, error } = await this.supabase.rpc('set_document_status', {
      p_id: id,
      p_status: status,
      p_expected_version: expectedVersion,
    });
    if (error) throw toRepositoryError(error, 'Document');
    return mapSnapshotToRecord(data);
  }

  async purgeDocument(id: string): Promise<void> {
    const { error } = await this.supabase.rpc('purge_document', { p_id: id });
    if (error) throw toRepositoryError(error, 'Document');
  }

  async listVersions(documentId: string): Promise<DocumentVersion[]> {
    const { data, error } = await this.supabase
      .from('document_versions')
      .select('*')
      .is('deleted_at', null)
      .eq('document_id', documentId)
      .order('version', { ascending: false });
    if (error) throw toRepositoryError(error, 'Version');
    return (data ?? []).map((row) => mapVersion(row as DocumentVersionRow));
  }

  async restoreVersion(documentId: string, version: number): Promise<DocumentRecord> {
    const { data, error } = await this.supabase.rpc('restore_document_version', {
      p_id: documentId,
      p_version: version,
    });
    if (error) throw toRepositoryError(error, 'Version');
    return mapSnapshotToRecord(data);
  }

  async listAudit(documentId?: string): Promise<AuditEntry[]> {
    let query = this.supabase
      .from('audit_entries')
      .select('*')
      .is('deleted_at', null)
      .order('at', { ascending: false })
      .limit(1000);
    if (documentId) query = query.eq('document_id', documentId);
    const { data, error } = await query;
    if (error) throw toRepositoryError(error);
    return (data ?? []).map((row) => mapAudit(row as AuditRow));
  }

  async listCustomers(): Promise<Customer[]> {
    const { data, error } = await this.supabase
      .from('customers')
      .select('*')
      .is('deleted_at', null)
      .order('name', { ascending: true });
    if (error) throw toRepositoryError(error);
    return (data ?? []).map((row) => mapCustomer(row as CustomerRow));
  }

  async listDeletedCustomers(): Promise<Customer[]> {
    const { data, error } = await this.supabase
      .from('customers')
      .select('*')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });
    if (error) throw toRepositoryError(error, 'Customer');
    return (data ?? []).map((row) => mapCustomer(row as CustomerRow));
  }

  async deleteCustomer(id: string): Promise<void> {
    const { error } = await this.supabase.rpc('delete_customer', { p_id: id });
    if (error) throw toRepositoryError(error, 'Customer');
  }

  async purgeCustomer(id: string): Promise<void> {
    const { error } = await this.supabase.rpc('purge_customer', { p_id: id });
    if (error) throw toRepositoryError(error, 'Customer');
  }

  async restoreCustomer(id: string): Promise<Customer> {
    const { data, error } = await this.supabase.rpc('restore_customer', { p_id: id });
    if (error) throw toRepositoryError(error, 'Customer');
    return mapCustomer(data as CustomerRow);
  }

  async saveCustomer(input: {
    id?: string | null;
    name: string;
    phone: string;
    email: string;
    address: string;
  }): Promise<Customer> {
    const { data, error } = await this.supabase.rpc('save_customer', {
      p_id: input.id ?? null,
      p_name: input.name,
      p_phone: input.phone,
      p_email: input.email,
      p_address: input.address,
    });
    if (error) throw toRepositoryError(error, 'Customer');
    return mapCustomer(data as CustomerRow);
  }

  async getSettings(): Promise<CompanyProfile> {
    const { data, error } = await this.supabase.rpc('get_company_settings');
    if (error) throw toRepositoryError(error);
    const stored = (data ?? {}) as Partial<CompanyProfile>;
    return { ...company, ...stored };
  }

  async saveSettings(profile: CompanyProfile): Promise<CompanyProfile> {
    const { data, error } = await this.supabase.rpc('save_company_settings', { p_data: profile });
    if (error) throw toRepositoryError(error);
    return { ...company, ...((data ?? {}) as Partial<CompanyProfile>) };
  }

  async listProfiles(): Promise<Profile[]> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw toRepositoryError(error);
    return (data ?? []).map((row) => mapProfile(row as ProfileRow));
  }

  async addUser(input: { fullName: string; email: string; password: string; role: 'admin' | 'employee' }): Promise<Profile> {
    const { data, error } = await this.supabase.functions.invoke('admin-users', {
      body: {
        operation: 'create_user',
        email: input.email,
        password: input.password,
        full_name: input.fullName,
        role: input.role,
      },
    });
    if (error) throw new Error(await functionErrorMessage(error, 'admin-users'));
    if (data?.error) throw new Error(String(data.error));
    return mapProfile(data.profile as ProfileRow);
  }

  async deleteProfile(id: string): Promise<void> {
    const { data, error } = await this.supabase.functions.invoke('admin-users', {
      body: { operation: 'delete_user', target_user_id: id },
    });
    if (error) throw new Error(await functionErrorMessage(error, 'admin-users'));
    if (data?.error) throw new Error(String(data.error));
  }

  async listPayments(): Promise<Payment[]> {
    const { data, error } = await this.supabase
      .from('payments')
      .select('*')
      .order('paid_on', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw toRepositoryError(error, 'Payment');
    return (data ?? []).map((r) => ({
      id: String(r.id),
      documentId: String(r.document_id),
      amountCents: Number(r.amount_cents),
      paidOn: String(r.paid_on),
      method: r.method as PaymentMethod,
      note: String(r.note ?? ''),
      createdAt: String(r.created_at),
    }));
  }

  async addPayment(input: { documentId: string; amountCents: number; paidOn: string; method: PaymentMethod; note: string }): Promise<Payment> {
    const { data, error } = await this.supabase.rpc('record_payment', {
      p_document_id: input.documentId,
      p_amount_cents: input.amountCents,
      p_paid_on: input.paidOn,
      p_method: input.method,
      p_note: input.note,
    });
    if (error) throw toRepositoryError(error, 'Document');
    return data as Payment;
  }

  async deletePayment(id: string): Promise<void> {
    const { error } = await this.supabase.rpc('delete_payment', { p_id: id });
    if (error) throw toRepositoryError(error, 'Payment');
  }

  async verifyFiguresPasscode(code: string): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('verify_figures_passcode', { p_code: code });
    if (error) {
      if (error.code === 'MXLIM') throw new Error('Too many wrong attempts. Try again in 10 minutes or contact the administrator.');
      throw toRepositoryError(error);
    }
    return data === true;
  }

  async setFiguresPasscode(code: string): Promise<void> {
    const { error } = await this.supabase.rpc('set_figures_passcode', { p_code: code });
    if (error) throw toRepositoryError(error);
  }

  async deleteHistory(): Promise<number> {
    const { data, error } = await this.supabase.rpc('clear_history');
    if (error) throw toRepositoryError(error);
    return Number(data ?? 0);
  }

  async listTrashedHistory(): Promise<HistoryBatch[]> {
    const { data, error } = await this.supabase.rpc('list_trashed_history');
    if (error) throw toRepositoryError(error);
    return (data ?? []) as HistoryBatch[];
  }

  async restoreHistory(deletedAt: string): Promise<void> {
    const { error } = await this.supabase.rpc('restore_history', { p_deleted_at: deletedAt });
    if (error) throw toRepositoryError(error);
  }

  async purgeHistory(deletedAt: string): Promise<void> {
    const { error } = await this.supabase.rpc('purge_history', { p_deleted_at: deletedAt });
    if (error) throw toRepositoryError(error);
  }

  async setProfile(input: ProfileUpdate): Promise<Profile> {
    const { data, error } = await this.supabase.rpc('admin_set_profile', {
      p_id: input.id,
      p_role: input.role,
      p_is_active: input.isActive,
      p_full_name: input.fullName,
    });
    if (error) throw toRepositoryError(error, 'Employee');
    return mapProfile(data as ProfileRow);
  }

  /** Admin data export: everything needed to rebuild customers/documents/items/history. */
  async exportBundle(): Promise<BackupBundle> {
    const settings = await this.getSettings();
    const profiles = await this.listProfiles();
    const customers = await this.listCustomers();
    const active = await this.listDocuments({ status: 'active' });
    const trashed = await this.listDocuments({ status: 'trashed' });
    const audit = await this.listAudit();
    const payments = await this.listPayments();
    const documents: DocumentRecord[] = [...active, ...trashed];
    const versions: DocumentVersion[] = [];
    for (const doc of documents) {
      versions.push(...(await this.listVersions(doc.id)));
    }
    return {
      app: 'maish-invoice-manager',
      schema: 1,
      exportedAt: new Date().toISOString(),
      settings,
      profiles,
      customers,
      documents,
      versions,
      audit,
      payments,
    };
  }

  /**
   * Realtime: refetch-only notifications. Payloads never reach editor state, so an
   * employee's unsaved work can't be overwritten by a remote change.
   * Supports many concurrent subscribers over a single channel.
   */
  subscribe(onChange: (info: { table: string }) => void): () => void {
    this.listeners.add(onChange);
    if (!this.channel) {
      const channel = this.supabase.channel(`maish-changes-${Math.random().toString(36).slice(2)}`);
      for (const table of ['documents', 'customers', 'profiles', 'company_settings', 'payments']) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          (payload) => this.emit(payload.table),
        );
      }
      channel.subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.emit('connection');
        }
      });
      this.channel = channel;
    }
    return () => {
      this.listeners.delete(onChange);
      if (this.listeners.size === 0 && this.channel) {
        const ch = this.channel;
        this.channel = null;
        void this.supabase.removeChannel(ch);
      }
    };
  }

  private emit(table: string): void {
    for (const listener of [...this.listeners]) listener({ table });
  }
}
