import { describe, expect, it } from 'vitest';
import { formatMoney, formatQty, fromCents, toCents } from '../format';

describe('formatMoney', () => {
  it('formats decimal strings without floating point', () => {
    expect(formatMoney('1234567.5')).toBe('₱1,234,567.50');
    expect(formatMoney('0.1')).toBe('₱0.10');
    expect(formatMoney('-65.00')).toBe('-₱65.00');
    expect(formatMoney(null)).toBe('—');
  });
});

describe('formatQty', () => {
  it('trims trailing zeros', () => {
    expect(formatQty('2.000')).toBe('2');
    expect(formatQty('1.250')).toBe('1.25');
    expect(formatQty('10')).toBe('10');
  });
});

describe('cents helpers', () => {
  it('round-trips amounts exactly', () => {
    expect(toCents('130.00')).toBe(13000);
    expect(toCents('0.1') + toCents('0.2')).toBe(30);
    expect(fromCents(toCents('200') - toCents('130.00'))).toBe('70.00');
    expect(fromCents(-5)).toBe('-0.05');
  });

  it('rejects malformed input', () => {
    expect(Number.isNaN(toCents('abc'))).toBe(true);
    expect(Number.isNaN(toCents(''))).toBe(true);
  });
});
