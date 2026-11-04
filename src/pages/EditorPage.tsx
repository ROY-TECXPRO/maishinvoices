import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { DocumentEditor } from '../components/DocumentEditor';
import { useRepository } from '../data/RepositoryContext';
import type { DocumentRecord, DocumentType } from '../domain/types';

export function EditorPage() {
  const repo = useRepository();
  const { id } = useParams();
  const [params] = useSearchParams();
  const [record, setRecord] = useState<DocumentRecord | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>(id ? 'loading' : 'ready');

  useEffect(() => {
    if (!id) { setRecord(null); setState('ready'); return; }
    setState('loading');
    repo.getDocument(id).then(
      (r) => { setRecord(r); setState(r ? 'ready' : 'missing'); },
      () => setState('error'),
    );
  }, [repo, id]);

  if (state === 'loading') return <p className="text-sm text-slate-500">Loading document...</p>;
  if (state === 'missing') return <p role="alert" className="text-sm text-red-700">This document does not exist.</p>;
  if (state === 'error') return <p role="alert" className="text-sm text-red-700">The document could not be loaded. Check your connection and try again.</p>;

  const type: DocumentType = params.get('type') === 'invoice' ? 'invoice' : 'quotation';
  // key forces a fresh editor when switching between "new quotation" and "new invoice".
  return <DocumentEditor key={id ?? `new-${type}`} record={record} initialType={type} />;
}
