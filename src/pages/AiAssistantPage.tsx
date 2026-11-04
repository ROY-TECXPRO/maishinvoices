import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Bot } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { FiguresToggle, useFigures } from '../auth/FiguresContext';
import { getSupabase } from '../data/supabase/client';

export function AiAssistantPage() {
  const { isAdmin } = useAuth();
  const { passcode } = useFigures();
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addMessage = useCallback((text: string, kind: AiMessage['kind'], data?: unknown) => {
    setMessages((m) => [...m, { id: crypto.randomUUID(), kind, text, data, at: new Date().toISOString() }]);
  }, []);

  const send = useCallback(async (payload: { message: string; passcode?: string } | { confirm: unknown; passcode?: string } | { diagnose: true }, echo?: string) => {
    if (busy) return;
    if (echo) addMessage(echo, 'user');
    setBusy(true);
    setError('');

    try {
      // Edge Functions require the user's JWT + the public anon key.
      // Without these, Supabase returns 401 and fetch surfaces "Failed to fetch".
      const { data: { session } } = await getSupabase().auth.getSession();
      const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
      if (!session?.access_token) throw new Error('You are not signed in. Sign in again, then retry.');
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: key,
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        let detail = `Request failed (${resp.status}).`;
        try {
          const payload = await resp.json();
          detail = payload.error?.message || payload.error || detail;
        } catch { /* keep default */ }
        if (resp.status === 401) detail = 'You are not signed in. Please sign in again, then retry.';
        else if (resp.status === 403) detail = 'Your account is not active or cannot use the assistant. Ask an administrator.';
        else if (resp.status === 404) detail = 'The assistant is not deployed yet. Ask an administrator to deploy the ai-assistant Edge Function.';
        else if (resp.status === 400) detail = detail || 'The request was not understood. Please try again.';
        throw new Error(detail);
      }
      const data = await resp.json();
      if (data.error) {
        addMessage(typeof data.error === 'string' ? data.error : data.error.message, 'error');
        return;
      }
      addMessage(data.reply || 'Done.', 'assistant', data.pendingAction ? { pendingAction: data.pendingAction } : data.actions);
    } catch (err) {
      const msg = err instanceof TypeError
        ? 'Could not reach the assistant. Check your connection, or the ai-assistant Edge Function may not be deployed yet.'
        : err instanceof Error ? err.message : 'Could not reach the assistant.';
      setError(msg);
      addMessage(msg, 'error');
    } finally {
      setBusy(false);
    }
  }, [busy, addMessage]);

  const ask = useCallback((text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput('');
    void send({ message: t, passcode: passcode ?? undefined }, t);
  }, [busy, send, passcode]);

  const confirmPending = useCallback((action: unknown, messageId: string) => {
    setMessages((m) => m.map((x) => (x.id === messageId ? { ...x, data: undefined } : x)));
    void send({ confirm: action, passcode: passcode ?? undefined }, 'Confirmed.');
  }, [send, passcode]);

  const cancelPending = useCallback((messageId: string) => {
    setMessages((m) => m.map((x) => (x.id === messageId ? { ...x, data: undefined } : x)));
    addMessage('Cancelled. Nothing was changed.', 'assistant');
  }, [addMessage]);

  return (
    <section className="h-full flex flex-col">
      <header className="border-b border-slate-200 bg-white p-4 flex items-center gap-2">
        <Bot className="text-brand-600" size={20} aria-hidden />
        <div className="flex-1">
          <h1 className="text-sm font-semibold">Maish AI assistant</h1>
          <p className="text-xs text-slate-500">Ask me about documents, customers, reports or how things work.</p>
        </div>
        <FiguresToggle />
        {isAdmin && (
          <button type="button" className="btn" disabled={busy} onClick={() => void send({ diagnose: true }, 'Test AI connection')}>
            Test AI connection
          </button>
        )}
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-slate-500 text-center mt-10">
            <p className="mb-3">Hi - I&rsquo;m your Maish assistant. Try:</p>
            <ul className="text-left mx-auto max-w-xs list-disc space-y-1 pl-5 text-slate-600">
              <li>Show me all invoices for October.</li>
              <li>Summarize this month&rsquo;s invoicing.</li>
              <li>Create a quotation for Olkupelia for 10 shirts at KSh 1,200 each.</li>
              <li>Convert this quotation into an invoice.</li>
              <li>How do I restore an earlier version?</li>
              <li>Why is my PDF not printing?</li>
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-3 ${m.kind === 'user' ? 'flex-row-reverse' : ''}`}>
            <div
              className={`rounded p-3 text-sm max-w-[80%] ${
                m.kind === 'user' ? 'bg-brand-100 text-brand-900' : m.kind === 'assistant' ? 'bg-white border border-slate-200 text-slate-900' : 'bg-red-50 text-red-900 border border-red-200'
              }`}
            >
              {m.kind === 'user' ? <span className="font-medium">You:</span> : m.kind === 'assistant' ? (
                <span className="font-medium text-brand-700">Assistant:</span>
              ) : (
                <span className="font-medium text-red-800">Error:</span>
              )}
              <div className="mt-0.5 whitespace-pre-line">{m.text}</div>
              {m.kind === 'assistant' && !!pendingOf(m.data) && (
                <div className="mt-2 flex gap-2">
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => confirmPending(pendingOf(m.data), m.id)}>Confirm</button>
                  <button type="button" className="btn" disabled={busy} onClick={() => cancelPending(m.id)}>Cancel</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-slate-500"><span className="animate-pulse">···</span> thinking…
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      <footer className="border-t border-slate-200 bg-white p-3">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
          <input
            className="field flex-1"
            placeholder="Ask me anything about documents, customers or reports…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !input.trim()}>
            <Send size={15} aria-hidden />
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          The assistant runs on a configured AI provider. Moving a document to the trash always asks you to confirm first.
        </p>
      </footer>
    </section>
  );
}

function pendingOf(data: unknown): unknown {
  return data && typeof data === 'object' && 'pendingAction' in data ? (data as { pendingAction: unknown }).pendingAction : undefined;
}

interface AiMessage {
  id: string;
  kind: 'user' | 'assistant' | 'error';
  text: string;
  data?: unknown;
  at: string;
}
