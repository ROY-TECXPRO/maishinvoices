import type { DocumentType } from './types';

export const NUMBER_PREFIX: Record<DocumentType, 'QT' | 'INV'> = { quotation: 'QT', invoice: 'INV' };
export const SEQUENCE_START = 3999;

export function formatDocumentNumber(type: DocumentType, year: number, sequence: number): string {
  return `${NUMBER_PREFIX[type]}-${year}-${sequence}`;
}

export interface ParsedNumber {
  type: DocumentType;
  year: number;
  sequence: number;
}

export function parseDocumentNumber(value: string): ParsedNumber | null {
  const m = /^(QT|INV)-(\d{4})-(\d{4,})$/.exec(value.trim());
  if (!m) return null;
  return { type: m[1] === 'QT' ? 'quotation' : 'invoice', year: Number(m[2]), sequence: Number(m[3]) };
}

export function yearOfIsoDate(iso: string): number {
  return Number(iso.slice(0, 4));
}

/** Returns an error message, or null when the number is well-formed and matches the type. */
export function validateNumberFormat(type: DocumentType, value: string): string | null {
  const parsed = parseDocumentNumber(value);
  if (!parsed) return `Document number must look like ${formatDocumentNumber(type, 2026, SEQUENCE_START)}.`;
  if (parsed.type !== type) return `A ${type} number must start with ${NUMBER_PREFIX[type]}-.`;
  return null;
}
