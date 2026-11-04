import type {
  AuditEntry,
  Customer,
  DocumentRecord,
  DocumentVersion,
  LineItem,
  Profile,
} from '../../domain/types';
import type {
  AuditRow,
  CustomerRow,
  DocumentItemRow,
  DocumentRow,
  DocumentVersionRow,
  ProfileRow,
  SnapshotJson,
} from './dbTypes';

let fallbackId = 0;

/** Canonical "2026-10-19T12:34:56.789Z" regardless of how PostgREST formats the timestamp. */
export function isoTimestamp(value: string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

export function mapItems(rows: DocumentItemRow[]): LineItem[] {
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((r): LineItem =>
      r.kind === 'heading'
        ? { id: r.id, kind: 'heading', description: r.description }
        : {
            id: r.id,
            kind: 'item',
            description: r.description,
            quantity: Number(r.quantity ?? 0),
            unitPriceCents: Number(r.unit_price_cents ?? 0),
          },
    );
}

export function mapDocument(row: DocumentRow, itemRows: DocumentItemRow[]): DocumentRecord {
  return {
    id: row.id,
    type: row.type,
    number: row.number,
    issueDate: row.issue_date.slice(0, 10),
    orderNumber: row.order_number ?? '',
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone ?? '',
    customerEmail: row.customer_email ?? '',
    customerAddress: row.customer_address ?? '',
    items: mapItems(itemRows),
    discount: row.discount ?? null,
    tax: row.tax ?? null,
    paymentTerms: row.payment_terms ?? '',
    notes: row.notes ?? '',
    version: row.version,
    status: row.status,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
    createdBy: row.created_by ?? '',
  };
}

/** Maps a document_snapshot() JSON payload (save/duplicate/convert/version results). */
export function mapSnapshotToRecord(snapshot: unknown): DocumentRecord {
  const s = snapshot as SnapshotJson;
  const items: LineItem[] = (s.items ?? []).map((it) =>
    it.kind === 'heading'
      ? { id: it.id ?? `item-${fallbackId++}`, kind: 'heading', description: it.description }
      : {
          id: it.id ?? `item-${fallbackId++}`,
          kind: 'item',
          description: it.description,
          quantity: Number(it.quantity ?? 0),
          unitPriceCents: Number(it.unitPriceCents ?? 0),
        },
  );
  return {
    id: s.id,
    type: s.type,
    number: s.number,
    issueDate: s.issueDate.slice(0, 10),
    orderNumber: s.orderNumber ?? '',
    customerId: s.customerId ?? null,
    customerName: s.customerName,
    customerPhone: s.customerPhone ?? '',
    customerEmail: s.customerEmail ?? '',
    customerAddress: s.customerAddress ?? '',
    items,
    discount: s.discount ?? null,
    tax: s.tax ?? null,
    paymentTerms: s.paymentTerms ?? '',
    notes: s.notes ?? '',
    version: s.version,
    status: s.status,
    createdAt: isoTimestamp(s.createdAt),
    updatedAt: isoTimestamp(s.updatedAt),
    createdBy: s.createdBy ?? '',
  };
}

export function mapCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? '',
    email: row.email ?? '',
    address: row.address ?? '',
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

export function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

export function mapVersion(row: DocumentVersionRow): DocumentVersion {
  return {
    id: row.id,
    documentId: row.document_id,
    version: row.version,
    snapshot: mapSnapshotToRecord(row.snapshot),
    savedAt: isoTimestamp(row.saved_at),
    savedBy: row.saved_by ?? '',
  };
}

export function mapAudit(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    at: isoTimestamp(row.at),
    userId: row.user_id ?? '',
    userName: row.user_name ?? '',
    action: row.action,
    documentId: row.document_id,
    documentNumber: row.document_number ?? '',
    detail: row.detail ?? '',
  };
}
