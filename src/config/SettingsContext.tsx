import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { company as defaultCompany, type CompanyProfile } from './company';
import { useRepository } from '../data/RepositoryContext';

interface SettingsValue {
  settings: CompanyProfile;
  loaded: boolean;
  error: string;
  reload: () => void;
}

const Ctx = createContext<SettingsValue | null>(null);

/**
 * Loads company/document settings from the repository (Supabase-backed in
 * production) and refreshes them when another computer changes them.
 * `src/config/company.ts` remains the built-in default/fallback.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const repo = useRepository();
  const [settings, setSettings] = useState<CompanyProfile | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    repo
      .getSettings()
      .then((s) => {
        setSettings(s);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  }, [repo]);

  useEffect(() => {
    reload();
    const unsubscribe = repo.subscribe((info) => {
      if (info.table === 'company_settings' || info.table === 'connection') reload();
    });
    return unsubscribe;
  }, [repo, reload]);

  return (
    <Ctx.Provider value={{ settings: settings ?? defaultCompany, loaded: settings !== null, error, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCompanySettings(): SettingsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('SettingsProvider is missing.');
  return v;
}

/** Same as useCompanySettings but returns null outside a SettingsProvider (used by components that can render without one). */
export function useCompanySettingsOptional(): SettingsValue | null {
  return useContext(Ctx);
}
