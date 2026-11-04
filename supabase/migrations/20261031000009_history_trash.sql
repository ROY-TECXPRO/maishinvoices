-- Maish Invoice & Quotation Manager
-- Migration 0009: "Delete all history" moves history to the Trash (restorable); only administrators
-- can delete it permanently. Trashed history is hidden from every client query by RLS.

alter table public.audit_entries add column if not exists deleted_at timestamptz;
alter table public.document_versions add column if not exists deleted_at timestamptz;
create index if not exists audit_entries_deleted_idx on public.audit_entries (deleted_at);
create index if not exists document_versions_deleted_idx on public.document_versions (deleted_at);

drop policy if exists audit_select_active on public.audit_entries;
create policy audit_select_active on public.audit_entries
  for select to authenticated using (public.is_active_user() and deleted_at is null);

drop policy if exists document_versions_select_active on public.document_versions;
create policy document_versions_select_active on public.document_versions
  for select to authenticated using (public.is_active_user() and deleted_at is null);

-- Moves ALL audit entries and version snapshots to the trash as one batch. Administrator only.
create or replace function public.clear_history() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_now timestamptz := date_trunc('milliseconds', clock_timestamp());
  v_audit integer;
  v_versions integer;
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  update public.audit_entries set deleted_at = v_now where deleted_at is null;
  get diagnostics v_audit = row_count;
  update public.document_versions set deleted_at = v_now where deleted_at is null;
  get diagnostics v_versions = row_count;
  insert into public.audit_entries (at, user_id, user_name, action, document_id, document_number, detail)
  values (now(), auth.uid(), public.current_full_name(), 'history_cleared', null, '',
          'History moved to the trash (' || v_audit || ' audit entries, ' || v_versions || ' versions)');
  return v_audit;
end;
$$;

-- One row per trashed batch, newest first.
create or replace function public.list_trashed_history() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'deletedAt', to_char(b.deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'auditCount', b.audit_count,
      'versionCount', b.version_count) order by b.deleted_at desc)
    from (
      select d as deleted_at,
             (select count(*) from public.audit_entries a where a.deleted_at = d) as audit_count,
             (select count(*) from public.document_versions v where v.deleted_at = d) as version_count
      from (
        select deleted_at as d from public.audit_entries where deleted_at is not null
        union
        select deleted_at from public.document_versions where deleted_at is not null
      ) x
    ) b), '[]'::jsonb);
end;
$$;

create or replace function public.restore_history(p_deleted_at timestamptz) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_audit integer;
begin
  if not public.is_active_user() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  update public.audit_entries set deleted_at = null where deleted_at = p_deleted_at;
  get diagnostics v_audit = row_count;
  update public.document_versions set deleted_at = null where deleted_at = p_deleted_at;
  insert into public.audit_entries (at, user_id, user_name, action, document_id, document_number, detail)
  values (now(), auth.uid(), public.current_full_name(), 'history_restored', null, '',
          'History restored from the trash (' || v_audit || ' audit entries)');
  return v_audit;
end;
$$;

-- Permanent deletion of one trashed batch. Administrator only; the deletion itself is audited.
create or replace function public.purge_history(p_deleted_at timestamptz) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_audit integer;
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  delete from public.audit_entries where deleted_at = p_deleted_at;
  get diagnostics v_audit = row_count;
  delete from public.document_versions where deleted_at = p_deleted_at;
  insert into public.audit_entries (at, user_id, user_name, action, document_id, document_number, detail)
  values (now(), auth.uid(), public.current_full_name(), 'history_purged', null, '',
          v_audit || ' trashed audit entries permanently deleted');
  return v_audit;
end;
$$;

-- Permanent deletion of a trashed customer. Administrator only. Documents keep their own printed snapshot.
create or replace function public.purge_customer(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'MX403';
  end if;
  delete from public.customers where id = p_id and deleted_at is not null returning name into v_name;
  if v_name is null then
    raise exception 'NOT_FOUND' using errcode = 'MX404';
  end if;
  insert into public.audit_entries (at, user_id, user_name, action, document_id, document_number, detail)
  values (now(), auth.uid(), public.current_full_name(), 'customer_purged', null, '',
          'Customer ' || v_name || ' permanently deleted');
end;
$$;

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('clear_history', 'list_trashed_history', 'restore_history', 'purge_history', 'purge_customer')
  loop
    execute format('revoke all on function %s from public, anon', fn.signature);
    execute format('grant execute on function %s to authenticated, service_role', fn.signature);
  end loop;
end;
$$;
