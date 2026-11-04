import { createContext, useContext, type ReactNode } from 'react';
import type { Repository } from './repository';

const Ctx = createContext<Repository | null>(null);

export function RepositoryProvider({ repo, children }: { repo: Repository; children: ReactNode }) {
  return <Ctx.Provider value={repo}>{children}</Ctx.Provider>;
}

export function useRepository(): Repository {
  const repo = useContext(Ctx);
  if (!repo) throw new Error('RepositoryProvider is missing.');
  return repo;
}
