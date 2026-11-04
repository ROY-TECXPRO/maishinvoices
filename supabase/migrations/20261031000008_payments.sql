-- Maish Invoice & Quotation Manager
-- Migration 0008: payments against invoices (unpaid / part paid / paid, money still owed).
-- Idempotent where practical; no destructive statements.

-- ---------------------------------------------------------------------------
-- 0. Fix: validation errors crashed with "malformed array literal".
--    `text[] || 'literal'` treats the literal as an array, so any failed validation inside
--    save_document raised a confusing error instead of the real message (and blocked saves,
--    trashing and restoring of documents that fail validation). Rewrites those statements to
--    array_append() in every public function that uses the pattern. Safe to re-run.
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
  v_def text;
begin
  for fn in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%v_errors := v_errors || ''%'
  loop
    v_def := pg_get_functiondef(fn.oid);
    v_def := regexp_replace(v_def, 'v_errors := v_errors \|\| (''(?:[^'']|'''')*'');', 'v_errors := array_append(v_errors, \1);', 'g');
    execute v_def;
  end loop;
end;
$$;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null,
  method text not null default 'cash' check (method in ('cash', 'mpesa', 'bank', 'cheque', 'other')),
  note text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists payments_document_idx on public.payments (document_id);

alter table public.payments enable row level security;
drop policy if exists payments_select_active on public.payments;
create policy payments_select_active on public.payments
  for select to authenticated using (public.is_active_user());
revoke all on public.payments from public, anon;
revoke insert, update, delete on public.payments from authenticated;
grant select on public.payments to authenticated;
grant all on public.payments to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payments') then
    alter publication supabase_realtime add table public.payments;
  end if;
end;
$$;

-- Grand total of a document in cents. Same order and rounding as src/domain/calc.ts:
-- subtotal -> discount -> tax on the discounted amount.
create or replace function public.document_total_cents(p_id uuid) returns bigint
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_doc public.documents%rowtype;
  v_sub bigint;
  v_disc bigint := 0;
  v_raw bigint;
  v_taxable bigint;
  v_tax bigint := 0;
begin
  select * into v_doc from public.documents where id = p_id;
  if not found then
    return null;
  end if;
  select coalesce(sum(floor((round(quantity * 1000) * unit_price_cents + 500) / 1000)), 0)::bigint
    into v_sub
  from public.document_items where document_id = p_id and kind = 'item';
  if v_doc.discount is not null and jsonb_typeof(v_doc.discount) = 'object' then
    if v_doc.discount ->> 'mode' = 'percent' then
      v_raw := floor((v_sub * (v_doc.discount ->> 'basisPoints')::bigint + 5000) / 10000.0)::bigint;
    else
      v_raw := coalesce((v_doc.discount ->> 'cents')::bigint, 0);
    end if;
    v_disc := least(greatest(v_raw, 0), v_sub);
  end if;
  v_taxable := v_sub - v_disc;
  if v_doc.tax is not null and jsonb_typeof(v_doc.tax) = 'object' then
    v_tax := floor((v_taxable * (v_doc.tax ->> 'basisPoints')::bigint + 5000) / 10000.0)::bigint;
  end if;
  return v_taxable + v_tax;
end;
$$;

create or replace function public.record_payment(
  p_document_id uuid, p_amount_cents bigint, p_paid_on date, p_method text, p_note text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_doc public.documents%rowtype;
  v_total bigint;
  v_paid bigint;
  v_row public.payments%rowtype;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  select * into v_doc from public.documents where id = p_document_id for update;
  if not found or v_doc.status <> 'active' then
    raise exception 'NOT_FOUND' using errcode = 'MX404';
  end if;
  if v_doc.type <> 'invoice' then
    raise exception 'VALIDATION' using errcode = 'MXVAL', detail = '["Payments can only be recorded against invoices."]';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'VALIDATION' using errcode = 'MXVAL', detail = '["Enter an amount greater than zero."]';
  end if;
  if p_paid_on is null then
    raise exception 'VALIDATION' using errcode = 'MXVAL', detail = '["Enter the payment date."]';
  end if;
  if coalesce(p_method, 'cash') not in ('cash', 'mpesa', 'bank', 'cheque', 'other') then
    raise exception 'VALIDATION' using errcode = 'MXVAL', detail = '["Unknown payment method."]';
  end if;
  v_total := public.document_total_cents(p_document_id);
  select coalesce(sum(amount_cents), 0) into v_paid from public.payments where document_id = p_document_id;
  if v_paid + p_amount_cents > v_total then
    raise exception 'VALIDATION' using errcode = 'MXVAL',
      detail = '["The payment is more than the balance still owed on this invoice."]';
  end if;
  insert into public.payments (document_id, amount_cents, paid_on, method, note, created_by)
  values (p_document_id, p_amount_cents, p_paid_on, coalesce(p_method, 'cash'), btrim(coalesce(p_note, '')), auth.uid())
  returning * into v_row;
  insert into public.audit_entries (at, user_id, user_name, action, document_id, document_number, detail)
  values (now(), auth.uid(), public.current_full_name(), 'payment_recorded', v_doc.id, v_doc.number,
          'Payment recorded on ' || v_doc.number);
  return jsonb_build_object(
    'id', v_row.id, 'documentId', v_row.document_id, 'amountCents', v_row.amount_cents,
    'paidOn', to_char(v_row.paid_on, 'YYYY-MM-DD'), 'method', v_row.method, 'note', v_row.note,
    'createdAt', to_char(v_row.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;

create or replace function public.delete_payment(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_doc_id uuid;
  v_number text;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  delete from public.payments where id = p_id returning document_id into v_doc_id;
  if v_doc_id is null then
    raise exception 'NOT_FOUND' using errcode = 'MX404';
  end if;
  select number into v_number from public.documents where id = v_doc_id;
  insert into public.audit_entries (at, user_id, user_name, action, document_id, document_number, detail)
  values (now(), auth.uid(), public.current_full_name(), 'payment_deleted', v_doc_id, coalesce(v_number, ''),
          'Payment removed from ' || coalesce(v_number, ''));
end;
$$;

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('document_total_cents', 'record_payment', 'delete_payment')
  loop
    execute format('revoke all on function %s from public, anon', fn.signature);
    execute format('grant execute on function %s to authenticated, service_role', fn.signature);
  end loop;
end;
$$;
