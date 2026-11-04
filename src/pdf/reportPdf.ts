import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { company, type CompanyProfile } from '../config/company';

export interface ReportColumn {
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: number;
}

export interface ReportTable {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: (string | number)[][];
  /** Pre-formatted money strings appended as a totals block. */
  totals: { label: string; value: string }[];
}

/**
 * Renders a management report (daily/monthly/annual/customer/register) as a
 * printable A4 PDF using the same company letterhead conventions as documents.
 */
export function renderReportPdf(table: ReportTable, co: CompanyProfile = company): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const BLUE: [number, number, number] = [16, 108, 189];
  const INK: [number, number, number] = [25, 25, 25];

  doc.setTextColor(...BLUE).setFont('helvetica', 'bold').setFontSize(16);
  doc.text(`${co.nameLine1} ${co.nameLine2}`.trim(), 12, 16);
  doc.setFontSize(13).setTextColor(...INK);
  doc.text(table.title, 12, 24);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90, 90, 90);
  doc.text(`Generated ${new Date().toLocaleString('en-GB')} - ${co.phone}`, 12, 30);
  if (table.subtitle) doc.text(table.subtitle, 12, 35);

  autoTable(doc, {
    startY: table.subtitle ? 40 : 36,
    margin: { top: 14, bottom: 20, left: 12, right: 12 },
    head: [table.columns.map((c) => c.header)],
    body: table.rows.map((r) => r.map((c) => String(c))),
    showHead: 'everyPage',
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, textColor: INK, lineColor: [70, 70, 70], lineWidth: 0.15, cellPadding: 1.6 },
    headStyles: { fillColor: [255, 255, 255], textColor: BLUE, fontStyle: 'bold', fontSize: 8.5 },
    columnStyles: Object.fromEntries(
      table.columns.map((c, i) => [i, { halign: c.align ?? 'left', cellWidth: c.width ?? 'auto' }]),
    ),
    didParseCell: (d) => {
      if (d.section === 'head') d.cell.styles.halign = table.columns[d.column.index]?.align ?? 'left';
    },
  });

  let y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  const pageH = 297;
  if (y > pageH - 30) {
    doc.addPage();
    y = 20;
  }
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK);
  for (const t of table.totals) {
    doc.text(`${t.label}: ${t.value}`, 12, y);
    y += 5.5;
  }
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(90, 90, 90);
  doc.text('Invoiced totals are issued invoice amounts, not payments received.', 12, y + 2);

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(90, 90, 90);
    doc.text(`${co.nameLine1} ${co.nameLine2}  |  ${co.phone}  |  ${co.website}`, 12, 289);
    doc.text(`Page ${p} of ${pages}`, 198, 289, { align: 'right' });
  }
  return doc;
}

export function reportPdfFileName(title: string): string {
  const safe = title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${safe}.pdf`;
}
