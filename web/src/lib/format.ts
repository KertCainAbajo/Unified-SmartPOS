/**
 * Display helpers. Money arrives from the API as decimal strings ("1234.50"); they are formatted
 * as strings, never converted through floating point.
 */

export function formatMoney(input: string | number | null | undefined, currencySymbol = '₱'): string {
  if (input === null || input === undefined || input === '') return '—';
  const value = typeof input === 'number' ? input.toFixed(2) : input;
  const negative = value.startsWith('-');
  const [intPart, fracPart = ''] = value.replace('-', '').split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = (fracPart + '00').slice(0, 2);
  return `${negative ? '-' : ''}${currencySymbol}${grouped}.${cents}`;
}

/** Trim trailing zeros from a 3-decimal quantity: "2.000" → "2", "1.250" → "1.25". */
export function formatQty(input: string | number | null | undefined): string {
  if (input === null || input === undefined || input === '') return '—';
  const value = String(input);
  if (!value.includes('.')) return value;
  return value.replace(/\.?0+$/, '');
}

/** Parse a decimal string into integer centavos (display/preview math only). */
export function toCents(value: string): number {
  const clean = value.trim();
  if (!/^-?\d*(\.\d*)?$/.test(clean) || clean === '' || clean === '.') return NaN;
  const negative = clean.startsWith('-');
  const [i = '0', f = ''] = clean.replace('-', '').split('.');
  const cents = Number(i || '0') * 100 + Number((f + '00').slice(0, 2));
  return negative ? -cents : cents;
}

export function fromCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const dateTime = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
const dateOnly = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' });

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : '—';
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  // Plain dates (YYYY-MM-DD) are business dates; render without shifting the day.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? dateOnly.format(new Date(`${value}T00:00:00+08:00`)) : dateOnly.format(new Date(value));
}

/** Today's date (YYYY-MM-DD) in Manila time. */
export function todayManila(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
}

export function firstOfMonthManila(): string {
  return `${todayManila().slice(0, 8)}01`;
}

export function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
