import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRepository } from '../data/RepositoryContext';

export interface LiveState<T> {
  data: T | null;
  error: string;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads data, refetches when any of the given tables change elsewhere (Supabase
 * Realtime), and re-runs whenever `deps` (filters) change. Handlers always
 * refetch authoritative rows - remote payloads never overwrite local state.
 */
export function useLive<T>(
  load: () => Promise<T>,
  tables: string[] = ['documents'],
  deps: unknown[] = [],
): LiveState<T> {
  const repo = useRepository();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const depsKey = useMemo(() => JSON.stringify(deps), [deps]);

  const reload = useCallback(() => {
    loadRef
      .current()
      .then((value) => {
        setData(value);
        setError('');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setLoading(true);
    reload();
    const tablesWanted = new Set(tables);
    const unsubscribe = repo.subscribe((info) => {
      if (info.table === 'connection') return;
      if (tablesWanted.has(info.table)) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(reload, 200);
      }
    });
    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, reload, depsKey, tables.join('|')]);

  return { data, error, loading, reload };
}
