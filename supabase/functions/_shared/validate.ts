import type { AiAction, AiItemInput } from './actions.ts';

const isStr = (v: unknown, max = 500): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1_000_000_000_00;
const isQty = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && Math.round(v * 1000) === v * 1000;

export function validAiItems(items: unknown): items is AiItemInput[] {
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) return false;
  return items.every((it): it is AiItemInput => {
    if (!it || typeof it !== 'object') return false;
    const item = it as Record<string, unknown>;
    const kind = item.kind ?? 'item';
    if (kind === 'heading') {
      return typeof item.description === 'string' && item.description.trim().length > 0 && item.description.trim().length <= 300;
    }
    if (kind !== 'item') return false;
    if (!isStr(item.description, 300)) return false;
    return isQty(item.quantity) && isCents(item.unitPriceCents);
  });
}

/**
 * Maps the snake_case / kebab-case field names models commonly emit
 * onto the camelCase field names the action contract uses.
 */
const FIELD_ALIASES: Record<string, string> = {
  customer_name: 'customerName',
  customer_id: 'customerId',
  customer_phone: 'customerPhone',
  customer_email: 'customerEmail',
  customer_address: 'customerAddress',
  unit_price: 'unitPriceCents',
  unit_price_cents: 'unitPriceCents',
  unitpricecents: 'unitPriceCents',
  unitprice: 'unitPriceCents',
  price_cents: 'unitPriceCents',
  price: 'unitPriceCents',
  issue_date: 'issueDate',
  order_number: 'orderNumber',
  payment_terms: 'paymentTerms',
  document_type: 'type',
  doc_type: 'type',
  action_kind: 'kind',
  actionKind: 'kind',
  action_name: 'kind',
  query_text: 'query',
  search_text: 'search',
};

function camelizeKey(key: string): string {
  if (FIELD_ALIASES[key]) return FIELD_ALIASES[key];
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[camelizeKey(k)] = camelizeKeys(v);
    }
    return out;
  }
  return value;
}

/**
 * Models frequently reply with an envelope such as
 *   {"action": "create_document", "parameters": {...}}
 * or use snake_case field names. This flattens those variants into the
 * single canonical shape the validator understands: { kind, ...fields }.
 */
export function normalizeAiActionInput(input: unknown): unknown[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const obj = input as Record<string, unknown>;

  const kind = obj.kind ?? obj.action ?? obj.action_kind ?? obj.actionKind ?? obj.action_name;
  const args =
    obj.params ?? obj.parameters ?? obj.args ?? obj.arguments ?? obj.payload ?? obj.data ?? obj.input;

  const variants: unknown[] = [];

  // 1. The object exactly as received, with keys camelized.
  variants.push(camelizeKeys(obj));

  // 2. Envelope flattened: { action, parameters } -> { kind, ...parameters }
  if (typeof kind === 'string') {
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      variants.push({ ...(camelizeKeys(args) as Record<string, unknown>), kind });
    }
    // 3. Flattened but keeping the sibling keys of the envelope.
    variants.push({ ...(camelizeKeys(obj) as Record<string, unknown>), kind });
  }

  return variants;
}

/**
 * Extracts every plausible action object out of a model reply, tolerating
 * markdown fences, surrounding prose, envelopes and snake_case keys.
 */
export function extractAiActionCandidates(text: string): unknown[] {
  const candidates: unknown[] = [];
  const withoutFences = text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1');
  const sources = [withoutFences, text];

  for (const source of sources) {
    try {
      candidates.push(JSON.parse(source.trim()));
    } catch {
      /* not a bare JSON document */
    }
    for (const block of source.match(/\{[\s\S]*\}/g) ?? []) {
      try {
        candidates.push(JSON.parse(block));
      } catch {
        /* not valid JSON */
      }
    }
  }

  return candidates.flatMap((raw) => normalizeAiActionInput(raw));
}

/**
 * Pulls the human-readable reply out of a model response that was not an
 * action. Handles the {"reply": "..."} object shape as well as plain text.
 */
export function extractAiReply(text: string): string {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const reply = (parsed as Record<string, unknown>).reply;
      if (typeof reply === 'string' && reply.trim()) return reply.trim();
    }
  } catch {
    /* not a JSON document */
  }
  return trimmed;
}

const isMethod = (v: unknown): v is 'cash' | 'mpesa' | 'bank' | 'cheque' | 'other' =>
  typeof v === 'string' && ['cash', 'mpesa', 'bank', 'cheque', 'other'].includes(v);

/** The document an action targets: its id or its number. Returns null when neither is usable. */
function target(a: Record<string, unknown>): { id?: string; number?: string } | null {
  const id = typeof a.id === 'string' && a.id.length > 0 ? a.id : undefined;
  const number = typeof a.number === 'string' && a.number.length > 0 ? a.number : undefined;
  if (id !== undefined && !isStr(id, 100)) return null;
  if (number !== undefined && !isStr(number, 40)) return null;
  if (!id && !number) return null;
  return { ...(id ? { id } : {}), ...(number ? { number } : {}) };
}

export function validateAiAction(input: unknown): AiAction | null {
  if (!input || typeof input !== 'object') return null;
  const a = input as Record<string, unknown>;
  if (typeof a.kind !== 'string') return null;

  switch (a.kind) {
    case 'search_documents':
      if (a.type !== undefined && a.type !== 'quotation' && a.type !== 'invoice') return null;
      if (a.status !== undefined && a.status !== 'active' && a.status !== 'trashed') return null;
      if (a.search !== undefined && !isStr(a.search, 200)) return null;
      if (a.from !== undefined && a.from !== '' && !isIsoDate(a.from)) return null;
      if (a.to !== undefined && a.to !== '' && !isIsoDate(a.to)) return null;
      return {
        kind: 'search_documents',
        type: a.type as 'quotation' | 'invoice' | undefined,
        status: a.status as 'active' | 'trashed' | undefined,
        search: typeof a.search === 'string' ? a.search : undefined,
        from: typeof a.from === 'string' ? a.from : undefined,
        to: typeof a.to === 'string' ? a.to : undefined,
      };
    case 'get_document':
      if (!isStr(a.id ?? '', 100) && !isStr(a.number ?? '', 40)) return null;
      if (!a.id && !a.number) return null;
      return {
        kind: 'get_document',
        id: typeof a.id === 'string' ? a.id : undefined,
        number: typeof a.number === 'string' ? a.number : undefined,
      };
    case 'create_document':
      if (a.type !== 'quotation' && a.type !== 'invoice') return null;
      if (!isStr(a.customerName, 200)) return null;
      if (a.issueDate !== undefined && a.issueDate !== '' && !isIsoDate(a.issueDate)) return null;
      if (a.orderNumber !== undefined && !isStr(a.orderNumber, 100)) return null;
      if (!validAiItems(a.items)) return null;
      if (a.paymentTerms !== undefined && !isStr(a.paymentTerms, 2000)) return null;
      if (a.notes !== undefined && !isStr(a.notes, 2000)) return null;
      return {
        kind: 'create_document',
        type: a.type,
        customerName: (a.customerName as string).trim(),
        issueDate: typeof a.issueDate === 'string' ? a.issueDate : undefined,
        orderNumber: typeof a.orderNumber === 'string' ? a.orderNumber : undefined,
        items: a.items as AiItemInput[],
        paymentTerms: typeof a.paymentTerms === 'string' ? a.paymentTerms : undefined,
        notes: typeof a.notes === 'string' ? a.notes : undefined,
      };
    case 'update_document': {
      const t = target(a);
      if (!t) return null;
      if (a.set !== undefined && (typeof a.set !== 'object' || a.set === null)) return null;
      if (a.items !== undefined && !validAiItems(a.items)) return null;
      if (a.set === undefined && a.items === undefined) return null;
      return {
        kind: 'update_document',
        ...t,
        set: (a.set as Record<string, string> | undefined),
        items: a.items as AiItemInput[] | undefined,
      };
    }
    case 'convert_to_invoice':
    case 'duplicate_document':
    case 'trash_document':
    case 'restore_document': {
      const t = target(a);
      if (!t) return null;
      return { kind: a.kind, ...t };
    }
    case 'save_customer': {
      if (!isStr(a.name, 200)) return null;
      for (const f of ['phone', 'email', 'address'] as const) {
        if (a[f] !== undefined && a[f] !== '' && !isStr(a[f], 300)) return null;
      }
      if (a.id !== undefined && !isStr(a.id, 100)) return null;
      return {
        kind: 'save_customer',
        ...(typeof a.id === 'string' ? { id: a.id } : {}),
        name: (a.name as string).trim(),
        ...(typeof a.phone === 'string' ? { phone: a.phone } : {}),
        ...(typeof a.email === 'string' ? { email: a.email } : {}),
        ...(typeof a.address === 'string' ? { address: a.address } : {}),
      };
    }
    case 'trash_customer':
    case 'restore_customer': {
      const id = typeof a.id === 'string' && a.id ? a.id : undefined;
      const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : undefined;
      if (!id && !name) return null;
      if ((id && !isStr(id, 100)) || (name && !isStr(name, 200))) return null;
      return { kind: a.kind, ...(id ? { id } : {}), ...(name ? { name } : {}) };
    }
    case 'record_payment': {
      const t = target(a);
      if (!t) return null;
      if (typeof a.amountCents !== 'number' || !Number.isInteger(a.amountCents) || a.amountCents <= 0 || a.amountCents >= 1_000_000_000_00) return null;
      if (a.paidOn !== undefined && a.paidOn !== '' && !isIsoDate(a.paidOn)) return null;
      if (a.method !== undefined && !isMethod(a.method)) return null;
      if (a.note !== undefined && a.note !== '' && !isStr(a.note, 300)) return null;
      return {
        kind: 'record_payment',
        ...t,
        amountCents: a.amountCents,
        ...(typeof a.paidOn === 'string' && a.paidOn ? { paidOn: a.paidOn } : {}),
        ...(isMethod(a.method) ? { method: a.method } : {}),
        ...(typeof a.note === 'string' && a.note ? { note: a.note } : {}),
      };
    }
    case 'get_outstanding':
      return { kind: 'get_outstanding' };
    case 'search_customers':
      if (a.query !== undefined && !isStr(a.query, 200)) return null;
      return { kind: 'search_customers', query: typeof a.query === 'string' ? a.query : undefined };
    case 'get_report':
      if (!['daily', 'monthly', 'annual', 'customers'].includes(a.scope as string)) return null;
      if (a.from !== undefined && a.from !== '' && !isIsoDate(a.from)) return null;
      if (a.to !== undefined && a.to !== '' && !isIsoDate(a.to)) return null;
      if (a.year !== undefined && (typeof a.year !== 'number' || a.year < 2000 || a.year > 2100)) return null;
      if (a.month !== undefined && (typeof a.month !== 'number' || a.month < 1 || a.month > 12)) return null;
      return {
        kind: 'get_report',
        scope: a.scope as 'daily' | 'monthly' | 'annual' | 'customers',
        from: typeof a.from === 'string' ? a.from : undefined,
        to: typeof a.to === 'string' ? a.to : undefined,
        year: typeof a.year === 'number' ? a.year : undefined,
        month: typeof a.month === 'number' ? a.month : undefined,
      };
    case 'help':
      if (a.topic !== undefined && !isStr(a.topic, 200)) return null;
      return { kind: 'help', topic: typeof a.topic === 'string' ? a.topic : undefined };
    default:
      return null;
  }
}
