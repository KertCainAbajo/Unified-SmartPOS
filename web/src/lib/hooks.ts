import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import { useTenant } from '../tenant/TenantProvider';
import { api, errorMessage } from './api';

type Query = Record<string, string | number | boolean | null | undefined>;

/** GET a tenant-scoped endpoint. The path is relative to /tenants/{tenant}. */
export function useTenantQuery<T>(relativePath: string, query?: Query, options: { enabled?: boolean } = {}) {
  const { tenantId, path } = useTenant();
  return useQuery({
    queryKey: ['t', tenantId, relativePath, query ?? {}],
    queryFn: () => api<T>(path(relativePath), { query }),
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

interface MutationOptions<TResult> {
  /** Toast shown on success. */
  success?: string | ((result: TResult) => string);
  onSuccess?: (result: TResult) => void;
  /** Show the error as a toast (default) or let the caller render it. */
  toastErrors?: boolean;
}

/**
 * Mutate a tenant-scoped endpoint, then invalidate all cached tenant data so lists, stock and
 * reports refresh automatically.
 */
export function useTenantMutation<TBody, TResult = unknown>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  relativePath: string | ((body: TBody) => string),
  options: MutationOptions<TResult> = {},
) {
  const { tenantId, path } = useTenant();
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (body: TBody) => {
      const rel = typeof relativePath === 'function' ? relativePath(body) : relativePath;
      return api<TResult>(path(rel), { method, body: method === 'DELETE' ? undefined : body });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['t', tenantId] });
      if (options.success) toast.success(typeof options.success === 'function' ? options.success(result) : options.success);
      options.onSuccess?.(result);
    },
    onError: (error) => {
      if (options.toastErrors !== false) toast.error(errorMessage(error));
    },
  });
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
