import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Profile } from '../domain/types';
import { getSupabase, hasSupabaseConfig, isMockModeRequested } from '../data/supabase/client';
import { mapProfile } from '../data/supabase/mappers';
import type { ProfileRow } from '../data/supabase/dbTypes';

export type AuthStatus = 'loading' | 'signed_out' | 'inactive' | 'ready';
export type DataMode = 'supabase' | 'mock' | 'unconfigured';

export interface AuthValue {
  mode: DataMode;
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  isAdmin: boolean;
  /** Human-readable reason shown on the inactive screen. */
  inactiveMessage: string;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  refreshProfile(): Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

/** Resolves which data path the app uses. Never silently falls back to mock. */
export function resolveDataMode(): DataMode {
  if (hasSupabaseConfig()) return 'supabase';
  const explicitMock = isMockModeRequested();
  const devOrTest = import.meta.env.DEV || import.meta.env.MODE === 'test';
  return explicitMock && devOrTest ? 'mock' : 'unconfigured';
}

export const MOCK_AUTH_PROFILE: Profile = {
  id: 'local-dev-user',
  fullName: 'Local dev user',
  email: 'dev@localhost',
  role: 'admin',
  isActive: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

export function AuthProvider({ mode, children }: { mode: DataMode; children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<AuthStatus>(mode === 'mock' ? 'ready' : 'loading');
  const [inactiveMessage, setInactiveMessage] = useState('');
  const alive = useRef(true);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await getSupabase()
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      setProfile(null);
      setStatus('inactive');
      setInactiveMessage(
        'Your employee profile could not be loaded. Check your connection, or ask an administrator to verify your account.',
      );
      return;
    }
    if (!data) {
      setProfile(null);
      setStatus('inactive');
      setInactiveMessage(
        'No employee profile exists for this account. An administrator must create and activate your account.',
      );
      return;
    }
    const p = mapProfile(data as ProfileRow);
    setProfile(p);
    if (p.isActive) {
      setStatus('ready');
      setInactiveMessage('');
    } else {
      setStatus('inactive');
      setInactiveMessage(
        'Your account is not active yet. An administrator must activate it before you can use the application.',
      );
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (mode !== 'supabase') {
      setProfile(MOCK_AUTH_PROFILE);
      setStatus('ready');
      return () => {
        alive.current = false;
      };
    }
    const supabase = getSupabase();
    void supabase.auth.getSession().then(({ data }) => {
      if (!alive.current) return;
      setSession(data.session);
      if (data.session) void loadProfile(data.session.user.id);
      else setStatus('signed_out');
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive.current) return;
      setSession(next);
      if (next) void loadProfile(next.user.id);
      else {
        setProfile(null);
        setStatus('signed_out');
      }
    });
    return () => {
      alive.current = false;
      sub.subscription.unsubscribe();
    };
  }, [mode, loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        throw new Error(
          error.message === 'Invalid login credentials'
            ? 'Incorrect email or password.'
            : `Sign-in failed: ${error.message}`,
        );
      }
      setStatus('loading');
    },
    [],
  );

  const signOut = useCallback(async () => {
    if (mode === 'supabase') await getSupabase().auth.signOut();
    setSession(null);
    setProfile(null);
    setStatus(mode === 'mock' ? 'ready' : 'signed_out');
  }, [mode]);

  const refreshProfile = useCallback(async () => {
    if (mode === 'supabase' && session) await loadProfile(session.user.id);
  }, [mode, session, loadProfile]);

  const value = useMemo<AuthValue>(
    () => ({
      mode,
      status,
      session,
      profile,
      isAdmin: profile?.role === 'admin' && profile.isActive,
      inactiveMessage,
      signIn,
      signOut,
      refreshProfile,
    }),
    [mode, status, session, profile, inactiveMessage, signIn, signOut, refreshProfile],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider is missing.');
  return v;
}
