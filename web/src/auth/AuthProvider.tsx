import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import type { User } from '../lib/types';

interface RegisterInput {
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
  business: { name: string; tin?: string; vat_registered?: boolean; branch_name?: string; address?: string };
}

/** Owners sign in with email; company-managed staff with business code + username. */
export type LoginCredentials = { email: string; password: string } | { business_code: string; username: string; password: string; branch_id?: number };

interface AuthValue {
  user: User | null;
  loading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (input: RegisterInput) => Promise<{ tenantId: number }>;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Drop everything cached for the previous user. The ['me'] query is kept and updated in place instead: clearing it
 * would detach this provider's observer, leaving the old user on screen after sign-out.
 */
function resetUserData(queryClient: QueryClient) {
  void queryClient.cancelQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
}

/** Session (cookie) authentication via Laravel Sanctum. The current user comes from GET /me. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api<{ data: User }>('/me')).data;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const login = useCallback(
    async (credentials: LoginCredentials) => {
      // No device_name: the backend starts a session instead of issuing a token.
      await api('/auth/login', { method: 'POST', body: credentials });
      resetUserData(queryClient);
      await me.refetch();
    },
    [queryClient, me],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const result = await api<{ tenant: { id: number } }>('/auth/register', { method: 'POST', body: input });
      resetUserData(queryClient);
      await me.refetch();
      return { tenantId: result.tenant.id };
    },
    [queryClient, me],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      queryClient.setQueryData(['me'], null);
      resetUserData(queryClient);
    }
  }, [queryClient]);

  const value = useMemo<AuthValue>(
    () => ({ user: me.data ?? null, loading: me.isPending, login, register, logout, refresh: me.refetch }),
    [me.data, me.isPending, me.refetch, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
