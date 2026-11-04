-- ---------------------------------------------------------------------------
-- Maish Invoice & Quotation Manager
-- Migration 0005: harden permissions on the auth confirmation-token trigger.
--
-- The trigger function is SECURITY DEFINER and mutates auth.users, so it must
-- never be reachable through the PostgREST API. Trigger functions are invoked
-- by the trigger itself rather than by the caller, so no role needs EXECUTE.
--
-- The confirmation token is a credential, so no API role may read it.
-- auth.users is not readable by anon/authenticated to begin with, but the
-- explicit column-level revoke documents the intent and keeps holding even if
-- a table-level grant is added later. The GoTrue owner (supabase_auth_admin)
-- keeps its own table-level privileges.
-- ---------------------------------------------------------------------------

revoke all on function public.handle_auth_user_confirmation_token()
  from public, anon, authenticated, service_role;

revoke select (confirmation_token) on auth.users
  from public, anon, authenticated, service_role;
