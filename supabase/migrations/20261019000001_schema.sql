-- Maish Invoice & Quotation Manager
-- Migration 0001: core schema (profiles, customers, documents, items, numbering, versions, audit, settings)
-- Applied to Supabase project bixuqaihfofrniuvwpfn. Idempotent where practical.

-- UUID generation (gen_random_uuid is core in Postgres 13+; pgcrypto kept for older forks)
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles: one row per employee account, linked to auth.users.
-- New accounts start INACTIVE; an administrator must activate them.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  role text not null default 'employee' check (role in ('admin', 'employee')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- customers: shared company customer directory (reused across documents)
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customers_name_lower_idx on public.customers (lower(name));

-- ---------------------------------------------------------------------------
-- documents: quotations and invoices. Money values are integer cents (bigint).
-- The customer_* columns are a snapshot of the customer details on THIS document
-- (kept distinct from the shared customers record).
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('quotation', 'invoice')),
  number text not null unique,
  issue_date date not null,
  order_number text not null default '',
  customer_id uuid references public.customers (id) on delete set null,
  customer_name text not null check (btrim(customer_name) <> ''),
  customer_phone text not null default '',
  customer_email text not null default '',
  customer_address text not null default '',
  discount jsonb,
  tax jsonb,
  payment_terms text not null default '',
  notes text not null default '',
  version integer not null default 1 check (version >= 1),
  status text not null default 'active' check (status in ('active', 'trashed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint quotations_have_no_adjustments check (
    type <> 'quotation' or (discount is null and tax is null)
  )
);
create index if not exists documents_issue_date_idx on public.documents (issue_date desc);
create index if not exists documents_status_idx on public.documents (status);
create index if not exists documents_type_idx on public.documents (type);

-- ---------------------------------------------------------------------------
-- document_items: ordered rows; headings (FLEECE, HEAD CHEF, ...) carry no
-- quantity/price. quantity supports exactly 3 decimals; prices are integer cents.
-- ---------------------------------------------------------------------------
create table if not exists public.document_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  position integer not null check (position >= 0),
  kind text not null check (kind in ('item', 'heading')),
  description text not null check (btrim(description) <> ''),
  quantity numeric(12, 3) check (quantity is null or quantity > 0),
  unit_price_cents bigint check (unit_price_cents is null or unit_price_cents >= 0),
  unique (document_id, position),
  constraint item_rows_have_amounts check (
    (kind = 'item' and quantity is not null and unit_price_cents is not null)
    or (kind = 'heading' and quantity is null and unit_price_cents is null)
  )
);
create index if not exists document_items_document_idx on public.document_items (document_id, position);

create index if not exists documents_customer_idx on public.documents (customer_id);
create index if not exists documents_updated_at_idx on public.documents (updated_at desc);

-- ---------------------------------------------------------------------------
-- document_number_sequences: independent per-type counters.
-- Seed value 3999: QT-2026-3999 / INV-2026-3999 are the first numbers.
-- The counter NEVER resets across years; the year in the number follows the issue date.
-- ---------------------------------------------------------------------------
create table if not exists public.document_number_sequences (
  type text primary key check (type in ('quotation', 'invoice')),
  next_sequence integer not null check (next_sequence >= 3999)
);
insert into public.document_number_sequences (type, next_sequence)
values ('quotation', 3999), ('invoice', 3999)
on conflict (type) do nothing;

-- ---------------------------------------------------------------------------
-- document_number_allocations: every number ever issued is reserved forever.
-- Rows are never deleted (document_id becomes null only if a document is purged),
-- so a retired number can never be handed to a different document.
-- ---------------------------------------------------------------------------
create table if not exists public.document_number_allocations (
  number text primary key,
  document_id uuid references public.documents (id) on delete set null,
  allocated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- document_versions: immutable snapshot of the full record on every save.
-- ---------------------------------------------------------------------------
create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  version integer not null check (version >= 1),
  snapshot jsonb not null,
  saved_at timestamptz not null default now(),
  saved_by uuid references auth.users (id) on delete set null,
  unique (document_id, version)
);
create index if not exists document_versions_document_idx on public.document_versions (document_id, version desc);

-- ---------------------------------------------------------------------------
-- audit_entries: written only by security-definer functions (no client writes).
-- document_id becomes null when a document is purged; the number/detail remain.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_entries (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  user_name text not null default '',
  action text not null,
  document_id uuid references public.documents (id) on delete set null,
  document_number text not null default '',
  detail text not null default ''
);
create index if not exists audit_entries_at_idx on public.audit_entries (at desc);
create index if not exists audit_entries_document_idx on public.audit_entries (document_id, at desc);

-- ---------------------------------------------------------------------------
-- company_settings: single row of company/document defaults (JSONB profile).
-- ---------------------------------------------------------------------------
create table if not exists public.company_settings (
  id boolean primary key default true check (id),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists customers_updated_at on public.customers;
create trigger customers_updated_at before update on public.customers
for each row execute function public.set_updated_at();

-- Every new auth user automatically gets an INACTIVE employee profile.
-- Inactive accounts cannot read or write any business data (RLS denies everything).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, full_name, email, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.email, ''),
    'employee',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- At least one active administrator must always remain.
create or replace function public.protect_last_admin() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'admin' and old.is_active and not exists (
      select 1 from public.profiles p where p.id <> old.id and p.role = 'admin' and p.is_active
    ) then
      raise exception 'At least one active administrator must remain.';
    end if;
    return old;
  end if;
  if old.role = 'admin' and old.is_active
     and (new.role is distinct from 'admin' or new.is_active = false)
     and not exists (
       select 1 from public.profiles p where p.id <> old.id and p.role = 'admin' and p.is_active
     ) then
    raise exception 'At least one active administrator must remain.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_last_admin on public.profiles;
create trigger protect_last_admin before update or delete on public.profiles
for each row execute function public.protect_last_admin();


