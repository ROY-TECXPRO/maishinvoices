import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { company, type CompanyProfile } from '../config/company';
import type { PrintModel } from './printModel';

type RGB = [number, number, number];
const BLUE: RGB = [16, 108, 189];
const INK: RGB = [25, 25, 25];
const GREY: RGB = [90, 90, 90];

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 12;
const RIGHT = PAGE_W - MARGIN;
const BOTTOM = 20;
const CONTINUATION_TOP = 26;

function drawFirstHeader(doc: jsPDF, m: PrintModel, co: CompanyProfile): number {
  let x = MARGIN;
  if (co.logoDataUrl) {
    doc.addImage(co.logoDataUrl, 'PNG', MARGIN, 8, 22, 22);
    x = MARGIN + 25;
  }
  doc.setTextColor(...BLUE);
  doc.setFont('helvetica', 'bold').setFontSize(21).text(co.nameLine1, x, 19);
  doc.setFontSize(18).text(co.nameLine2, x, 28);
  doc.setFont('helvetica', 'normal').setFontSize(26).text(m.title, RIGHT, 28, { align: 'right' });
  doc.setFont('helvetica', 'italic').setFontSize(11).text(co.tagline, x, 36);

  doc.setFont('times', 'normal').setFontSize(9).setTextColor(30, 90, 160);
  doc.text('Dealers in:', MARGIN, 45);
  co.dealersIn.forEach((l, i) => doc.text(l, MARGIN, 49 + i * 4));

  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...INK);
  [co.poBox, `TEL: ${co.phone}`, `Email: ${co.email}`, `Website: ${co.website}`].forEach((l, i) =>
    doc.text(l, RIGHT, 45 + i * 4, { align: 'right' }),
  );
  doc.setFont('helvetica', 'bold').text(`KRA PIN: ${co.kraPin}`, RIGHT, 61, { align: 'right' });

  const labelValue = (label: string, value: string, xx: number, y: number, alignRight = false) => {
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...BLUE);
    const text = `${label}: `;
    doc.setFont('helvetica', 'normal').setTextColor(...INK);
    const vw = doc.getTextWidth(value);
    doc.setFont('helvetica', 'bold').setTextColor(...BLUE);
    const lw = doc.getTextWidth(text);
    const start = alignRight ? xx - lw - vw : xx;
    doc.text(text, start, y);
    doc.setFont('helvetica', 'normal').setTextColor(...INK).text(value, start + lw, y);
  };
  labelValue(m.numberLabel.toUpperCase(), m.number, MARGIN, 70);
  labelValue('ORDER No', m.orderNumber, RIGHT, 70, true);
  labelValue('M/S', m.customerName.toUpperCase(), MARGIN, 77);
  labelValue('Date', m.dateDisplay, RIGHT, 77, true);

  doc.setFontSize(8.5).setTextColor(...GREY);
  m.contactLines.forEach((l, i) => doc.text(l, MARGIN, 81.5 + i * 4));
  return 82 + m.contactLines.length * 4;
}

function drawContinuationHeader(doc: jsPDF, m: PrintModel, co: CompanyProfile) {
  doc.setTextColor(...BLUE).setFont('helvetica', 'bold').setFontSize(11);
  doc.text(`${co.nameLine1} ${co.nameLine2}`, MARGIN, 12);
  doc.setFont('helvetica', 'normal').text(`${m.title} ${m.number} (continued)`, RIGHT, 12, { align: 'right' });
  doc.setDrawColor(...BLUE).setLineWidth(0.3).line(MARGIN, 15, RIGHT, 15);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...INK);
  doc.text(`M/S: ${m.customerName.toUpperCase()}`, MARGIN, 21);
}

type Block = { text: string; bold?: boolean; size?: number; gap?: number };

function termsBlocks(m: PrintModel, co: CompanyProfile): Block[] {
  const b: Block[] = [{ text: 'TERMS & CONDITIONS', bold: true, size: 9.5 }];
  m.terms.forEach((t) => b.push({ text: `\u2022 ${t}` }));
  b.push({ text: 'Payment options:', bold: true, gap: 1.5 });
  b.push({ text: `\u2022 Bank: ${co.bank.bank}, Acc No: ${co.bank.accountNumber}` });
  b.push({ text: `\u2022 Account name: ${co.bank.accountName}` });
  m.notes.forEach((n, i) => b.push({ text: `\u2022 ${n}`, gap: i === 0 ? 1.5 : 0 }));
  if (co.highlights.length) {
    b.push({ text: 'Why choose us?', bold: true, gap: 3 });
    co.highlights.forEach((h) => b.push({ text: `\u2022 ${h}` }));
  }
  return b;
}

export function renderDocumentPdf(m: PrintModel, co: CompanyProfile = company): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const startY = drawFirstHeader(doc, m, co);

  const body = m.rows.map((r) =>
    r.kind === 'heading'
      ? ['', { content: r.description, styles: { fontStyle: 'bold' as const } }, '', '', '']
      : [r.qty, r.description, r.unitPrice, r.kshs, r.cts],
  );
  const foot = m.summary.map((s) => [
    { content: s.label, colSpan: 3, styles: { halign: 'right' as const, fontSize: s.strong ? 11 : 9.5 } },
    { content: s.kshs, styles: { fontSize: s.strong ? 11 : 9.5 } },
    { content: s.cts, styles: { fontSize: s.strong ? 11 : 9.5 } },
  ]);

  autoTable(doc, {
    startY,
    margin: { top: CONTINUATION_TOP, bottom: BOTTOM, left: MARGIN, right: MARGIN },
    head: [['QTY', 'PARTICULARS', 'UNIT PRICE', 'KSHS.', 'CTS.']],
    body,
    foot: foot.length ? foot : undefined,
    showHead: 'everyPage',
    showFoot: 'lastPage',
    rowPageBreak: 'avoid',
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 10, textColor: INK, lineColor: [70, 70, 70], lineWidth: 0.2, cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 }, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: [255, 255, 255], textColor: BLUE, fontStyle: 'normal', fontSize: 8, cellPadding: 1 },
    footStyles: { fillColor: [255, 255, 255], textColor: INK, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 16, halign: 'center' },
      1: { cellWidth: 96 },
      2: { cellWidth: 28, halign: 'right' },
      3: { cellWidth: 30, halign: 'right' },
      4: { cellWidth: 16, halign: 'right' },
    },
    didParseCell: (d) => {
      if (d.section === 'head') d.cell.styles.halign = d.column.index === 1 ? 'left' : d.column.index === 0 ? 'center' : 'right';
    },
    didDrawPage: (d) => {
      if (d.pageNumber > 1) drawContinuationHeader(doc, m, co);
    },
  });

  // Terms block, kept together on one page.
  const blocks = termsBlocks(m, co);
  const width = PAGE_W - MARGIN * 2;
  doc.setFontSize(9);
  const laid = blocks.map((b) => {
    doc.setFont('helvetica', b.bold ? 'bold' : 'normal').setFontSize(b.size ?? 9);
    return { ...b, lines: doc.splitTextToSize(b.text, width) as string[] };
  });
  const lineH = 4.2;
  const height = laid.reduce((h, b) => h + (b.gap ?? 0) + b.lines.length * lineH, 0);
  let y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;
  if (y + height > PAGE_H - BOTTOM) {
    doc.addPage();
    drawContinuationHeader(doc, m, co);
    y = CONTINUATION_TOP;
  }
  laid.forEach((b) => {
    y += b.gap ?? 0;
    doc.setFont('helvetica', b.bold ? 'bold' : 'normal').setFontSize(b.size ?? 9).setTextColor(...INK);
    b.lines.forEach((line) => {
      doc.text(line, MARGIN, y);
      y += lineH;
    });
  });

  // Footer on every page.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GREY);
    doc.text(`${co.nameLine1} ${co.nameLine2}  |  ${co.phone}  |  ${co.website}`, MARGIN, PAGE_H - 8);
    doc.text(`Page ${p} of ${pages}`, RIGHT, PAGE_H - 8, { align: 'right' });
  }
  return doc;
}
