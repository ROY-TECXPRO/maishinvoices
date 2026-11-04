/** Minimal RFC-4180 CSV building and download helpers (no dependencies). */

function escapeCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((c) => escapeCell(c ?? '')).join(',')).join('\r\n');
}

export function csvFileName(base: string): string {
  const safe = base.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${safe}.csv`;
}

/** Triggers a browser download of UTF-8 CSV text with a BOM so Excel opens it correctly. */
export function downloadCsv(fileName: string, rows: (string | number | null | undefined)[][]): void {
  const blob = new Blob(['\uFEFF', toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(fileName, blob);
}

export function downloadJson(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(fileName, blob);
}

export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
