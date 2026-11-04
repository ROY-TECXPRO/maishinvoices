import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Single place where the Supabase client is created.
 * Only the PUBLIC/publishable key is ever read here - never a service-role key.
 * RLS on the database is what protects the data.
 */
export interface SupabaseConfig {
  url: string;
  key: string;
}

export function readSupabaseConfig(): SupabaseConfig | null {
  const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const key = (
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    import.meta.env.VITE_SUPABASE_ANON_KEY ??
    ''
  )
    .trim();
  if (!url || !key) return null;
  if (!/^https:\/\//.test(url)) return null;
  return { url, key };
}

export const hasSupabaseConfig = (): boolean => readSupabaseConfig() !== null;

/** Explicit opt-in for the browser-only mock repository (development/tests only). */
export const isMockModeRequested = (): boolean => import.meta.env.VITE_DATA_MODE === 'mock';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const cfg = readSupabaseConfig();
  if (!cfg) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY ' +
        '(or VITE_SUPABASE_ANON_KEY) in .env.local.',
    );
  }
  client = createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return client;
}

/** Test hook: allows injecting a configured client. */
export function setSupabaseClientForTests(next: SupabaseClient | null): void {
  client = next;
}
