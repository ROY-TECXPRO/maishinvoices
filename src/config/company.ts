/**
 * Company identity and document defaults. Edit here (later: Settings screen) - no code
 * changes are needed elsewhere. Set `logoDataUrl` to a PNG/JPEG data URL to show a logo.
 */
export interface CompanyProfile {
  nameLine1: string;
  nameLine2: string;
  tagline: string;
  dealersIn: string[];
  poBox: string;
  phone: string;
  email: string;
  website: string;
  kraPin: string;
  bank: { bank: string; accountNumber: string; accountName: string };
  defaultPaymentTerms: string;
  defaultNotes: string;
  /** Marketing lines printed under the terms. Confirm every claim with the owner. */
  highlights: string[];
  logoDataUrl?: string;
  /** Unpaid invoices older than this many days are flagged overdue. Default 30. */
  overdueAfterDays?: number;
  /** Business WhatsApp number. Opened by the WhatsApp button when a document has no customer phone, and quoted in the message. */
  whatsappNumber?: string;
}

export const company: CompanyProfile = {
  nameLine1: 'MAISH MATTRESS CENTER',
  nameLine2: 'AND TEXTILE INDUSTRY',
  tagline: 'The House of Fashions',
  dealersIn: [
    "Imported clothes for Men's Ladies & Kids",
    'School Uniforms, Sports goods, Beddings',
    'Work wears, Branding & bags',
  ],
  poBox: 'P.O. Box 387 - 20500 Narok',
  phone: '+254722899178',
  whatsappNumber: '0799921036',
  email: 'maishbazaar2020@gmail.com',
  website: 'www.maishfashionboutique.co.ke',
  kraPin: 'P052226382I',
  bank: { bank: 'KCB, Narok Branch', accountNumber: '1232840742', accountName: 'Maish Bazaar Ltd' },
  defaultPaymentTerms: 'Accounts are due on demand\nPay a deposit of 75%',
  defaultNotes:
    'All invoices and deliveries are submitted and signed by relevant authorized staff of both partners.',
  highlights: [
    'High-quality Kenyan-tailored workwear',
    'Reliable timelines & customer support',
    'Custom branding & bulk discounts',
    'Trusted by 50+ local companies',
  ],
};
