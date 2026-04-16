/**
 * Swiss QR-bill data generator.
 *
 * Generates the SPC (Swiss Payment Code) payload per SIX specification v2.2.
 * Used to encode structured payment data in the QR code on Swiss invoices.
 *
 * Since SRAtix payments are already processed via Stripe, the QR-bill
 * serves as an informational payment receipt (no actual bank transfer expected).
 */

export interface QrBillData {
  /** Creditor IBAN (CH/LI format) */
  iban: string;
  /** Creditor name */
  creditorName: string;
  creditorStreet?: string;
  creditorCity: string;
  creditorPostal: string;
  creditorCountry: string; // 2-letter ISO
  /** Amount in major units (e.g. 42.50) */
  amount: number;
  currency: 'CHF' | 'EUR';
  /** Debtor (buyer) info */
  debtorName?: string;
  debtorStreet?: string;
  debtorCity?: string;
  debtorPostal?: string;
  debtorCountry?: string; // 2-letter ISO
  /** Unstructured reference message */
  message?: string;
}

/**
 * Build the SPC (Swiss Payment Code) string for a QR-bill.
 *
 * Format per SIX spec: fixed-width fields separated by newlines.
 * Reference: https://www.paymentstandards.ch/dam/downloads/ig-qr-bill-en.pdf
 */
export function buildSpcPayload(data: QrBillData): string {
  const lines: string[] = [
    'SPC',                              // QR type
    '0200',                             // Version
    '1',                                // Coding (UTF-8)
    formatIban(data.iban),              // IBAN
    'S',                                // Address type (S = structured)
    truncate(data.creditorName, 70),    // Creditor name
    truncate(data.creditorStreet || '', 70),
    '',                                 // Building number (combined in street)
    truncate(data.creditorPostal, 16),
    truncate(data.creditorCity, 35),
    data.creditorCountry.toUpperCase().substring(0, 2),
    '',                                 // Ultimate creditor (not used)
    '',
    '',
    '',
    '',
    '',
    data.amount > 0 ? data.amount.toFixed(2) : '',
    data.currency,
    // Debtor
    data.debtorName ? 'S' : '',
    truncate(data.debtorName || '', 70),
    truncate(data.debtorStreet || '', 70),
    '',                                 // Building number
    truncate(data.debtorPostal || '', 16),
    truncate(data.debtorCity || '', 35),
    data.debtorCountry ? data.debtorCountry.toUpperCase().substring(0, 2) : '',
    'NON',                              // Reference type (NON = no reference)
    '',                                 // Reference
    truncate(data.message || '', 140),  // Unstructured message
    'EPD',                              // Trailer
  ];

  return lines.join('\n');
}

function formatIban(iban: string): string {
  return iban.replace(/\s/g, '').toUpperCase();
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max) : str;
}
