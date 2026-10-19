import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronRight, Crown } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { Button, EmptyState, ErrorBanner, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { titleCase } from '../../lib/format';
import type { Membership } from '../../lib/types';
import { AuthLayout } from './AuthLayout';

/**
 * Lists the businesses the user belongs to. With exactly one, goes straight to it, except for platform administrators,
 * who also get the super admin console here.
 */
export function SelectBusinessPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const memberships = useQuery({
    queryKey: ['memberships'],
    queryFn: () => api<{ data: Membership[] }>('/me/memberships'),
  });

  if (memberships.isPending) return <Spinner />;
  // Pending invitations grant no access until accepted, so only active memberships are listed here.
  const list = (memberships.data?.data ?? []).filter((m) => m.status === 'active');
  if (list.length === 1 && !user?.is_platform_admin) return <Navigate to={`/t/${list[0].tenant_id}`} replace />;
  if (list.length === 0 && user?.is_platform_admin) return <Navigate to="/platform" replace />;

  return (
    <AuthLayout title={`Welcome, ${user?.name ?? ''}`} subtitle="Choose a business to continue.">
      <ErrorBanner error={memberships.error} />
      {user?.is_platform_admin && list.length > 0 && (
        <button onClick={() => navigate('/platform')}
          className="mb-3 flex w-full items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-left transition hover:border-amber-400 hover:bg-amber-50">
          <Crown className="size-5 text-amber-600" />
          <span className="flex-1">
            <span className="block font-medium text-slate-900">Super admin console</span>
            <span className="block text-xs text-slate-500">Manage every business, accounts and platform admins</span>
          </span>
          <ChevronRight className="size-4 text-slate-400" />
        </button>
      )}
      {list.length === 0 ? (
        <EmptyState
          title="You are not a member of any business"
          description={
            user?.is_platform_admin
              ? 'Platform administrators manage businesses through the platform API and have no access to business data.'
              : 'Ask a business owner to add you, or sign out and register a new business.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {list.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => navigate(`/t/${m.tenant_id}`)}
                className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left hover:border-teal-600 hover:bg-teal-50/40"
              >
                <Building2 className="size-5 text-slate-400" />
                <span className="flex-1">
                  <span className="block font-medium text-slate-900">{m.tenant?.name}</span>
                  <span className="block text-xs text-slate-500">{m.roles?.map((r) => titleCase(r.key)).join(', ')}</span>
                </span>
                <ChevronRight className="size-4 text-slate-400" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="ghost"
        className="mt-6 w-full"
        onClick={async () => {
          await logout();
          navigate('/login');
        }}
      >
        Sign out
      </Button>
    </AuthLayout>
  );
}
