-- Maish Invoice & Quotation Manager
-- Migration 0003: authoritative server-side functions.
-- All numbering, saving, duplication, conversion, trash/restore, version restore,
-- purge (admin), settings and profile administration happen in transactions here.
-- Clients never write documents/items/versions/audit rows directly.
-- Error contract (SQLSTATE -> client error):
--   MX401 not signed in, MX403 not authorized, MX404 not found,
--   MXVAL validation (detail = JSON array of problems),
--   MXDUP duplicate number (detail = {"number": ...}),
--   MXCON version conflict (optimistic locking).

-- ---------------------------------------------------------------------------
-- Suggest the next free number for a type/year. Read-only: NOT a reservation.
-- ---------------------------------------------------------------------------
create or replace function public.next_document_number(p_type text, p_issue_date date)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prefix text;
  v_year integer;
  v_seq integer;
  v_number text;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  if p_type not in ('quotation', 'invoice') then
    raise exception 'VALIDATION' using errcode = 'MXVAL',
      detail = '["Unknown document type."]';
  end if;
  v_prefix := case when p_type = 'quotation' then 'QT' else 'INV' end;
  v_year := extract(year from p_issue_date)::integer;
  select next_sequence into v_seq from public.document_number_sequences where type = p_type;
  if v_seq is null then v_seq := 3999; end if;
  loop
    v_number := v_prefix || '-' || v_year || '-' || v_seq;
    exit when not exists (select 1 from public.document_number_allocations where number = v_number);
    v_seq := v_seq + 1;
  end loop;
  return v_number;
end;
$$;

-- ---------------------------------------------------------------------------
-- Full DocumentRecord snapshot in the exact JSON shape the client expects.
-- ---------------------------------------------------------------------------
create or replace function public.document_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', d.id,
    'type', d.type,
    'number', d.number,
    'issueDate', to_char(d.issue_date, 'YYYY-MM-DD'),
    'orderNumber', d.order_number,
    'customerId', d.customer_id,
    'customerName', d.customer_name,
    'customerPhone', d.customer_phone,
    'customerEmail', d.customer_email,
    'customerAddress', d.customer_address,
    'discount', d.discount,
    'tax', d.tax,
    'paymentTerms', d.payment_terms,
    'notes', d.notes,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'kind', i.kind,
          'description', i.description,
          'quantity', case when i.kind = 'item' then i.quantity else null end,
          'unitPriceCents', case when i.kind = 'item' then i.unit_price_cents else null end
        )
        order by i.position
      )
      from public.document_items i where i.document_id = d.id
    ), '[]'::jsonb),
    'version', d.version,
    'status', d.status,
    'createdAt', to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(d.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdBy', coalesce(d.created_by::text, '')
  )
  from public.documents d
  where d.id = p_id;
$$;

-- Editable fields only (used to rebuild a draft from a stored row / snapshot).
create or replace function public.document_to_draft(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select public.document_snapshot(p_id) - 'id' - 'version' - 'status' - 'createdAt' - 'updatedAt' - 'createdBy';
$$;

-- ---------------------------------------------------------------------------
-- save_document: the single authoritative write path for documents.
-- Atomically: authorizes the employee, validates the payload (mirror of the
-- client-side domain validation), enforces optimistic locking, reserves the
-- number (unique + never released), upserts customer + document + ordered items,
-- stores a version snapshot and writes the audit entry - all in ONE transaction.
-- p_action/p_detail/p_status are used by internal wrappers (duplicate/convert/
-- trash/restore/version-restore); normal client saves pass only the first three.
-- Error contract (SQLSTATE): MX401 not signed in, MX403 not authorized,
-- MX404 not found, MXVAL validation (detail = JSON array of problems),
-- MXDUP duplicate number (detail = {"number":...}), MXCON version conflict.
-- ---------------------------------------------------------------------------
create or replace function public.save_document(
  p_id uuid,
  p_expected_version integer,
  p_draft jsonb,
  p_action text default null,
  p_detail text default null,
  p_status text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_type text := coalesce(p_draft ->> 'type', '');
  v_number text := upper(coalesce(p_draft ->> 'number', ''));
  v_issue date;
  v_issue_ok boolean := false;
  v_items jsonb := case when jsonb_typeof(p_draft -> 'items') = 'array'
                    then p_draft -> 'items' else '[]'::jsonb end;
  v_discount jsonb := case when jsonb_typeof(p_draft -> 'discount') = 'object'
                      then p_draft -> 'discount' else null end;
  v_tax jsonb := case when jsonb_typeof(p_draft -> 'tax') = 'object'
                 then p_draft -> 'tax' else null end;
  v_errors text[] := '{}'::text[];
  v_owner_row public.document_number_allocations%rowtype;
  v_customer_id uuid;
  v_customer_name text := btrim(coalesce(p_draft ->> 'customerName', ''));
  v_record public.documents%rowtype;
  v_snapshot jsonb;
  v_action text := coalesce(p_action, case when p_id is null then 'created' else 'updated' end);
  v_seq integer;
  r record;
begin
  -- 1. authorize -------------------------------------------------------------
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'MX401';
  end if;
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;

  -- 2. validate payload (mirrors src/domain/validation.ts) --------------------
  if v_type not in ('quotation', 'invoice') then
    v_errors := v_errors || 'Document type must be quotation or invoice.';
  end if;
  begin
    v_issue := (p_draft ->> 'issueDate')::date;
    v_issue_ok := true;
  exception when others then
    v_issue_ok := false;
  end;
  if not v_issue_ok or v_issue is null then
    v_errors := v_errors || 'Date is not valid.';
  end if;
  if v_customer_name = '' then
    v_errors := v_errors || 'Customer name is required.';
  end if;
  if v_number !~ '^(QT|INV)-[0-9]{4}-[0-9]{4,}$' then
    v_errors := v_errors || 'Document number must look like QT-2026-3999.';
  elsif v_type = 'quotation' and v_number not like 'QT-%' then
    v_errors := v_errors || 'A quotation number must start with QT-.';
  elsif v_type = 'invoice' and v_number not like 'INV-%' then
    v_errors := v_errors || 'An invoice number must start with INV-.';
  end if;
  if v_type = 'quotation' then
    if v_discount is not null then
      v_errors := v_errors || 'Quotations cannot carry a discount.';
    end if;
    if v_tax is not null then
      v_errors := v_errors || 'Quotations cannot carry tax.';
    end if;
  end if;
  if v_discount is not null then
    if v_discount ->> 'mode' = 'percent' then
      if v_discount ->> 'basisPoints' !~ '^[0-9]+$' then
        v_errors := v_errors || 'Discount percentage must be between 0 and 100.';
      elsif (v_discount ->> 'basisPoints')::integer > 10000 then
        v_errors := v_errors || 'Discount percentage must be between 0 and 100.';
      end if;
    elsif v_discount ->> 'mode' = 'fixed' then
      if v_discount ->> 'cents' !~ '^[0-9]+$' then
        v_errors := v_errors || 'Discount cannot be negative.';
      end if;
    else
      v_errors := v_errors || 'Discount is not valid.';
    end if;
  end if;
  if v_tax is not null then
    if btrim(coalesce(v_tax ->> 'label', '')) = '' then
      v_errors := v_errors || 'Tax needs a label (for example "VAT").';
    end if;
    if v_tax ->> 'basisPoints' !~ '^[0-9]+$' then
      v_errors := v_errors || 'Tax rate must be between 0 and 100.';
    elsif (v_tax ->> 'basisPoints')::integer > 10000 then
      v_errors := v_errors || 'Tax rate must be between 0 and 100.';
    end if;
  end if;
  if jsonb_array_length(v_items) = 0 then
    v_errors := v_errors || 'Add at least one line item.';
  end if;
  for r in select elem, ord from jsonb_array_elements(v_items) with ordinality as t(elem, ord) loop
    if r.elem ->> 'kind' not in ('item', 'heading') then
      v_errors := v_errors || format('Row %s: unknown row type.', r.ord);
    else
      if btrim(coalesce(r.elem ->> 'description', '')) = '' then
        v_errors := v_errors || format('Row %s: description is required.', r.ord);
      end if;
      if r.elem ->> 'kind' = 'item' then
        if coalesce(r.elem ->> 'quantity', '') !~ '^[0-9]+(\.[0-9]{1,3})?$' then
          v_errors := v_errors || format('Row %s: enter a quantity greater than zero (up to 3 decimals).', r.ord);
        elsif (r.elem ->> 'quantity')::numeric <= 0 then
          v_errors := v_errors || format('Row %s: quantity must be greater than zero.', r.ord);
        end if;
        if coalesce(r.elem ->> 'unitPriceCents', '') !~ '^[0-9]+$' then
          v_errors := v_errors || format('Row %s: unit price is not valid.', r.ord);
        end if;
      end if;
    end if;
  end loop;
  if array_length(v_errors, 1) > 0 and coalesce(p_status, '') <> 'trashed' then
    raise exception 'VALIDATION' using errcode = 'MXVAL',
      detail = coalesce(array_to_json(v_errors)::text, '[]');
  end if;

  -- 3. optimistic locking + type immutability --------------------------------
  if p_id is not null then
    select * into v_record from public.documents where id = p_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'MX404';
    end if;
    if v_record.version is distinct from p_expected_version then
      raise exception 'VERSION_CONFLICT' using errcode = 'MXCON';
    end if;
    if v_record.type <> v_type then
      raise exception 'VALIDATION' using errcode = 'MXVAL',
        detail = '["Document type cannot change after saving."]';
    end if;
  end if;

  -- 4. number reservation: unique now and forever ----------------------------
  select * into v_owner_row from public.document_number_allocations
  where number = v_number for update;
  if found and (p_id is null or v_owner_row.document_id is distinct from p_id) then
    raise exception 'DUPLICATE_NUMBER' using errcode = 'MXDUP',
      detail = json_build_object('number', v_number)::text;
  end if;

  -- 5. customer: reuse by id, then by name, else create; refresh contact details
  if p_draft ->> 'customerId' is not null
     and p_draft ->> 'customerId' not in ('', 'null') then
    begin
      v_customer_id := (p_draft ->> 'customerId')::uuid;
    exception when others then
      v_customer_id := null;
    end;
    if v_customer_id is not null
       and not exists (select 1 from public.customers where id = v_customer_id) then
      v_customer_id := null;
    end if;
  end if;
  if v_customer_id is null then
    select id into v_customer_id from public.customers
    where lower(name) = lower(v_customer_name)
    order by created_at
    limit 1;
  end if;
  if v_customer_id is null then
    insert into public.customers (name, phone, email, address, created_by)
    values (
      v_customer_name,
      btrim(coalesce(p_draft ->> 'customerPhone', '')),
      btrim(coalesce(p_draft ->> 'customerEmail', '')),
      btrim(coalesce(p_draft ->> 'customerAddress', '')),
      v_uid
    )
    returning id into v_customer_id;
  else
    update public.customers
    set name = v_customer_name,
        phone = btrim(coalesce(p_draft ->> 'customerPhone', '')),
        email = btrim(coalesce(p_draft ->> 'customerEmail', '')),
        address = btrim(coalesce(p_draft ->> 'customerAddress', ''))
    where id = v_customer_id;
  end if;

  -- 6. insert or update the document (unique number enforced by constraint too)
  begin
    if p_id is null then
      insert into public.documents (
        type, number, issue_date, order_number, customer_id,
        customer_name, customer_phone, customer_email, customer_address,
        discount, tax, payment_terms, notes,
        version, status, created_at, updated_at, created_by, updated_by
      ) values (
        v_type, v_number, v_issue, btrim(coalesce(p_draft ->> 'orderNumber', '')), v_customer_id,
        v_customer_name,
        btrim(coalesce(p_draft ->> 'customerPhone', '')),
        btrim(coalesce(p_draft ->> 'customerEmail', '')),
        btrim(coalesce(p_draft ->> 'customerAddress', '')),
        v_discount, v_tax,
        coalesce(p_draft ->> 'paymentTerms', ''), coalesce(p_draft ->> 'notes', ''),
        1, coalesce(p_status, 'active'), now(), now(), v_uid, v_uid
      )
      returning * into v_record;
    else
      update public.documents set
        number = v_number,
        issue_date = v_issue,
        order_number = btrim(coalesce(p_draft ->> 'orderNumber', '')),
        customer_id = v_customer_id,
        customer_name = v_customer_name,
        customer_phone = btrim(coalesce(p_draft ->> 'customerPhone', '')),
        customer_email = btrim(coalesce(p_draft ->> 'customerEmail', '')),
        customer_address = btrim(coalesce(p_draft ->> 'customerAddress', '')),
        discount = v_discount,
        tax = v_tax,
        payment_terms = coalesce(p_draft ->> 'paymentTerms', ''),
        notes = coalesce(p_draft ->> 'notes', ''),
        version = v_record.version + 1,
        status = coalesce(p_status, v_record.status),
        updated_at = now(),
        updated_by = v_uid
      where id = p_id
      returning * into v_record;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE_NUMBER' using errcode = 'MXDUP',
      detail = json_build_object('number', v_number)::text;
  end;

  -- 7. reserve the number forever; advance the independent per-type sequence
  insert into public.document_number_allocations (number, document_id)
  values (v_number, v_record.id)
  on conflict (number) do update set document_id = excluded.document_id;

  v_seq := (substring(v_number from '([0-9]+)$'))::integer;
  update public.document_number_sequences
  set next_sequence = greatest(next_sequence, v_seq + 1)
  where type = v_type;

  -- 8. replace ordered line items (headings keep null quantity/price)
  delete from public.document_items where document_id = v_record.id;
  insert into public.document_items
    (document_id, position, kind, description, quantity, unit_price_cents)
  select
    v_record.id,
    t.ord - 1,
    t.elem ->> 'kind',
    btrim(t.elem ->> 'description'),
    case when t.elem ->> 'kind' = 'item' then (t.elem ->> 'quantity')::numeric else null end,
    case when t.elem ->> 'kind' = 'item' then (t.elem ->> 'unitPriceCents')::bigint else null end
  from jsonb_array_elements(v_items) with ordinality as t(elem, ord);

  -- 9. version snapshot (full record) + audit entry
  v_snapshot := public.document_snapshot(v_record.id);
  insert into public.document_versions (document_id, version, snapshot, saved_by)
  values (v_record.id, v_record.version, v_snapshot, v_uid);

  insert into public.audit_entries
    (at, user_id, user_name, action, document_id, document_number, detail)
  values (
    now(), v_uid, public.current_full_name(), v_action, v_record.id, v_record.number,
    coalesce(p_detail, 'Version ' || v_record.version)
  );

  return v_snapshot;
end;
$$;

-- ---------------------------------------------------------------------------
-- duplicate_document: copies an active document as a NEW document with a fresh
-- number (retried server-side if two employees suggest the same number at once).
-- ---------------------------------------------------------------------------
create or replace function public.duplicate_document(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_src public.documents%rowtype;
  v_draft jsonb;
  v_attempts integer := 0;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  select * into v_src from public.documents where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'MX404';
  end if;
  if v_src.status <> 'active' then
    raise exception 'NOT_FOUND' using errcode = 'MX404';
  end if;
  v_draft := public.document_to_draft(p_id);
  loop
    v_draft := jsonb_set(v_draft, '{number}',
      to_jsonb(public.next_document_number(v_src.type, v_src.issue_date)));
    begin
      return public.save_document(null, null, v_draft, 'duplicated',
        'Duplicated from ' || v_src.number, null);
    exception when sqlstate 'MXDUP' then
      v_attempts := v_attempts + 1;
      if v_attempts >= 5 then raise; end if;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- convert_to_invoice: creates a SEPARATE invoice from a quotation (today's date,
-- fresh INV number, adjustments cleared). The quotation stays untouched.
-- ---------------------------------------------------------------------------
create or replace function public.convert_to_invoice(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_src public.documents%rowtype;
  v_draft jsonb;
  v_issue date := (now() at time zone 'Africa/Nairobi')::date;
  v_attempts integer := 0;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  select * into v_src from public.documents where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'MX404';
  end if;
  if v_src.type <> 'quotation' then
    raise exception 'VALIDATION' using errcode = 'MXVAL',
      detail = '["Only quotations can be converted into invoices."]';
  end if;
  if v_src.status <> 'active' then
    raise exception 'NOT_FOUND' using errcode = 'MX404';
  end if;
  v_draft := public.document_to_draft(p_id);
  v_draft := jsonb_set(v_draft, '{type}', '"invoice"');
  v_draft := jsonb_set(v_draft, '{issueDate}', to_jsonb(to_char(v_issue, 'YYYY-MM-DD')));
  v_draft := jsonb_set(v_draft, '{discount}', 'null'::jsonb);
  v_draft := jsonb_set(v_draft, '{tax}', 'null'::jsonb);
  loop
    v_draft := jsonb_set(v_draft, '{number}',
      to_jsonb(public.next_document_number('invoice', v_issue)));
    begin
      return public.save_document(null, null, v_draft, 'converted',
        'Converted from ' || v_src.number, null);
    exception when sqlstate 'MXDUP' then
      v_attempts := v_attempts + 1;
      if v_attempts >= 5 then raise; end if;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_document_status: trash / restore. Bumps the version (so concurrent editors
-- hit the version-conflict path), snapshots and audits the change.
-- ---------------------------------------------------------------------------
create or replace function public.set_document_status(
  p_id uuid, p_status text, p_expected_version integer
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_src public.documents%rowtype;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  if p_status not in ('active', 'trashed') then
    raise exception 'VALIDATION' using errcode = 'MXVAL',
      detail = '["Unknown status."]';
  end if;
  select * into v_src from public.documents where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'MX404';
  end if;
  if v_src.version is distinct from p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = 'MXCON';
  end if;
  if v_src.status = p_status then
    return public.document_snapshot(p_id);
  end if;
  return public.save_document(
    p_id, p_expected_version, public.document_to_draft(p_id),
    case when p_status = 'trashed' then 'trashed' else 'restored' end,
    case when p_status = 'trashed' then 'Moved to trash' else 'Restored from trash' end,
    p_status
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- restore_document_version: applies a stored snapshot as a NEW version of the
-- same document (nothing is overwritten silently; history keeps growing).
-- ---------------------------------------------------------------------------
create or replace function public.restore_document_version(
  p_id uuid, p_version integer
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_src public.documents%rowtype;
  v_snap jsonb;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  select * into v_src from public.documents where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'MX404';
  end if;
  select snapshot into v_snap from public.document_versions
  where document_id = p_id and version = p_version;
  if v_snap is null then
    raise exception 'NOT_FOUND' using errcode = 'MX404';
  end if;
  return public.save_document(
    p_id, v_src.version, v_snap - 'id' - 'version' - 'status' - 'createdAt' - 'updatedAt' - 'createdBy',
    'version_restored',
    'Restored version ' || p_version || ' (from version ' || v_src.version || ')',
    null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- purge_document: PERMANENT delete. Administrator only, trashed documents only,
-- audited. Number allocations survive (numbers are never released); items and
-- version history are removed together with the document.
-- ---------------------------------------------------------------------------
create or replace function public.purge_document(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_src public.documents%rowtype;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'MX401';
  end if;
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  select * into v_src from public.documents where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'MX404';
  end if;
  if v_src.status <> 'trashed' then
    raise exception 'VALIDATION' using errcode = 'MXVAL',
      detail = '["Only documents in the trash can be permanently deleted."]';
  end if;
  delete from public.documents where id = p_id;
  insert into public.audit_entries
    (at, user_id, user_name, action, document_id, document_number, detail)
  values (
    now(), auth.uid(), public.current_full_name(), 'purged', null, v_src.number,
    'Permanently deleted from trash (last version ' || v_src.version || ')'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- save_customer: upsert (by id, else by name) + audit. Used by the directory
-- and by the AI companion through the same authorization path.
-- ---------------------------------------------------------------------------
create or replace function public.save_customer(
  p_id uuid, p_name text, p_phone text, p_email text, p_address text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'MX401';
  end if;
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  if v_name = '' then
    raise exception 'VALIDATION' using errcode = 'MXVAL',
      detail = '["Customer name is required."]';
  end if;
  if p_id is not null and exists (select 1 from public.customers where id = p_id) then
    v_id := p_id;
  else
    select id into v_id from public.customers
    where lower(name) = lower(v_name) order by created_at limit 1;
  end if;
  if v_id is null then
    insert into public.customers (name, phone, email, address, created_by)
    values (v_name, btrim(coalesce(p_phone, '')), btrim(coalesce(p_email, '')),
            btrim(coalesce(p_address, '')), auth.uid())
    returning id into v_id;
  else
    update public.customers
    set name = v_name,
        phone = btrim(coalesce(p_phone, '')),
        email = btrim(coalesce(p_email, '')),
        address = btrim(coalesce(p_address, ''))
    where id = v_id;
  end if;
  insert into public.audit_entries
    (at, user_id, user_name, action, document_id, document_number, detail)
  values (now(), auth.uid(), public.current_full_name(), 'customer_updated', null, '',
          'Customer ' || v_name);
  return (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'address', c.address,
      'createdAt', to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
    from public.customers c where c.id = v_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Company settings (admin write, active-user read).
-- ---------------------------------------------------------------------------
create or replace function public.get_company_settings() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_data jsonb;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  select data into v_data from public.company_settings where id = true;
  return coalesce(v_data, '{}'::jsonb);
end;
$$;

create or replace function public.save_company_settings(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'MX401';
  end if;
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object'
     or btrim(coalesce(p_data ->> 'nameLine1', '')) = '' then
    raise exception 'VALIDATION' using errcode = 'MXVAL',
      detail = '["Company name is required."]';
  end if;
  insert into public.company_settings (id, data, updated_at, updated_by)
  values (true, p_data, now(), auth.uid())
  on conflict (id) do update
    set data = excluded.data, updated_at = now(), updated_by = excluded.updated_by;
  insert into public.audit_entries
    (at, user_id, user_name, action, document_id, document_number, detail)
  values (now(), auth.uid(), public.current_full_name(), 'settings_updated', null, '',
          'Company and document settings updated');
  return p_data;
end;
$$;

-- ---------------------------------------------------------------------------
-- User administration: only admins (server-side recheck; RLS also enforces it).
-- The LAST-ADMIN trigger protects even admins from removing the final admin.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_profile(
  p_id uuid, p_role text, p_is_active boolean, p_full_name text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'MX401';
  end if;
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  if p_role not in ('admin', 'employee') then
    raise exception 'VALIDATION' using errcode = 'MXVAL',
      detail = '["Unknown role."]';
  end if;
  if v_name = '' then
    raise exception 'VALIDATION' using errcode = 'MXVAL',
      detail = '["Employee name is required."]';
  end if;
  update public.profiles
  set role = p_role, is_active = p_is_active, full_name = v_name
  where id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'MX404';
  end if;
  insert into public.audit_entries
    (at, user_id, user_name, action, document_id, document_number, detail)
  values (now(), auth.uid(), public.current_full_name(), 'user_changed', null, '',
          'Updated ' || v_name || ': role=' || p_role || ', active=' || p_is_active::text);
  return (
    select jsonb_build_object(
      'id', p.id, 'fullName', p.full_name, 'email', p.email, 'role', p.role,
      'isActive', p.is_active,
      'createdAt', to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', to_char(p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
    from public.profiles p where p.id = p_id
  );
end;
$$;

-- Any active employee may set their own display name (nothing else about users).
create or replace function public.update_my_profile(p_full_name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  if btrim(coalesce(p_full_name, '')) = '' then
    raise exception 'VALIDATION' using errcode = 'MXVAL',
      detail = '["Employee name is required."]';
  end if;
  update public.profiles set full_name = btrim(p_full_name) where id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: nothing for anon/public; execute for signed-in callers.
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'save_document', 'next_document_number', 'duplicate_document',
        'convert_to_invoice', 'set_document_status', 'restore_document_version',
        'purge_document', 'save_customer', 'get_company_settings',
        'save_company_settings', 'admin_set_profile', 'update_my_profile',
        'document_snapshot', 'document_to_draft'
      )
  loop
    execute format('revoke all on function %s from public, anon', fn.signature);
    execute format('grant execute on function %s to authenticated, service_role', fn.signature);
  end loop;
end;
$$;







