import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { useRepository } from '../data/RepositoryContext';
import { formatMoney } from '../domain/money';
import { Modal } from '../components/Modal';

export const HIDDEN = '••••';

interface FiguresValue {
  /** True only after the server accepted the passcode. */
  revealed: boolean;
  /** Kept in memory only while revealed, so the AI assistant can ask the server to verify it again. Never stored. */
  passcode: string | null;
  requestReveal: () => void;
  hide: () => void;
}

const FiguresCtx = createContext<FiguresValue>({ revealed: false, passcode: null, requestReveal: () => undefined, hide: () => undefined });

export const useFigures = () => useContext(FiguresCtx);

/**
 * One passcode gate for every screen that shows money: Dashboard, Documents, Trash, Reports,
 * Outstanding and the AI assistant. The passcode is verified on the server; figures hide again
 * after 2 minutes, when the browser tab is hidden, or on sign-out.
 */
export function FiguresProvider({ children }: { children: ReactNode }) {
  const repo = useRepository();
  const [passcode, setPasscodeState] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [entry, setEntry] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const revealed = passcode !== null;

  const hide = useCallback(() => setPasscodeState(null), []);
  const requestReveal = useCallback(() => { setError(''); setEntry(''); setShowPrompt(true); }, []);
  const close = () => { setShowPrompt(false); setEntry(''); setError(''); };

  async function submit() {
    if (!entry || checking) return;
    setChecking(true);
    setError('');
    try {
      if (await repo.verifyFiguresPasscode(entry)) {
        setPasscodeState(entry);
        setShowPrompt(false);
        setEntry('');
      } else {
        setError('Incorrect passcode.');
        setEntry('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the passcode. Try again.');
      setEntry('');
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!revealed) return;
    const timer = window.setTimeout(hide, 2 * 60 * 1000);
    const onVisibility = () => { if (document.hidden) hide(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [revealed, hide]);

  const value = useMemo(() => ({ revealed, passcode, requestReveal, hide }), [revealed, passcode, requestReveal, hide]);

  return (
    <FiguresCtx.Provider value={value}>
      {children}
      {showPrompt && (
        <Modal
          label="Enter passcode"
          title="Enter passcode"
          icon={<Lock size={22} aria-hidden />}
          onClose={close}
          footer={
            <>
              <button type="button" className="btn" onClick={close}>Cancel</button>
              <button type="submit" form="figures-form" className="btn btn-primary" disabled={!entry || checking}>
                {checking ? 'Checking...' : 'Show figures'}
              </button>
            </>
          }
        >
          <form id="figures-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <p className="text-slate-600">The figures are protected.</p>
            <input
              type="password"
              autoFocus
              autoComplete="off"
              value={entry}
              onChange={(e) => { setEntry(e.target.value); setError(''); }}
              placeholder="Passcode"
              aria-label="Passcode"
              className="field mt-3"
            />
            {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
            <p className="mt-3 text-xs text-slate-500">Don&apos;t have the passcode? Contact the administrator.</p>
          </form>
        </Modal>
      )}
    </FiguresCtx.Provider>
  );
}

/** Money that shows •••• until the figures are unlocked. */
export function Money({ cents, className }: { cents: number; className?: string }) {
  const { revealed } = useFigures();
  return <span className={className}>{revealed ? formatMoney(cents) : HIDDEN}</span>;
}

/** The eye button. */
export function FiguresToggle() {
  const { revealed, requestReveal, hide } = useFigures();
  return revealed ? (
    <button type="button" onClick={hide} className="btn" aria-label="Hide figures" title="Hide figures">
      <Eye size={15} aria-hidden /> Hide figures
    </button>
  ) : (
    <button type="button" onClick={requestReveal} className="btn" aria-label="Show figures" title="Show figures (passcode required)">
      <EyeOff size={15} aria-hidden /> Show figures
    </button>
  );
}

/** Replaces a whole page that is nothing but figures (Reports, Outstanding) until unlocked. */
export function FiguresLock({ title, children }: { title: string; children: ReactNode }) {
  const { revealed, requestReveal } = useFigures();
  if (revealed) return <>{children}</>;
  return (
    <section aria-label={title} className="mx-auto mt-10 max-w-md rounded border border-slate-200 bg-white p-6 text-center">
      <Lock className="mx-auto text-slate-400" size={28} aria-hidden />
      <h1 className="mt-2 text-lg font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-slate-600">This page shows figures. Enter the passcode to view it.</p>
      <button type="button" className="btn btn-primary mt-4" onClick={requestReveal}>
        <EyeOff size={15} aria-hidden /> Show figures
      </button>
      <p className="mt-3 text-xs text-slate-500">Don&apos;t have the passcode? Contact the administrator.</p>
    </section>
  );
}
