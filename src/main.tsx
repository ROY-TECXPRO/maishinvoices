import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { MockRepository, createLocalStorageStore } from './data/mockRepository';
import { SupabaseRepository } from './data/supabaseRepository';
import { RepositoryProvider } from './data/RepositoryContext';
import { AuthProvider, resolveDataMode } from './auth/AuthContext';
import { SettingsProvider } from './config/SettingsContext';
import { registerServiceWorker } from './pwa';
import './index.css';

const mode = resolveDataMode();

function ConfigurationNeeded() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="max-w-xl rounded border border-amber-300 bg-amber-50 p-6">
        <h1 className="text-lg font-semibold text-amber-900">Configuration needed</h1>
        <p className="mt-2 text-sm text-amber-900">
          This application needs a Supabase connection to run. Copy <code>.env.example</code> to{' '}
          <code>.env.local</code> and fill in:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
          <li>
            <code>VITE_SUPABASE_URL</code> - the project URL
          </li>
          <li>
            <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> (or <code>VITE_SUPABASE_ANON_KEY</code>) - the
            PUBLIC key only. Never put a service-role key in frontend code.
          </li>
        </ul>
        <p className="mt-3 text-sm text-amber-900">
          For browser-only development without a backend, additionally set{' '}
          <code>VITE_DATA_MODE=mock</code> (development builds only - the app never silently falls
          back to local storage).
        </p>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (mode === 'unconfigured') {
  root.render(
    <React.StrictMode>
      <ConfigurationNeeded />
    </React.StrictMode>,
  );
} else {
  const repo = mode === 'supabase' ? new SupabaseRepository() : new MockRepository(createLocalStorageStore());
  registerServiceWorker();
  root.render(
    <React.StrictMode>
      <AuthProvider mode={mode}>
        <RepositoryProvider repo={repo}>
          <SettingsProvider>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <App />
            </BrowserRouter>
          </SettingsProvider>
        </RepositoryProvider>
      </AuthProvider>
    </React.StrictMode>,
  );
}

