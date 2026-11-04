-- ---------------------------------------------------------------------------
-- Maish Invoice & Quotation Manager
-- Migration 20261019151435: promote the first administrator.
--
-- One-off data migration, already applied to the live project on 2026-10-19.
-- It activates a single employee as the first administrator so the Users
-- screen is usable before any other account exists.
--
-- The migration is a safe no-op when there is nothing to promote, so it never
-- blocks a fresh project from applying the rest of the migration chain:
--   * no matching auth user  -> nothing to promote, skip
--   * an admin already exists -> the Users screen is already usable, skip
--
-- It can therefore never grant a second administrator, and re-running it is
-- harmless.
-- ---------------------------------------------------------------------------

do $$
declare
  v_uid uuid := (select id from auth.users where email = 'roysanga127@gmail.com' limit 1);
  v_admin uuid := (select id from public.profiles where role = 'admin' and is_active order by created_at limit 1);
begin
  if v_uid is null then
    raise notice 'No auth user found for that email; skipping first-administrator promotion.';
    return;
  end if;
  if v_admin is not null then
    raise notice 'An active administrator already exists; skipping first-administrator promotion.';
    return;
  end if;
  update public.profiles
  set role = 'admin', is_active = true
  where id = v_uid;
  insert into public.audit_entries (user_id, user_name, action, detail)
  values (v_uid, 'System bootstrap', 'user_changed', 'First administrator activated via bootstrap');
end;
$$;