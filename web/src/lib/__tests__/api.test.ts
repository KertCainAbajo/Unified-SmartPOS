import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, buildQuery } from '../api';

afterEach(() => {
  vi.restoreAllMocks();
  document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('buildQuery', () => {
  it('drops empty values and encodes booleans', () => {
    expect(buildQuery({ q: 'coke', page: 2, empty: '', none: undefined, flag: true })).toBe('?q=coke&page=2&flag=1');
  });
});

describe('api', () => {
  it('fetches the CSRF cookie before a mutation and sends the XSRF header', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === '/sanctum/csrf-cookie') {
        document.cookie = 'XSRF-TOKEN=abc%3D';
        return new Response(null, { status: 204 });
      }
      return jsonResponse(200, { ok: true });
    }));

    await api('/auth/login', { method: 'POST', body: { email: 'a@b.c' } });

    expect(calls[0].url).toBe('/sanctum/csrf-cookie');
    expect(calls[1].url).toBe('/api/v1/auth/login');
    expect((calls[1].init?.headers as Record<string, string>)['X-XSRF-TOKEN']).toBe('abc=');
    expect(calls[1].init?.credentials).toBe('include');
  });

  it('throws ApiError with validation errors and business-rule codes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(422, { message: 'Insufficient stock', code: 'INSUFFICIENT_STOCK', errors: { 'items.0.quantity': ['Too many'] } })));

    const error = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.field('items.0.quantity')).toBe('Too many');
  });

  it('retries once after a CSRF mismatch (419)', async () => {
    document.cookie = 'XSRF-TOKEN=old';
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/sanctum/csrf-cookie') return new Response(null, { status: 204 });
      attempts++;
      return attempts === 1 ? jsonResponse(419, { message: 'CSRF token mismatch.' }) : jsonResponse(201, { id: 1 });
    }));

    await expect(api('/sales', { method: 'POST', body: {} })).resolves.toEqual({ id: 1 });
    expect(attempts).toBe(2);
  });
});
