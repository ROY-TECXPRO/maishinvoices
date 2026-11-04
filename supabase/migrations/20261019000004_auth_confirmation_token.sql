-- ---------------------------------------------------------------------------
-- auth.users.confirmation_token must never be NULL.
--
-- GoTrue scans the token columns of auth.users into non-nullable Go strings
-- and Go time values, so a NULL value makes the sign-in query fail with
-- "Database error querying schema". Accounts created without an email
-- confirmation (admin createUser, or signup with email confirmation
-- disabled) can end up with NULL tokens and can then never sign in.
--
-- This migration keeps auth.users.confirmation_token non-null. A companion
-- migration widens the same treatment to the other auth token columns
-- (email_change, email_change_token_current, email_change_token_new,
-- phone_change, phone_change_token, reauthentication_token, recovery_token),
-- because a NULL in any of them breaks sign-in in exactly the same way.
--
-- Fix: backfill the existing rows and keep new rows non-null with a trigger.
-- ---------------------------------------------------------------------------

update auth.users set confirmation_token = '' where confirmation_token is null;

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
  return new;
end;
$$;

drop trigger if exists on_auth_user_confirmation_token on auth.users;
create trigger on_auth_user_confirmation_token
before insert or update of confirmation_token on auth.users
for each row execute function public.handle_auth_user_confirmation_token();
