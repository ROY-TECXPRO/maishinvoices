/** All money is held as integer cents (1 KSh = 100 cents). Never use floats for currency. */
export type Cents = number;

const pad2 = (n: number) => String(n).padStart(2, '0');

export function groupThousands(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function splitCents(cents: Cents) {
  const abs = Math.abs(cents);
  return { negative: cents < 0, kshs: Math.floor(abs / 100), cts: abs % 100 };
}

/** "KSh 12,000.00" */
export function formatMoney(cents: Cents): string {
  const { negative, kshs, cts } = splitCents(cents);
  return `${negative ? '-' : ''}KSh ${groupThousands(kshs)}.${pad2(cts)}`;
}

/** KSHS. column, e.g. "30,000" */
export function formatKshsColumn(cents: Cents): string {
  const { negative, kshs } = splitCents(cents);
  return `${negative ? '-' : ''}${groupThousands(kshs)}`;
}

/** CTS. column, e.g. ".00" */
export function formatCtsColumn(cents: Cents): string {
  return `.${pad2(splitCents(cents).cts)}`;
}

/** Unit price: "1,200" or "1,200.50" */
export function formatUnitPrice(cents: Cents): string {
  const { kshs, cts } = splitCents(cents);
  return cts === 0 ? groupThousands(kshs) : `${groupThousands(kshs)}.${pad2(cts)}`;
}

export function formatQuantity(q: number): string {
  return String(Number(q.toFixed(3)));
}

/** Parses "1,200", "1200.5", "KSh 1,200.50" into cents. Returns null if invalid. */
export function parseMoneyToCents(input: string): Cents | null {
  const s = input.replace(/ksh/i, '').replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return parseInt(whole, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
}

/** Positive quantity with up to 3 decimal places. Returns null if invalid or <= 0. */
export function parseQuantity(input: string): number | null {
  const s = input.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** "16" or "16.5" -> basis points (1600, 1650). 0..100% only. */
export function parsePercentToBasisPoints(input: string): number | null {
  const s = input.replace(/[%\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const bp = Math.round(Number(s) * 100);
  return bp >= 0 && bp <= 10000 ? bp : null;
}

export function centsToInput(cents: Cents): string {
  const { kshs, cts } = splitCents(cents);
  return cts === 0 ? String(kshs) : `${kshs}.${pad2(cts)}`;
}
