-- Maish Invoice & Quotation Manager
-- Migration 0007: customer trash (soft delete), server-side dashboard passcode,
-- order number follows the document number on duplicate/convert.
-- Idempotent where practical; no destructive statements.

-- ---------------------------------------------------------------------------
-- 1. Customers: soft delete (trash + restore)
-- ---------------------------------------------------------------------------
alter table public.customers add column if not exists deleted_at timestamptz;
create index if not exists customers_deleted_idx on public.customers (deleted_at);

-- Saving a document (or the customer form) for a trashed customer brings it back:
-- a plain trash/restore only touches deleted_at, so this column-scoped trigger
-- fires only when contact details are written.
create or replace function public.customers_revive_on_save() returns trigger
language plpgsql as $$
begin
  if new.deleted_at is not distinct from old.deleted_at then
    new.deleted_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists customers_revive_on_save on public.customers;
create trigger customers_revive_on_save before update of name, phone, email, address
on public.customers for each row execute function public.customers_revive_on_save();

create or replace function public.delete_customer(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  update public.customers set deleted_at = now()
  where id = p_id and deleted_at is null returning name into v_name;
  if v_name is null then
    raise exception 'NOT_FOUND' using errcode = 'MX404';
  end if;
  insert into public.audit_entries (at, user_id, user_name, action, document_id, document_number, detail)
  values (now(), auth.uid(), public.current_full_name(), 'customer_trashed', null, '', 'Customer ' || v_name || ' moved to trash');
end;
$$;

create or replace function public.restore_customer(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.customers%rowtype;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  update public.customers set deleted_at = null
  where id = p_id and deleted_at is not null returning * into v_row;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'MX404';
  end if;
  insert into public.audit_entries (at, user_id, user_name, action, document_id, document_number, detail)
  values (now(), auth.uid(), public.current_full_name(), 'customer_restored', null, '', 'Customer ' || v_row.name || ' restored');
  return jsonb_build_object(
    'id', v_row.id, 'name', v_row.name, 'phone', v_row.phone, 'email', v_row.email, 'address', v_row.address,
    'createdAt', to_char(v_row.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(v_row.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;

-- save_customer: ignore trashed customers when matching by name (a save revives the matched row).
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
    where lower(name) = lower(v_name) and deleted_at is null order by created_at limit 1;
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
  insert into public.audit_entries (at, user_id, user_name, action, document_id, document_number, detail)
  values (now(), auth.uid(), public.current_full_name(), 'customer_updated', null, '', 'Customer ' || v_name);
  return (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'address', c.address,
      'createdAt', to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    from public.customers c where c.id = v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Dashboard figures passcode: verified on the server, stored salted+hashed.
--    Never readable by any API role (RLS on, all privileges revoked).
-- ---------------------------------------------------------------------------
create table if not exists public.app_secrets (
  key text primary key,
  salt text not null,
  hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from public, anon, authenticated;

create table if not exists public.passcode_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  at timestamptz not null default now(),
  ok boolean not null
);
alter table public.passcode_attempts enable row level security;
revoke all on public.passcode_attempts from public, anon, authenticated;
create index if not exists passcode_attempts_user_idx on public.passcode_attempts (user_id, at desc);

insert into public.app_secrets (key, salt, hash)
values ('figures_passcode', 'f3a91c2e7b64d805', '861c07955297dd12a6769a0354da093f6f3bd51b71ba9a04bc933bd481806a6b')
on conflict (key) do nothing;

create or replace function public.verify_figures_passcode(p_code text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_row public.app_secrets%rowtype;
  v_fail integer;
  v_ok boolean;
begin
  if v_uid is null or not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  select count(*) into v_fail from public.passcode_attempts
  where user_id = v_uid and not ok and at > now() - interval '10 minutes';
  if v_fail >= 5 then
    raise exception 'TOO_MANY_ATTEMPTS' using errcode = 'MXLIM';
  end if;
  select * into v_row from public.app_secrets where key = 'figures_passcode';
  v_ok := found and encode(sha256(convert_to(v_row.salt || coalesce(p_code, ''), 'UTF8')), 'hex') = v_row.hash;
  insert into public.passcode_attempts (user_id, ok) values (v_uid, v_ok);
  return v_ok;
end;
$$;

create or replace function public.set_figures_passcode(p_code text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_salt text := md5(random()::text || clock_timestamp()::text);
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  if length(coalesce(p_code, '')) < 6 or length(p_code) > 64 then
    raise exception 'VALIDATION' using errcode = 'MXVAL',
      detail = '["The passcode must be 6 to 64 characters."]';
  end if;
  insert into public.app_secrets (key, salt, hash)
  values ('figures_passcode', v_salt, encode(sha256(convert_to(v_salt || p_code, 'UTF8')), 'hex'))
  on conflict (key) do update set salt = excluded.salt, hash = excluded.hash, updated_at = now();
  insert into public.audit_entries (at, user_id, user_name, action, document_id, document_number, detail)
  values (now(), auth.uid(), public.current_full_name(), 'passcode_changed', null, '', 'Dashboard passcode changed');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Order number follows the document number on duplicate and convert.
-- ---------------------------------------------------------------------------
create or replace function public.duplicate_document(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_src public.documents%rowtype;
  v_draft jsonb;
  v_number text;
  v_attempts integer := 0;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  select * into v_src from public.documents where id = p_id for update;
  if not found or v_src.status <> 'active' then
    raise exception 'NOT_FOUND' using errcode = 'MX404';
  end if;
  v_draft := public.document_to_draft(p_id);
  loop
    v_number := public.next_document_number(v_src.type, v_src.issue_date);
    v_draft := jsonb_set(v_draft, '{number}', to_jsonb(v_number));
    v_draft := jsonb_set(v_draft, '{orderNumber}', to_jsonb(v_number));
    begin
      return public.save_document(null, null, v_draft, 'duplicated', 'Duplicated from ' || v_src.number, null);
    exception when sqlstate 'MXDUP' then
      v_attempts := v_attempts + 1;
      if v_attempts >= 5 then raise; end if;
    end;
  end loop;
end;
$$;

create or replace function public.convert_to_invoice(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_src public.documents%rowtype;
  v_draft jsonb;
  v_number text;
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
    v_number := public.next_document_number('invoice', v_issue);
    v_draft := jsonb_set(v_draft, '{number}', to_jsonb(v_number));
    v_draft := jsonb_set(v_draft, '{orderNumber}', to_jsonb(v_number));
    begin
      return public.save_document(null, null, v_draft, 'converted', 'Converted from ' || v_src.number, null);
    exception when sqlstate 'MXDUP' then
      v_attempts := v_attempts + 1;
      if v_attempts >= 5 then raise; end if;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Privileges for the new functions (same pattern as migration 0003).
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'delete_customer', 'restore_customer', 'save_customer', 'verify_figures_passcode',
      'set_figures_passcode', 'duplicate_document', 'convert_to_invoice')
  loop
    execute format('revoke all on function %s from public, anon', fn.signature);
    execute format('grant execute on function %s to authenticated, service_role', fn.signature);
  end loop;
end;
$$;
