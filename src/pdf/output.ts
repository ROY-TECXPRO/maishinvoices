import type { jsPDF } from 'jspdf';
import type { PrintModel } from './printModel';

export function pdfFileName(m: PrintModel): string {
  const safe = m.customerName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return `${m.number}${safe ? `_${safe}` : ''}.pdf`;
}

export function downloadPdf(doc: jsPDF, m: PrintModel) {
  doc.save(pdfFileName(m));
}

/** Prints the exact PDF that would be downloaded, so print and download always match. */
export function printPdf(doc: jsPDF) {
  const url = URL.createObjectURL(doc.output('blob'));
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank');
    }
  };
  document.body.appendChild(frame);
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 120_000);
}
