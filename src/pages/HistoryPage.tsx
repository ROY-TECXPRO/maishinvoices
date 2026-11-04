import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useRepository } from '../data/RepositoryContext';
import { useLive } from '../hooks/useLive';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import type { AuditAction, AuditEntry, DocumentVersion } from '../domain/types';

const ACTION_LABEL: Record<AuditAction, string> = {
  created: 'Created',
  updated: 'Updated',
  trashed: 'Moved to trash',
  restored: 'Restored',
  duplicated: 'Duplicated',
  converted: 'Converted to invoice',
  version_restored: 'Version restored',
  purged: 'Permanently deleted',
  customer_updated: 'Customer saved',
  settings_updated: 'Settings updated',
  user_changed: 'User changed',
  customer_trashed: 'Customer moved to trash',
  customer_restored: 'Customer restored',
  customer_purged: 'Customer permanently deleted',
  passcode_changed: 'Dashboard passcode changed',
  payment_recorded: 'Payment recorded',
  payment_deleted: 'Payment removed',
  history_cleared: 'History moved to trash',
  history_restored: 'History restored',
  history_purged: 'History permanently deleted',
};

function formatAt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export function HistoryPage() {
  const repo = useRepository();
  const { isAdmin } = useAuth();
  const { documentId } = useParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const audit = useLive(() => repo.listAudit(documentId), ['documents'], [documentId ?? '']);
  const versions = useLive(
    () => (documentId ? repo.listVersions(documentId) : Promise.resolve([] as DocumentVersion[])),
    ['documents'],
    [documentId ?? ''],
  );
  const doc = useLive(
    () => (documentId ? repo.getDocument(documentId) : Promise.resolve(null)),
    ['documents'],
    [documentId ?? ''],
  );

  async function restoreVersion(version: number) {
    if (!documentId) return;
    if (!window.confirm(`Restore version ${version}? Its contents become a NEW version of the document.`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await repo.restoreVersion(documentId, version);
      setNotice(`Version ${version} restored - the document is now at version ${saved.version}.`);
      versions.reload();
      audit.reload();
      doc.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore that version.');
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const moved = await repo.deleteHistory();
      setConfirmClear(false);
      setNotice(`History cleared: ${moved} audit ${moved === 1 ? 'entry was' : 'entries were'} moved to the Trash. You can restore it from the Trash page.`);
      audit.reload();
      versions.reload();
    } catch (e) {
      setConfirmClear(false);
      setError(e instanceof Error ? e.message : 'Could not clear the history.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="hist-h">
      <div className="mb-4">
        <h1 id="hist-h" className="text-xl font-semibold">
          {documentId ? 'Document history' : 'Audit history'}
        </h1>
        {documentId && doc.data && (
          <p className="mt-1 text-sm text-slate-600">
            {doc.data.number} - {doc.data.customerName} - currently version {doc.data.version} (
            {doc.data.status})
            {' '}
            <Link className="font-medium text-brand-700 hover:underline" to={`/documents/${documentId}`}>Open in editor</Link>
          </p>
        )}
        {!documentId && (
          <p className="mt-1 text-sm text-slate-600">
            Every saved change across the company, newest first. Audit entries cannot be edited from the application.
          </p>
        )}
      </div>

      {isAdmin && (
        <div className="mb-3 flex gap-2">
          <button
            className="btn text-red-600"
            disabled={busy}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 size={14} aria-hidden /> Delete all history
          </button>
        </div>
      )}

      {notice && <p role="status" className="mb-3 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {error && <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {documentId && (
        <section className="mb-5 rounded border border-slate-200 bg-white p-4" aria-label="Version history">
          <h2 className="mb-2 text-sm font-semibold">Versions</h2>
          {versions.loading && !versions.data && <p className="text-sm text-slate-500">Loading versions...</p>}
          {versions.error && <p role="alert" className="text-sm text-red-700">{versions.error}</p>}
          {versions.data && versions.data.length === 0 && (
            <p className="text-sm text-slate-500">No versions recorded yet.</p>
          )}
          {versions.data && versions.data.length > 0 && (
            <ul className="divide-y divide-slate-100 text-sm">
              {versions.data.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    Version {v.version}
                    <span className="ml-2 text-xs text-slate-500">{formatAt(v.savedAt)}</span>
                    {v.snapshot.status === 'trashed' && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">trashed state</span>
                    )}
                  </span>
                  <button
                    className="btn"
                    disabled={busy || (doc.data ? v.version === doc.data.version : false)}
                    title={doc.data && v.version === doc.data.version ? 'This is already the current version' : undefined}
                    onClick={() => void restoreVersion(v.version)}
                  >
                    <RotateCcw size={14} aria-hidden /> Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Restoring never overwrites history: the old contents stay available and the restoration itself is audited.
          </p>
        </section>
      )}

      <section className="rounded border border-slate-200 bg-white p-4" aria-label="Audit entries">
        <h2 className="mb-2 text-sm font-semibold">{documentId ? 'Audit entries for this document' : 'Audit log'}</h2>
        {audit.loading && !audit.data && <p className="text-sm text-slate-500">Loading...</p>}
        {audit.error && <p role="alert" className="text-sm text-red-700">{audit.error}</p>}
        {audit.data && audit.data.length === 0 && <p className="text-sm text-slate-500">No entries.</p>}
        {audit.data && audit.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="px-2 py-2 font-medium">When</th>
                  <th className="px-2 py-2 font-medium">Who</th>
                  <th className="px-2 py-2 font-medium">Action</th>
                  <th className="px-2 py-2 font-medium">Document</th>
                  <th className="px-2 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.map((a: AuditEntry) => (
                  <tr key={a.id} className="border-b border-slate-100 last:border-0">
                    <td className="whitespace-nowrap px-2 py-2 text-slate-600">{formatAt(a.at)}</td>
                    <td className="px-2 py-2">{a.userName || 'Unknown'}</td>
                    <td className="px-2 py-2">{ACTION_LABEL[a.action] ?? a.action}</td>
                    <td className="px-2 py-2">
                      {a.documentId ? (
                        <Link className="font-medium text-brand-700 hover:underline" to={`/history/${a.documentId}`}>
                          {a.documentNumber || 'document'}
                        </Link>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-slate-600">{a.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {confirmClear && (
        <Modal
          label="Confirm clear history"
          tone="danger"
          icon={<Trash2 size={22} aria-hidden />}
          title="Delete all history?"
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmClear(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => void clearAll()} disabled={busy}>
                {busy ? 'Moving...' : 'Move all history to trash'}
              </button>
            </>
          }
        >
          All audit entries and version history will be cleared from this page and moved to the Trash. Nothing is destroyed:
          you can restore it from the Trash page, and only an administrator can delete it permanently there.
        </Modal>
      )}
    </section>
  );
}

