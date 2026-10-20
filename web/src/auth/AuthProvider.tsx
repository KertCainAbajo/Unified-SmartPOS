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

/** Sign-in from a browser this email account has not confirmed: a 6-digit code was emailed. */
export interface LoginChallenge {
  challenge: string;
  email_hint: string;
  expires_in_minutes: number;
  resend_after_seconds: number;
}

interface AuthValue {
  user: User | null;
  loading: boolean;
  /** Resolves with a challenge when an emailed code is still needed; otherwise the user is signed in. */
  login: (credentials: LoginCredentials) => Promise<LoginChallenge | null>;
  verifyLoginCode: (challenge: string, code: string, trustDevice: boolean) => Promise<void>;
  resendLoginCode: (challenge: string) => Promise<number>;
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
      const result = await api<Partial<LoginChallenge> & { two_factor_required?: boolean }>('/auth/login', { method: 'POST', body: credentials });
      if (result?.two_factor_required) return result as LoginChallenge;
      resetUserData(queryClient);
      await me.refetch();
      return null;
    },
    [queryClient, me],
  );

  const verifyLoginCode = useCallback(
    async (challenge: string, code: string, trustDevice: boolean) => {
      await api('/auth/login/verify', { method: 'POST', body: { challenge, code, trust_device: trustDevice } });
      resetUserData(queryClient);
      await me.refetch();
    },
    [queryClient, me],
  );

  const resendLoginCode = useCallback(
    async (challenge: string) => (await api<{ resend_after_seconds: number }>('/auth/login/resend', { method: 'POST', body: { challenge } })).resend_after_seconds,
    [],
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
    () => ({ user: me.data ?? null, loading: me.isPending, login, verifyLoginCode, resendLoginCode, register, logout, refresh: me.refetch }),
    [me.data, me.isPending, me.refetch, login, verifyLoginCode, resendLoginCode, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
