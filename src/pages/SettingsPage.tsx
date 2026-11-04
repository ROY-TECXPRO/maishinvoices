import { useEffect, useState, type FormEvent } from 'react';
import { Download, Save } from 'lucide-react';
import { useRepository } from '../data/RepositoryContext';
import { useCompanySettings } from '../config/SettingsContext';
import { useAuth } from '../auth/AuthContext';
import { downloadJson } from '../export/csv';
import { fileToLogoDataUrl } from '../export/logo';
import type { CompanyProfile } from '../config/company';

const lines = (arr: string[]) => arr.join('\n');
const toLines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function SettingsPage() {
  const repo = useRepository();
  const { isAdmin } = useAuth();
  const { settings, loaded, reload } = useCompanySettings();
  const [form, setForm] = useState<CompanyProfile>(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [passBusy, setPassBusy] = useState(false);

  useEffect(() => {
    if (loaded) setForm(settings);
  }, [loaded, settings]);

  const patch = (p: Partial<CompanyProfile>) => {
    setForm((f) => ({ ...f, ...p }));
    setNotice('');
    setError('');
  };

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await repo.saveSettings(form);
      setNotice('Settings saved. Other computers pick the change up automatically.');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the settings.');
    } finally {
      setBusy(false);
    }
  }

  async function onChangePasscode() {
    setPassBusy(true);
    setError('');
    setNotice('');
    try {
      await repo.setFiguresPasscode(newPass);
      setNewPass('');
      setNotice('Dashboard passcode changed. Share the new passcode only with people who may see the figures.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the passcode.');
    } finally {
      setPassBusy(false);
    }
  }

  async function onExport() {
    setExporting(true);
    setError('');
    setNotice('');
    try {
      const bundle = await repo.exportBundle();
      downloadJson(`maish-backup-${bundle.exportedAt.slice(0, 10)}.json`, bundle);
      setNotice(
        `Backup downloaded: ${bundle.documents.length} documents, ${bundle.customers.length} customers, ` +
          `${bundle.versions.length} version snapshots. Keep it somewhere safe.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  const disabled = !isAdmin || busy;

  return (
    <section aria-labelledby="set-h">
      <div className="mb-4">
        <h1 id="set-h" className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Company identity and document defaults used by the editor and every PDF.
          {isAdmin ? '' : ' Only administrators can change them.'}
        </p>
      </div>

      {notice && <p role="status" className="mb-3 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {error && <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <form className="grid gap-4 lg:grid-cols-2" onSubmit={onSave}>
        <section className="rounded border border-slate-200 bg-white p-4" aria-label="Company identity">
          <h2 className="mb-3 text-sm font-semibold">Company identity</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="s-name1" label="Name line 1" value={form.nameLine1} onChange={(v) => patch({ nameLine1: v })} disabled={disabled} />
            <Field id="s-name2" label="Name line 2" value={form.nameLine2} onChange={(v) => patch({ nameLine2: v })} disabled={disabled} />
            <Field id="s-tag" label="Tagline" value={form.tagline} onChange={(v) => patch({ tagline: v })} disabled={disabled} />
            <Field id="s-pobox" label="Postal address" value={form.poBox} onChange={(v) => patch({ poBox: v })} disabled={disabled} />
            <Field id="s-phone" label="Phone" value={form.phone} onChange={(v) => patch({ phone: v })} disabled={disabled} />
            <Field id="s-email" label="Email" value={form.email} onChange={(v) => patch({ email: v })} disabled={disabled} />
            <Field id="s-web" label="Website" value={form.website} onChange={(v) => patch({ website: v })} disabled={disabled} />
            <Field id="s-kra" label="KRA PIN" value={form.kraPin} onChange={(v) => patch({ kraPin: v })} disabled={disabled} />
          </div>
          <div className="mt-3">
            <label className="label" htmlFor="s-logo">Company logo (shown on every PDF and in the menu)</label>
            <div className="flex items-center gap-3">
              {form.logoDataUrl
                ? <img src={form.logoDataUrl} alt="Company logo" className="h-14 w-14 rounded border border-slate-200 bg-white object-contain" />
                : <span className="text-xs text-slate-500">No logo yet</span>}
              <input id="s-logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={disabled} className="text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  fileToLogoDataUrl(file).then((data) => patch({ logoDataUrl: data }), (err: Error) => setError(err.message));
                }} />
              {form.logoDataUrl && (
                <button type="button" className="btn" disabled={disabled} onClick={() => patch({ logoDataUrl: undefined })}>Remove logo</button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">Press Save settings to keep the change.</p>
          </div>
          <div className="mt-3">
            <label className="label" htmlFor="s-dealers">Dealers in (one per line)</label>
            <textarea id="s-dealers" rows={3} className="field" value={lines(form.dealersIn)} disabled={disabled}
              onChange={(e) => patch({ dealersIn: toLines(e.target.value) })} />
          </div>
          <div className="mt-3">
            <label className="label" htmlFor="s-highlights">Highlights printed under the terms (one per line)</label>
            <textarea id="s-highlights" rows={4} className="field" value={lines(form.highlights)} disabled={disabled}
              onChange={(e) => patch({ highlights: toLines(e.target.value) })} />
          </div>
        </section>

        <div className="space-y-4">
          <section className="rounded border border-slate-200 bg-white p-4" aria-label="Bank and document defaults">
            <h2 className="mb-3 text-sm font-semibold">Bank details &amp; document defaults</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="s-bank" label="Bank" value={form.bank.bank} onChange={(v) => patch({ bank: { ...form.bank, bank: v } })} disabled={disabled} />
              <Field id="s-acc" label="Account number" value={form.bank.accountNumber} onChange={(v) => patch({ bank: { ...form.bank, accountNumber: v } })} disabled={disabled} />
              <Field id="s-accname" label="Account name" value={form.bank.accountName} onChange={(v) => patch({ bank: { ...form.bank, accountName: v } })} disabled={disabled} />
            </div>
            <div className="mt-3 max-w-xs">
              <label className="label" htmlFor="s-wa">Business WhatsApp number</label>
              <input id="s-wa" className="field" disabled={disabled} inputMode="tel" placeholder="0799921036"
                value={form.whatsappNumber ?? ''} onChange={(e) => patch({ whatsappNumber: e.target.value })} />
            </div>
            <div className="mt-3 max-w-[12rem]">
              <label className="label" htmlFor="s-overdue">Flag unpaid invoices overdue after (days)</label>
              <input id="s-overdue" type="number" min={1} max={365} className="field" disabled={disabled}
                value={form.overdueAfterDays ?? 30}
                onChange={(e) => patch({ overdueAfterDays: Math.min(365, Math.max(1, Math.round(Number(e.target.value) || 30))) })} />
            </div>
            <div className="mt-3">
              <label className="label" htmlFor="s-terms">Default payment terms (one per line)</label>
              <textarea id="s-terms" rows={3} className="field" value={form.defaultPaymentTerms} disabled={disabled}
                onChange={(e) => patch({ defaultPaymentTerms: e.target.value })} />
            </div>
            <div className="mt-3">
              <label className="label" htmlFor="s-notes">Default notes (one per line)</label>
              <textarea id="s-notes" rows={3} className="field" value={form.defaultNotes} disabled={disabled}
                onChange={(e) => patch({ defaultNotes: e.target.value })} />
            </div>
            <div className="mt-4">
              <button className="btn btn-primary" type="submit" disabled={disabled || !loaded}>
                <Save size={15} aria-hidden /> {busy ? 'Saving...' : 'Save settings'}
              </button>
            </div>
          </section>

          {isAdmin && (
            <section className="rounded border border-slate-200 bg-white p-4" aria-label="Dashboard passcode">
              <h2 className="mb-2 text-sm font-semibold">Dashboard passcode</h2>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="label" htmlFor="s-pass">New passcode (6 or more characters)</label>
                  <input id="s-pass" type="password" autoComplete="new-password" className="field" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
                </div>
                <button className="btn" type="button" disabled={passBusy || newPass.length < 6} onClick={() => void onChangePasscode()}>
                  {passBusy ? 'Saving...' : 'Change passcode'}
                </button>
              </div>
            </section>
          )}

          <section className="rounded border border-slate-200 bg-white p-4" aria-label="Backup and export">
            <h2 className="mb-2 text-sm font-semibold">Backup &amp; export {isAdmin ? '' : '(administrator only)'}</h2>
            <p className="text-sm text-slate-600">
              Downloads every customer, document, line item, version snapshot and audit entry as a single JSON file
              that can be reviewed or re-imported during recovery. {isAdmin ? '' : 'Ask an administrator to run it.'}
            </p>
            <button className="btn mt-3" type="button" onClick={() => void onExport()} disabled={!isAdmin || exporting}>
              <Download size={15} aria-hidden /> {exporting ? 'Preparing...' : 'Download JSON backup'}
            </button>
            <p className="mt-3 text-xs text-slate-500">
              This is a manual export. Automated point-in-time backups depend on the Supabase plan - verify what your
              plan includes under Project Settings &rarr; Database before relying on it. Restore steps are documented
              in the README (Backup &amp; recovery).
            </p>
          </section>
        </div>
      </form>
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="field" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

