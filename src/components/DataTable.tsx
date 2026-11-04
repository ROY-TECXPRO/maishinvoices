import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { formatMoney } from '../domain/money';

export interface Column<T> {
  key: string;
  label: string;
  /** Drives alignment, formatting and totals. */
  kind?: 'text' | 'count' | 'money';
  /** The value used for sorting, searching and totals. */
  get: (row: T) => string | number;
  render?: (row: T) => ReactNode;
  muted?: boolean;
  /** Draws a share-of-maximum bar behind the value. */
  bar?: boolean;
  /** Footer total over the filtered rows (null = no total for this column). */
  total?: (rows: T[]) => number | null;
}

const PAGE_SIZES = [10, 25, 50, 100];

/** Sortable, searchable, paged table with a totals row. Used by the Reports page. */
export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  emptyText = 'Nothing to show.',
  totalLabel = 'Total',
}: {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyText?: string;
  totalLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => columns.some((c) => String(c.get(r)).toLowerCase().includes(q)));
  }, [rows, columns, query]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const x = col.get(a);
      const y = col.get(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
    });
  }, [filtered, columns, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => { if (page > pages - 1) setPage(pages - 1); }, [page, pages]);
  useEffect(() => { setPage(0); }, [query, sort, pageSize, rows.length]);
  const visible = sorted.slice(page * pageSize, page * pageSize + pageSize);
  const from = sorted.length === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(sorted.length, (page + 1) * pageSize);

  const maxima = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of columns) if (c.bar) m[c.key] = Math.max(0, ...sorted.map((r) => Number(c.get(r)) || 0));
    return m;
  }, [columns, sorted]);

  const hasTotals = columns.some((c) => c.total);
  const toggleSort = (key: string) =>
    setSort((s) => (!s || s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));
  const fmt = (c: Column<T>, v: number) => (c.kind === 'money' ? formatMoney(v) : String(v));

  return (
    <div className="data-table" aria-label={label}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-3 text-slate-400" aria-hidden />
          <input
            className="field pl-8"
            placeholder="Search this report"
            aria-label="Search report rows"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="dt-count">{filtered.length === rows.length ? `${rows.length} rows` : `${filtered.length} of ${rows.length} rows`}</span>
          <label className="flex items-center gap-1">
            Rows per page
            <select className="field w-auto py-1" aria-label="Rows per page" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="dt-scroll overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="dt-head">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={`px-3 py-2 font-medium ${c.kind === 'text' || !c.kind ? '' : 'text-right'}`}
                  >
                    <button type="button" className="dt-sort" onClick={() => toggleSort(c.key)} aria-label={`Sort by ${c.label}`}>
                      {c.label}
                      {active ? (sort!.dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />) : <ArrowUpDown size={12} className="opacity-40" aria-hidden />}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={columns.length}>{rows.length === 0 ? emptyText : 'No rows match your search.'}</td></tr>
            )}
            {visible.map((r) => (
              <tr key={rowKey(r)} className="dt-row border-b border-slate-100 last:border-0">
                {columns.map((c) => {
                  const num = c.kind === 'count' || c.kind === 'money';
                  const v = c.get(r);
                  const pct = c.bar && maxima[c.key] > 0 ? Math.round((Number(v) / maxima[c.key]) * 100) : 0;
                  return (
                    <td key={c.key} className={`relative px-3 py-2 ${num ? 'text-right tabular-nums' : ''} ${c.muted ? 'text-slate-500' : ''}`}>
                      {c.bar && <span className="dt-bar" style={{ width: `${pct}%` }} aria-hidden />}
                      <span className="relative">{c.render ? c.render(r) : num ? fmt(c, Number(v)) : String(v)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {hasTotals && sorted.length > 0 && (
            <tfoot className="dt-foot">
              <tr>
                {columns.map((c, i) => {
                  const t = c.total ? c.total(sorted) : null;
                  const num = c.kind === 'count' || c.kind === 'money';
                  return (
                    <td key={c.key} className={`px-3 py-2 font-semibold ${num ? 'text-right tabular-nums' : ''}`}>
                      {i === 0 ? totalLabel : t === null ? '' : fmt(c, t)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>Showing {from}-{to} of {sorted.length}</span>
        <div className="flex items-center gap-1">
          <button type="button" className="icon-btn" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft size={16} /></button>
          <span aria-live="polite">Page {page + 1} of {pages}</span>
          <button type="button" className="icon-btn" aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}><ChevronRight size={16} /></button>
        </div>
      </div>
    </div>
  );
}
