import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Download, Heading as HeadingIcon, MessageCircle, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { useRepository } from '../data/RepositoryContext';
import { DuplicateNumberError, NotFoundError, ValidationError, VersionConflictError } from '../data/repository';
import { NotAuthenticatedError, NotAuthorizedError } from '../data/supabase/errors';
import { formatMoney } from '../domain/money';
import {
  blankHeading, blankItem, newEditorState, previewTotals, rowAmountCents, stateFromRecord, stateToDraft,
  todayInNairobi, type EditorLine, type EditorState,
} from '../domain/editorModel';
import { validateDraft, normalizeDraft } from '../domain/validation';
import type { Customer, DocumentRecord, DocumentType } from '../domain/types';
import { downloadPdf, printPdf } from '../pdf/output';
import { shareOnWhatsApp } from '../pdf/share';
import { PaymentsPanel } from './PaymentsPanel';
import { useCompanySettingsOptional } from '../config/SettingsContext';
import { company } from '../config/company';
import { centsToInput } from '../domain/money';
import { buildPrintModel } from '../pdf/printModel';
import { renderDocumentPdf } from '../pdf/renderPdf';

interface Props {
  record: DocumentRecord | null;
  initialType: DocumentType;
}

export function DocumentEditor({ record, initialType }: Props) {
  const repo = useRepository();
  const navigate = useNavigate();
  const [saved, setSaved] = useState<DocumentRecord | null>(record);
  const [state, setState] = useState<EditorState>(() =>
    record ? stateFromRecord(record) : newEditorState(initialType, '', todayInNairobi()),
  );
  const [baseline, setBaseline] = useState<string | null>(record ? JSON.stringify(stateFromRecord(record)) : null);
  const [numberTouched, setNumberTouched] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [recentItems, setRecentItems] = useState<{ description: string; unitPriceCents: number }[]>([]);
  const companyName = useCompanySettingsOptional()?.settings ?? company;

  const isNew = !saved;
  const dirty = baseline === null || JSON.stringify(state) !== baseline;
  const isQuote = state.type === 'quotation';
  const totals = useMemo(() => previewTotals(state), [state]);
  const patch = (p: Partial<EditorState>) => { setState((s) => ({ ...s, ...p })); setNotice(''); };
  // Auto-save after the user stops typing (invoices & quotations).
  useEffect(() => {
    if (!dirty) { setAutoSaveStatus('idle'); return; }
    const { draft, problems: parseProblems } = stateToDraft(state);
    const found = [...parseProblems, ...validateDraft(normalizeDraft(draft))];
    if (found.length) { setAutoSaveStatus('idle'); return; }
    setAutoSaveStatus('saving');
    const t = setTimeout(() => { void save(); }, 1200);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => { repo.listCustomers().then(setCustomers, () => undefined); }, [repo]);

  // Recent items: the newest price used for each description, offered as you type a line.
  useEffect(() => {
    let live = true;
    repo.listDocuments().then((docs) => {
      if (!live) return;
      const seen = new Map<string, { description: string; unitPriceCents: number }>();
      for (const d of [...docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
        for (const i of d.items) {
          if (i.kind !== 'item') continue;
          const key = i.description.trim().toLowerCase();
          if (key && !seen.has(key)) seen.set(key, { description: i.description.trim(), unitPriceCents: i.unitPriceCents });
          if (seen.size >= 300) break;
        }
      }
      setRecentItems([...seen.values()]);
    }, () => undefined);
    return () => { live = false; };
  }, [repo]);

  // Suggest a number for new documents until the user edits it by hand.
  useEffect(() => {
    if (!isNew || numberTouched) return;
    let live = true;
    repo.getNextNumber(state.type, state.issueDate).then(
      (n) => live && setState((s) => (s.number === n && s.orderNumber === n ? s : { ...s, number: n, orderNumber: n })),
      () => undefined,
    );
    return () => { live = false; };
  }, [repo, isNew, numberTouched, state.type, state.issueDate]);

  const onDescription = (id: string, description: string) => {
    const match = recentItems.find((r) => r.description.toLowerCase() === description.trim().toLowerCase());
    const line = state.lines.find((l) => l.id === id);
    setLine(id, match && line && !line.price.trim() ? { description, price: centsToInput(match.unitPriceCents) } : { description });
  };
  const setLine = (id: string, p: Partial<EditorLine>) => patch({ lines: state.lines.map((l) => (l.id === id ? { ...l, ...p } : l)) });
  const moveLine = (idx: number, by: -1 | 1) => {
    const lines = [...state.lines];
    const j = idx + by;
    if (j < 0 || j >= lines.length) return;
    [lines[idx], lines[j]] = [lines[j], lines[idx]];
    patch({ lines });
  };
  const removeLine = (id: string) => patch({ lines: state.lines.filter((l) => l.id !== id) });

  const onCustomerName = (name: string) => {
    const match = customers.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    patch(match
      ? { customerName: name, customerId: match.id, customerPhone: match.phone, customerEmail: match.email, customerAddress: match.address }
      : { customerName: name, customerId: null });
  };

  async function save() {
    const { draft, problems: parseProblems } = stateToDraft(state);
    const found = [...parseProblems, ...validateDraft(normalizeDraft(draft))];
    if (found.length) { setProblems([...new Set(found)]); setAutoSaveStatus('error'); return; }
    setBusy(true); setProblems([]); setNotice(''); setAutoSaveStatus('saving');
    try {
      const rec = await repo.saveDocument({ id: saved?.id, expectedVersion: saved?.version, draft });
      const next = stateFromRecord(rec);
      setSaved(rec); setState(next); setBaseline(JSON.stringify(next));
      setNotice(`Saved ${rec.number} (version ${rec.version}).`);
      setAutoSaveStatus('saved');
      if (isNew) navigate(`/documents/${rec.id}`, { replace: true });
    } catch (e) {
      setAutoSaveStatus('error');
      if (e instanceof ValidationError) setProblems(e.problems);
      else if (e instanceof DuplicateNumberError || e instanceof VersionConflictError) setProblems([e.message]);
      else if (e instanceof NotAuthenticatedError) setProblems(['You are not signed in. Sign in again, then retry. Nothing was saved.']);
      else if (e instanceof NotAuthorizedError) setProblems(['Your account is not active yet. Ask an administrator to activate it. Nothing was saved.']);
      else if (e instanceof NotFoundError) setProblems(['This document no longer exists on the server. Reload the page. Nothing was saved.']);
      else if (e instanceof TypeError) setProblems(['Could not reach the server. Check your connection, or the save_document database function may not be deployed yet. Nothing was saved.']);
      else if (e instanceof Error && e.message) setProblems([`${e.message} Nothing was saved.`]);
      else setProblems(['The document could not be saved. Check your connection and try again. Nothing was saved.']);
    } finally { setBusy(false); }
  }

  async function moveToTrash() {
    if (!saved) return;
    if (!window.confirm(`Move ${saved.number} to the trash? You can restore it from the Trash page.`)) return;
    setBusy(true); setProblems([]); setNotice('');
    try {
      const fresh = await repo.getDocument(saved.id);
      await repo.setDocumentStatus(saved.id, 'trashed', fresh?.version ?? saved.version);
      navigate('/documents', { replace: true });
    } catch (e) {
      setProblems([e instanceof Error && e.message ? e.message : 'Could not move the document to the trash.']);
    } finally { setBusy(false); }
  }

  async function onWhatsApp() {
    if (!saved) return;
    const m = savedModel();
    const wa = companyName.whatsappNumber ?? '0799921036';
    const text = `Hello ${saved.customerName}, please find our ${saved.type === 'invoice' ? 'invoice' : 'quotation'} ${saved.number} from ${companyName.nameLine1} ${companyName.nameLine2}. Questions? WhatsApp us on ${wa}.`;
    try {
      const how = await shareOnWhatsApp(renderDocumentPdf(m), m, saved.customerPhone || wa, text);
      setNotice(how === 'shared' ? 'Shared.' : 'PDF downloaded and WhatsApp opened. Press the attach (paperclip) button, choose the downloaded PDF and send.');
    } catch {
      setProblems(['Could not prepare the PDF for WhatsApp. Download the PDF and send it manually.']);
    }
  }

  const saveRef = useRef<() => void>(() => undefined);
  saveRef.current = () => { if (!busy && (isNew || dirty)) void save(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // PDF/print always render the last SAVED version so output matches the stored record.
  const savedModel = () => buildPrintModel(saved!);
  const onDownload = () => { const m = savedModel(); downloadPdf(renderDocumentPdf(m), m); };
  const onPrint = () => printPdf(renderDocumentPdf(savedModel()));
  const outputBlocked = isNew || dirty;
  const outputHint = outputBlocked ? 'Save your changes first so the PDF matches the saved document.' : undefined;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{isNew ? 'New' : 'Edit'} {isQuote ? 'quotation' : 'invoice'}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500" aria-live="polite">
            {isNew ? 'Not saved yet' : dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
          <button className="btn" onClick={onDownload} disabled={outputBlocked} title={outputHint}><Download size={15} aria-hidden /> Download PDF</button>
          <button className="btn" onClick={onPrint} disabled={outputBlocked} title={outputHint}><Printer size={15} aria-hidden /> Print</button>
          <button className="btn" onClick={() => void onWhatsApp()} disabled={outputBlocked} title={outputHint ?? 'Send the PDF on WhatsApp'}><MessageCircle size={15} aria-hidden /> WhatsApp</button>
          {!isNew && <button className="btn text-red-700" onClick={() => void moveToTrash()} disabled={busy} title="Move to trash (recoverable)"><Trash2 size={15} aria-hidden /> Move to trash</button>}
          <button className="btn btn-primary" onClick={save} disabled={busy || (!isNew && !dirty)}><Save size={15} aria-hidden /> {busy ? 'Saving...' : 'Save'}</button>
          <span className="ml-2 text-xs text-slate-500" aria-live="polite">
            {autoSaveStatus === 'saving' ? 'Auto-saving…' : autoSaveStatus === 'saved' ? 'Auto-saved' : autoSaveStatus === 'error' ? 'Not saved' : ''}
          </span>
        </div>
      </div>

      {problems.length > 0 && (
        <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Fix the following before saving:</p>
          <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {notice && <p role="status" className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

      <div className="space-y-4">
        <section className="rounded border border-slate-200 bg-white p-4" aria-label="Document details">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label" htmlFor="doc-type">Document type</label>
              <select id="doc-type" className="field" value={state.type} disabled={!isNew}
                onChange={(e) => patch({ type: e.target.value as DocumentType, ...(e.target.value === 'quotation' ? { discountMode: 'none', taxEnabled: false } : {}) })}>
                <option value="quotation">Quotation</option>
                <option value="invoice">Invoice</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="doc-number">Document number</label>
              <input id="doc-number" className="field" value={state.number} onChange={(e) => { setNumberTouched(true); const n = e.target.value; patch({ number: n, orderNumber: !state.orderNumber || state.orderNumber === state.number ? n : state.orderNumber }); }} />
            </div>
            <div>
              <label className="label" htmlFor="doc-date">Date</label>
              <input id="doc-date" type="date" className="field" value={state.issueDate} onChange={(e) => patch({ issueDate: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="doc-order">Order number (optional)</label>
              <input id="doc-order" className="field" value={state.orderNumber} onChange={(e) => patch({ orderNumber: e.target.value })} />
            </div>
          </div>
        </section>

        <section className="rounded border border-slate-200 bg-white p-4" aria-label="Customer">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="cust-name">Customer / business name (M/S)</label>
              <input id="cust-name" className="field" list="customer-list" value={state.customerName} onChange={(e) => onCustomerName(e.target.value)} />
              <datalist id="customer-list">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
              <datalist id="recent-items">{recentItems.map((r) => <option key={r.description} value={r.description} />)}</datalist>
            </div>
            <div>
              <label className="label" htmlFor="cust-phone">Phone (optional)</label>
              <input id="cust-phone" className="field" value={state.customerPhone} onChange={(e) => patch({ customerPhone: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="cust-email">Email</label>
              <input id="cust-email" type="email" className="field" value={state.customerEmail} onChange={(e) => patch({ customerEmail: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="cust-address">Address</label>
              <input id="cust-address" className="field" value={state.customerAddress} onChange={(e) => patch({ customerAddress: e.target.value })} />
            </div>
          </div>
        </section>

        <section className="rounded border border-slate-200 bg-white p-4" aria-label="Line items">
          <div className="hidden grid-cols-[4.5rem_1fr_7rem_8rem_6.5rem] gap-2 px-1 pb-1 text-xs font-medium text-slate-600 md:grid">
            <span>QTY</span><span>PARTICULARS</span><span>UNIT PRICE</span><span className="text-right">AMOUNT</span><span />
          </div>
          <div className="space-y-2">
            {state.lines.map((l, idx) => {
              const row = idx + 1;
              const amount = rowAmountCents(l);
              return (
                <div key={l.id} className="grid grid-cols-2 items-center gap-2 md:grid-cols-[4.5rem_1fr_7rem_8rem_6.5rem]">
                  {l.kind === 'item' ? (
                    <>
                      <input className="field" inputMode="decimal" placeholder="Qty" aria-label={`Quantity row ${row}`} value={l.qty} onChange={(e) => setLine(l.id, { qty: e.target.value })} />
                      <input className="field col-span-2 md:col-span-1" placeholder="Description" list="recent-items" aria-label={`Description row ${row}`} value={l.description} onChange={(e) => onDescription(l.id, e.target.value)} />
                      <input className="field" inputMode="decimal" placeholder="Unit price" aria-label={`Unit price row ${row}`} value={l.price} onChange={(e) => setLine(l.id, { price: e.target.value })} />
                      <output className="text-right text-sm tabular-nums" aria-label={`Amount row ${row}`}>{amount === null ? '-' : formatMoney(amount)}</output>
                    </>
                  ) : (
                    <>
                      <span className="text-xs font-medium text-slate-500">Heading</span>
                      <input className="field col-span-2 font-semibold md:col-span-3" placeholder="Group heading, e.g. HEAD CHEF" aria-label={`Description row ${row}`} value={l.description} onChange={(e) => setLine(l.id, { description: e.target.value })} />
                    </>
                  )}
                  <div className="col-span-2 flex justify-end md:col-span-1">
                    <button className="icon-btn" aria-label={`Move row ${row} up`} onClick={() => moveLine(idx, -1)} disabled={idx === 0}><ArrowUp size={15} /></button>
                    <button className="icon-btn" aria-label={`Move row ${row} down`} onClick={() => moveLine(idx, 1)} disabled={idx === state.lines.length - 1}><ArrowDown size={15} /></button>
                    <button className="icon-btn" aria-label={`Remove row ${row}`} onClick={() => removeLine(l.id)}><Trash2 size={15} /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn" onClick={() => patch({ lines: [...state.lines, blankItem()] })}><Plus size={15} aria-hidden /> Add item</button>
            <button className="btn" onClick={() => patch({ lines: [...state.lines, blankHeading()] })}><HeadingIcon size={15} aria-hidden /> Add heading</button>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded border border-slate-200 bg-white p-4" aria-label="Terms and notes">
            <label className="label" htmlFor="terms">Payment terms (one per line)</label>
            <textarea id="terms" rows={3} className="field" value={state.paymentTerms} onChange={(e) => patch({ paymentTerms: e.target.value })} />
            <label className="label mt-3" htmlFor="notes">Notes (one per line)</label>
            <textarea id="notes" rows={3} className="field" value={state.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </section>

          {isQuote ? (
            <section className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600" aria-label="Quotation totals">
              Quotations show each line amount but never a grand total, discount or tax.
            </section>
          ) : (
            <section className="rounded border border-slate-200 bg-white p-4" aria-label="Adjustments and totals" data-testid="totals-panel">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="disc-mode">Discount</label>
                  <select id="disc-mode" className="field" value={state.discountMode} onChange={(e) => patch({ discountMode: e.target.value as EditorState['discountMode'] })}>
                    <option value="none">None</option><option value="percent">Percent</option><option value="fixed">Fixed amount</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="disc-val">{state.discountMode === 'percent' ? 'Discount %' : 'Discount (KSh)'}</label>
                  <input id="disc-val" className="field" inputMode="decimal" disabled={state.discountMode === 'none'} value={state.discountValue} onChange={(e) => patch({ discountValue: e.target.value })} />
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={state.taxEnabled} onChange={(e) => patch({ taxEnabled: e.target.checked })} /> Apply tax to this invoice</label>
              {state.taxEnabled && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div><label className="label" htmlFor="tax-label">Tax label</label><input id="tax-label" className="field" value={state.taxLabel} onChange={(e) => patch({ taxLabel: e.target.value })} /></div>
                  <div><label className="label" htmlFor="tax-rate">Tax rate %</label><input id="tax-rate" className="field" inputMode="decimal" value={state.taxRate} onChange={(e) => patch({ taxRate: e.target.value })} /></div>
                </div>
              )}
              {totals && (
                <dl className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-sm tabular-nums">
                  <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatMoney(totals.subtotalCents)}</dd></div>
                  {totals.discountCents > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>-{formatMoney(totals.discountCents)}</dd></div>}
                  {totals.taxCents > 0 && <div className="flex justify-between"><dt>{state.taxLabel} ({state.taxRate}%)</dt><dd>{formatMoney(totals.taxCents)}</dd></div>}
                  <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd aria-label="Invoice total">{formatMoney(totals.totalCents)}</dd></div>
                </dl>
              )}
            </section>
          )}
        </div>
      </div>
      {saved && saved.type === 'invoice' && <PaymentsPanel record={saved} />}
    </div>
  );
}
