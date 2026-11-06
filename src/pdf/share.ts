import type { jsPDF } from 'jspdf';
import { whatsappLink } from '../domain/payments';
import { downloadPdf, pdfFileName } from './output';
import type { PrintModel } from './printModel';

const BUSINESS_WHATSAPP = '0799921036';

/**
 * Sends the saved document's PDF on WhatsApp. On phones the PDF is attached directly through the
 * share sheet. On a computer the PDF is downloaded and WhatsApp opens to the business number
 * so the user can choose the recipient.
 */
export async function shareOnWhatsApp(doc: jsPDF, m: PrintModel, _rawPhone: string, text: string): Promise<'shared' | 'download'> {
  const file = new File([doc.output('blob')], pdfFileName(m), { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: m.number, text });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'shared';
    }
  }
  downloadPdf(doc, m);
  window.open(whatsappLink(BUSINESS_WHATSAPP, text), '_blank', 'noopener,noreferrer');
  return 'download';
}
