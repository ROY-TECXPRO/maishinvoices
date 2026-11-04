-- Maish Invoice & Quotation Manager
-- Migration 0002: authorization helpers, Row Level Security, privilege grants, realtime.
-- Rules: authenticated + ACTIVE employees share all company records.
-- Inactive or anonymous sessions see and change nothing.

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER owned by postgres => no RLS recursion on
-- profiles, because table owners bypass RLS inside their own functions).
-- ---------------------------------------------------------------------------
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select p.is_active from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select p.is_active and p.role = 'admin' from public.profiles p where p.id = auth.uid()
  ), false);
$$;

create or replace function public.current_full_name() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select nullif(btrim(p.full_name), '') from public.profiles p where p.id = auth.uid()
  ), 'Unknown user');
$$;

revoke all on function public.is_active_user() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.current_full_name() from public, anon;
grant execute on function public.is_active_user() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.current_full_name() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS on every exposed table
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.documents enable row level security;
alter table public.document_items enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_number_sequences enable row level security;
alter table public.document_number_allocations enable row level security;
alter table public.audit_entries enable row level security;
alter table public.company_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Profiles: active users can READ the staff list (needed for "changed by whom").
-- Only administrators can change roles/active flags (and the LAST-ADMIN trigger
-- guards even administrators). No client-side insert/delete: profiles are created
-- by the auth trigger; removal happens server-side.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_active on public.profiles;
create policy profiles_select_active on public.profiles
  for select to authenticated using (public.is_active_user());

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Customers: shared by all active employees; hard delete is admin-only.
-- ---------------------------------------------------------------------------
drop policy if exists customers_select_active on public.customers;
create policy customers_select_active on public.customers
  for select to authenticated using (public.is_active_user());

drop policy if exists customers_insert_active on public.customers;
create policy customers_insert_active on public.customers
  for insert to authenticated with check (public.is_active_user());

drop policy if exists customers_update_active on public.customers;
create policy customers_update_active on public.customers
  for update to authenticated using (public.is_active_user()) with check (public.is_active_user());

drop policy if exists customers_delete_admin on public.customers;
create policy customers_delete_admin on public.customers
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Documents: every active employee can read/create/update ALL company documents.
-- NO delete policy: permanent deletion happens only inside purge_document(),
-- which requires administrator rights and writes an audit entry first.
-- ---------------------------------------------------------------------------
drop policy if exists documents_select_active on public.documents;
create policy documents_select_active on public.documents
  for select to authenticated using (public.is_active_user());

drop policy if exists documents_insert_active on public.documents;
create policy documents_insert_active on public.documents
  for insert to authenticated with check (public.is_active_user());

drop policy if exists documents_update_active on public.documents;
create policy documents_update_active on public.documents
  for update to authenticated using (public.is_active_user()) with check (public.is_active_user());

-- ---------------------------------------------------------------------------
-- Document items: read for active users; writes go through save_document().
-- ---------------------------------------------------------------------------
drop policy if exists document_items_select_active on public.document_items;
create policy document_items_select_active on public.document_items
  for select to authenticated using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- Versions + audit: read-only for active users; rows are written only by
-- security-definer functions (no INSERT/UPDATE/DELETE grants at all).
-- ---------------------------------------------------------------------------
drop policy if exists document_versions_select_active on public.document_versions;
create policy document_versions_select_active on public.document_versions
  for select to authenticated using (public.is_active_user());

drop policy if exists audit_select_active on public.audit_entries;
create policy audit_select_active on public.audit_entries
  for select to authenticated using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- Numbering tables: read-only suggestions for active users; writes only in
-- save_document() (which holds row locks while reserving numbers).
-- ---------------------------------------------------------------------------
drop policy if exists sequences_select_active on public.document_number_sequences;
create policy sequences_select_active on public.document_number_sequences
  for select to authenticated using (public.is_active_user());

drop policy if exists allocations_select_active on public.document_number_allocations;
create policy allocations_select_active on public.document_number_allocations
  for select to authenticated using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- Company settings: read for active users, update for administrators.
-- ---------------------------------------------------------------------------
drop policy if exists settings_select_active on public.company_settings;
create policy settings_select_active on public.company_settings
  for select to authenticated using (public.is_active_user());

drop policy if exists settings_admin_update on public.company_settings;
create policy settings_admin_update on public.company_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Privilege grants: least privilege. The anon role gets NOTHING.
-- Audit/version/numbering tables are never writable by clients directly.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;

-- Active document flow: select/insert/update through RLS; no direct delete ever.
revoke all on public.documents from authenticated;
revoke all on public.document_items from authenticated;
grant select, insert, update on public.documents to authenticated;
grant select, insert, update on public.document_items to authenticated;

revoke all on public.document_versions from authenticated;
revoke all on public.audit_entries from authenticated;
revoke all on public.document_number_sequences from authenticated;
revoke all on public.document_number_allocations from authenticated;
grant select on public.document_versions to authenticated;
grant select on public.audit_entries to authenticated;
grant select on public.document_number_sequences to authenticated;
grant select on public.document_number_allocations to authenticated;

revoke all on public.customers from authenticated;
grant select, insert, update on public.customers to authenticated;

revoke all on public.profiles from authenticated;
grant select, update on public.profiles to authenticated;

revoke all on public.company_settings from authenticated;
grant select, update on public.company_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: changes made by one authorized computer are pushed to the others.
-- Events respect RLS; the client only refetches authoritative rows after an event.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'documents'
  ) then
    alter publication supabase_realtime add table public.documents;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'customers'
  ) then
    alter publication supabase_realtime add table public.customers;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'company_settings'
  ) then
    alter publication supabase_realtime add table public.company_settings;
  end if;
exception
  when undefined_object or duplicate_object then
    -- Publication missing (local/self-hosted): realtime simply stays off.
    null;
end;
$$;


