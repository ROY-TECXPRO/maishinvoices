import { useState, type FormEvent } from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from './AuthContext';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="page-wrap w-full max-w-sm rounded border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-brand-700">Maish Invoice &amp; Quotation Manager</h1>
        <p className="mt-1 text-sm text-slate-600">Sign in with your employee account.</p>

        <form className="mt-5 space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
              {error}
            </p>
          )}
          <button className="btn btn-primary w-full justify-center" type="submit" disabled={busy}>
            <LogIn size={15} aria-hidden /> {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-xs text-slate-500">
          Accounts are created and activated by an administrator - there is no public sign-up.
          If you need access, ask your administrator to add your account.
        </p>
      </div>
    </div>
  );
}

/** Shown when a signed-in account has not been activated (or has no profile). */
export function InactiveAccountScreen() {
  const { inactiveMessage, signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded border border-amber-300 bg-amber-50 p-6">
        <h1 className="text-lg font-semibold text-amber-900">Account not active</h1>
        <p className="mt-2 text-sm text-amber-900">{inactiveMessage}</p>
        <p className="mt-2 text-xs text-amber-800">
          Business data stays protected until an administrator activates your account.
        </p>
        <button className="btn mt-4" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
