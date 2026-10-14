import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDeviceBusiness, getRecentBusinesses, setDeviceBusiness } from '../device';

// A plain in-memory Storage, independent of the test environment's localStorage implementation.
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('device business', () => {
  it('remembers the current store and keeps every used store in the recent list', () => {
    setDeviceBusiness({ code: 'aling-nena-mini-mart', name: 'aling-nena-mini-mart' });
    setDeviceBusiness({ code: 'other-store', name: 'Other Store' });
    setDeviceBusiness({ code: 'aling-nena-mini-mart', name: 'Aling Nena Mini Mart' });

    expect(getDeviceBusiness()).toEqual({ code: 'aling-nena-mini-mart', name: 'Aling Nena Mini Mart' });
    // Most recent first, no duplicates, real name replaces the placeholder.
    expect(getRecentBusinesses()).toEqual([
      { code: 'aling-nena-mini-mart', name: 'Aling Nena Mini Mart' },
      { code: 'other-store', name: 'Other Store' },
    ]);
  });

  it('forgetting the current store keeps the recent list, so the store can be chosen again', () => {
    setDeviceBusiness({ code: 'aling-nena-mini-mart', name: 'Aling Nena Mini Mart' });
    setDeviceBusiness(null);

    expect(getDeviceBusiness()).toBeNull();
    expect(getRecentBusinesses()).toHaveLength(1);
  });

  it('ignores corrupted storage', () => {
    localStorage.setItem('smartpos.recentBusinesses', '{not json');
    localStorage.setItem('smartpos.deviceBusiness', '"just a string"');

    expect(getRecentBusinesses()).toEqual([]);
    expect(getDeviceBusiness()).toBeNull();
  });
});
