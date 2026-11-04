-- ---------------------------------------------------------------------------
-- GoTrue scans the auth.users token columns into non-nullable Go strings.
-- A NULL in any of them makes the sign-in query fail with
-- "Database error querying schema" (HTTP 500), which locks the account out.
--
-- Migration 20261019000004 only guarded confirmation_token. This migration
-- widens the same treatment to every other auth token column, so an account
-- created without an email confirmation can always sign in.
--
-- The trigger is SECURITY DEFINER and mutates auth.users, so it must never be
-- reachable through the PostgREST API. The companion migration
-- 20261019000005 revokes EXECUTE on it from every API role.
-- ---------------------------------------------------------------------------

update auth.users
set email_change = '' where email_change is null;
update auth.users
set email_change_token_current = '' where email_change_token_current is null;
update auth.users
set email_change_token_new = '' where email_change_token_new is null;
update auth.users
set phone_change = '' where phone_change is null;
update auth.users
set phone_change_token = '' where phone_change_token is null;
update auth.users
set reauthentication_token = '' where reauthentication_token is null;
update auth.users
set recovery_token = '' where recovery_token is null;

create or replace function public.handle_auth_user_confirmation_token()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.confirmation_token is null then
    new.confirmation_token := '';
  end if;
  if new.email_change is null then
    new.email_change := '';
  end if;
  if new.email_change_token_current is null then
    new.email_change_token_current := '';
  end if;
  if new.email_change_token_new is null then
    new.email_change_token_new := '';
  end if;
  if new.phone_change is null then
    new.phone_change := '';
  end if;
  if new.phone_change_token is null then
    new.phone_change_token := '';
  end if;
  if new.reauthentication_token is null then
    new.reauthentication_token := '';
  end if;
  if new.recovery_token is null then
    new.recovery_token := '';
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_confirmation_token on auth.users;
create trigger on_auth_user_confirmation_token
before insert or update on auth.users
for each row execute function public.handle_auth_user_confirmation_token();
-- CREATE OR REPLACE keeps the existing function ACL, so the revoke from
-- migration 20261019000005 still holds. Repeat it here so this migration is
-- safe to apply on its own and the intent sits next to the definition.
-- The trigger fires regardless of this privilege: trigger functions are
-- invoked by the trigger, not by the role that writes the row.
revoke all on function public.handle_auth_user_confirmation_token()
  from public, anon, authenticated, service_role;