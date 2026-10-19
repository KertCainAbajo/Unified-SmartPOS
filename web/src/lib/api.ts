/**
 * Minimal API client for the Laravel backend using Sanctum SPA (cookie) authentication.
 *
 * - Requests go to same-origin `/api/v1/...` (proxied to Laravel in development).
 * - Before the first state-changing request, `/sanctum/csrf-cookie` sets the XSRF-TOKEN cookie,
 *   which is echoed back in the `X-XSRF-TOKEN` header.
 * - Errors are thrown as ApiError carrying the HTTP status, Laravel validation errors and the
 *   backend's machine-readable business-rule `code`.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly errors: Record<string, string[]>;

  constructor(status: number, message: string, code?: string, errors: Record<string, string[]> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }

  /** First validation message for a field, if any. */
  field(name: string): string | undefined {
    return this.errors[name]?.[0];
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  headers?: Record<string, string>;
}

const BASE = '/api/v1';

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

async function ensureCsrfCookie(force = false): Promise<void> {
  if (!force && readCookie('XSRF-TOKEN')) return;
  await fetch('/sanctum/csrf-cookie', { credentials: 'include', headers: { Accept: 'application/json' } });
}

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...options.headers,
  };
  // FormData (file uploads) sets its own multipart boundary header.
  const isForm = options.body instanceof FormData;
  if (options.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  const xsrf = readCookie('XSRF-TOKEN');
  if (xsrf) headers['X-XSRF-TOKEN'] = xsrf;

  return fetch(`${BASE}${path}${buildQuery(options.query)}`, {
    method,
    credentials: 'include',
    headers,
    body: options.body === undefined ? undefined : isForm ? (options.body as FormData) : JSON.stringify(options.body),
  });
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const mutating = (options.method ?? 'GET') !== 'GET';
  if (mutating) await ensureCsrfCookie();

  let response = await send(path, options);

  // 419 = CSRF token expired (e.g. session rotated). Refresh the cookie and retry once.
  if (response.status === 419 && mutating) {
    await ensureCsrfCookie(true);
    response = await send(path, options);
  }

  if (response.status === 204) return undefined as T;

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (data && typeof data.message === 'string' && data.message) ||
      (response.status === 0 ? 'Network error' : `Request failed (${response.status})`);
    throw new ApiError(response.status, message, data?.code, data?.errors ?? {});
  }
  // A "successful" answer that is not data (an HTML error page, or the server still starting) is treated as a
  // temporary failure, so screens show their "try again" message instead of crashing on missing data.
  if (data === null) {
    throw new ApiError(503, 'The store server did not answer properly. Please try again in a moment.', 'BAD_RESPONSE');
  }

  return data as T;
}

/** Download a protected file (session cookie) and save it with the given name. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const response = await fetch(`${BASE}${path}`, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.message ?? `Download failed (${response.status})`, data?.code);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Human-friendly message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return error.message === 'This action is unauthorized.' ? 'You do not have permission to do this.' : error.message;
    if (error.status === 429) return 'Too many requests. Please wait a moment and try again.';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
