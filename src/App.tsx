import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import {
  Bot,
  FilePlus2,
  FileText,
  Files,
  History,
  LayoutDashboard,
  LogOut,
  Moon,
  Settings,
  Sun,
  Wallet,
  Trash2,
  TriangleAlert,
  Users,
  UsersRound,
} from 'lucide-react';
import { useRepository } from './data/RepositoryContext';
import { useAuth } from './auth/AuthContext';
import { InactiveAccountScreen, LoginPage } from './auth/LoginPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { EditorPage } from './pages/EditorPage';
import { DashboardPage } from './pages/DashboardPage';
import { CustomersPage } from './pages/CustomersPage';
import { ReportsPage } from './pages/ReportsPage';
import { TrashPage } from './pages/TrashPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsersPage } from './pages/UsersPage';
import { AiAssistantPage } from './pages/AiAssistantPage';
import { OutstandingPage } from './pages/OutstandingPage';
import { FiguresProvider } from './auth/FiguresContext';
import { useCompanySettings } from './config/SettingsContext';
import { applyTheme, getTheme, type Theme } from './theme';

const nav = 'nav-link flex items-center gap-2 px-3 py-2 text-sm font-semibold';
const link = ({ isActive }: { isActive: boolean }) => `${nav} ${isActive ? 'nav-link-active' : ''}`;

export function App() {
  const repo = useRepository();
  const { mode, status, profile, isAdmin, inactiveMessage, signOut } = useAuth();
  const { settings } = useCompanySettings();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<Theme>(getTheme);

  useEffect(() => { applyTheme(theme); }, [theme]);

  // Keyboard shortcuts: Alt+Q new quotation, Alt+I new invoice, Alt+D dashboard, Alt+L documents.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const go = (to: string) => { e.preventDefault(); navigate(to); };
      const k = e.key.toLowerCase();
      if (k === 'q') go('/documents/new?type=quotation');
      else if (k === 'i') go('/documents/new?type=invoice');
      else if (k === 'd') go('/');
      else if (k === 'l') go('/documents');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  if (mode === 'supabase') {
    if (status === 'loading') {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
          Checking your session...
        </div>
      );
    }
    if (status === 'signed_out') return <LoginPage />;
    if (status === 'inactive') return <InactiveAccountScreen />;
  }

  return (
    <FiguresProvider>
    <div className="min-h-screen bg-slate-50 text-slate-900 md:flex">
      <aside className="app-aside p-3 md:min-h-screen md:w-60">
        <div className="mb-3 px-3 py-2">
          {settings.logoDataUrl && <img src={settings.logoDataUrl} alt="" className="mb-2 h-12 w-12 object-contain" />}
          <div className="brand-title text-sm font-bold leading-tight">Maish Invoice &amp; Quotation Manager</div>
          {profile && (
            <div className="mt-1 text-xs text-slate-500">
              {profile.fullName}
              {isAdmin ? ' - Administrator' : ''}
            </div>
          )}
        </div>
        <nav className="flex flex-wrap gap-1 md:flex-col" aria-label="Main">
          <NavLink to="/" end className={link}><LayoutDashboard size={16} aria-hidden /> Dashboard</NavLink>
          <NavLink to="/documents" className={link}><Files size={16} aria-hidden /> Documents</NavLink>
          <NavLink to="/documents/new?type=quotation" className={link}><FilePlus2 size={16} aria-hidden /> New quotation</NavLink>
          <NavLink to="/documents/new?type=invoice" className={link}><FileText size={16} aria-hidden /> New invoice</NavLink>
          <NavLink to="/customers" className={link}><UsersRound size={16} aria-hidden /> Customers</NavLink>
          <NavLink to="/outstanding" className={link}><Wallet size={16} aria-hidden /> Outstanding</NavLink>
          <NavLink to="/reports" className={link}><Files size={16} aria-hidden /> Reports</NavLink>
          <NavLink to="/assistant" className={link}><Bot size={16} aria-hidden /> AI assistant</NavLink>
          <NavLink to="/history" className={link}><History size={16} aria-hidden /> History</NavLink>
          <NavLink to="/trash" className={link}><Trash2 size={16} aria-hidden /> Trash</NavLink>
          <NavLink to="/settings" className={link}><Settings size={16} aria-hidden /> Settings</NavLink>
          {isAdmin && <NavLink to="/users" className={link}><Users size={16} aria-hidden /> Users</NavLink>}
          <button
            className={`${nav} w-full text-left`}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />} {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          {mode === 'supabase' && (
            <button className={`${nav} nav-link-danger w-full text-left`} onClick={() => void signOut()}>
              <LogOut size={16} aria-hidden /> Sign out
            </button>
          )}
        </nav>
        <p className="mt-3 hidden px-3 text-[11px] leading-snug text-slate-400 md:block">
          Shortcuts: Alt+Q new quotation, Alt+I new invoice, Alt+D dashboard, Alt+L documents, Ctrl+S save.
        </p>
      </aside>
      <main className="flex-1">
        {repo.mode === 'mock' && (
          <div role="status" className="flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              <strong>Development mode.</strong> Records are stored only in this browser. They are not shared with other
              computers and numbering is not authoritative. Do not enter real customer data.
            </span>
          </div>
        )}
        {repo.mode === 'supabase' && inactiveMessage && (
          <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            {inactiveMessage}
          </div>
        )}
        <div className="page-wrap mx-auto max-w-6xl p-4 md:p-6">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/documents/new" element={<EditorPage />} />
            <Route path="/documents/:id" element={<EditorPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/outstanding" element={<OutstandingPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/assistant" element={<AiAssistantPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/history/:documentId" element={<HistoryPage />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/users" element={isAdmin ? <UsersPage /> : <Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
    </FiguresProvider>
  );
}

