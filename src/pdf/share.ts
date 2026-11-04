import type { jsPDF } from 'jspdf';
import { whatsappLink, whatsappPhone } from '../domain/payments';
import { downloadPdf, pdfFileName } from './output';
import type { PrintModel } from './printModel';

/**
 * Sends the saved document's PDF on WhatsApp. On phones the PDF is attached directly through the
 * share sheet. On a computer the PDF is downloaded and WhatsApp opens to the customer's chat with
 * the message ready: attach the downloaded file there.
 */
export async function shareOnWhatsApp(doc: jsPDF, m: PrintModel, rawPhone: string, text: string): Promise<'shared' | 'download'> {
  const file = new File([doc.output('blob')], pdfFileName(m), { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: m.number, text });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'shared'; // the person closed the share sheet
    }
  }
  downloadPdf(doc, m);
  window.open(whatsappLink(whatsappPhone(rawPhone), text), '_blank', 'noopener,noreferrer');
  return 'download';
}
