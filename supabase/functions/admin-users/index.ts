import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BOOTSTRAP_SECRET = Deno.env.get('ADMIN_BOOTSTRAP_SECRET') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return reply({ error: 'Server is missing Supabase credentials.' }, 500);
    let body: Record<string, unknown>;
    try { body = (await req.json()) as Record<string, unknown>; } catch { return reply({ error: 'Request body must be JSON.' }, 400); }
    const { operation, email, password, full_name, role, is_active, target_user_id, bootstrap_secret } = body;

    // Service-role client: only used AFTER the caller has been proven to be an active administrator.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    if (operation === 'bootstrap_admin') {
      if (!BOOTSTRAP_SECRET || bootstrap_secret !== BOOTSTRAP_SECRET) return reply({ error: 'Invalid bootstrap secret.' }, 403);
      if (!email || !password || !full_name) return reply({ error: 'email, password and full_name are required.' }, 400);
      const { data, error } = await admin.auth.admin.createUser({
        email: String(email),
        password: String(password),
        user_metadata: { full_name: String(full_name), role: 'admin' },
        email_confirm: true,
      });
      if (error) throw error;
      return reply({ ok: true, user: data.user });
    }

    // Every other operation: authenticated, active administrator.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return reply({ error: 'Not authenticated.' }, 401);
    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await caller.auth.getUser(token);
    if (authError || !user) return reply({ error: 'Not authenticated.' }, 401);
    const { data: me } = await caller.from('profiles').select('role, is_active').eq('id', user.id).maybeSingle();
    if (!me?.is_active || me.role !== 'admin') return reply({ error: 'Administrator only.' }, 403);

    if (operation === 'create_user') {
      const name = String(full_name ?? '').trim();
      const mail = String(email ?? '').trim().toLowerCase();
      const pass = String(password ?? '');
      const newRole = role === 'admin' ? 'admin' : 'employee';
      if (!name) return reply({ error: 'Full name is required.' }, 400);
      if (!EMAIL_RE.test(mail)) return reply({ error: 'Enter a valid email address.' }, 400);
      if (pass.length < 8) return reply({ error: 'The password must be at least 8 characters.' }, 400);

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: mail,
        password: pass,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (createError || !created?.user) {
        const msg = createError?.message ?? 'Could not create the account.';
        return reply({ error: /already|registered|exists/i.test(msg) ? 'An account with this email already exists.' : msg }, 400);
      }
      // The new profile starts inactive (handle_new_user). Activate it with the caller's admin rights.
      const { data: profile, error: profileError } = await caller.rpc('admin_set_profile', {
        p_id: created.user.id,
        p_role: newRole,
        p_is_active: true,
        p_full_name: name,
      });
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id); // never leave a half-created account behind
        throw profileError;
      }
      return reply({ ok: true, profile });
    }

    if (operation === 'delete_user') {
      const id = String(target_user_id ?? '');
      if (!id) return reply({ error: 'target_user_id is required.' }, 400);
      if (id === user.id) return reply({ error: 'You cannot remove your own account.' }, 400);
      const { data: target } = await admin.from('profiles').select('role, is_active').eq('id', id).maybeSingle();
      if (!target) return reply({ error: 'Employee not found.' }, 404);
      if (target.role === 'admin' && target.is_active) {
        const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true })
          .eq('role', 'admin').eq('is_active', true).neq('id', id);
        if (!count) return reply({ error: 'At least one active administrator must remain.' }, 400);
      }
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
      return reply({ ok: true });
    }

    if (operation === 'set_profile' && target_user_id) {
      const { data, error } = await caller.rpc('admin_set_profile', {
        p_id: target_user_id, p_role: role, p_is_active: is_active, p_full_name: full_name,
      });
      if (error) throw error;
      return reply({ ok: true, profile: data });
    }

    return reply({ error: 'Unknown operation.' }, 400);
  } catch (err) {
    console.error('admin-users failure', err);
    const e = err as { message?: string } | null;
    return reply({ error: e?.message || 'Unknown error.' }, 500);
  }
});
