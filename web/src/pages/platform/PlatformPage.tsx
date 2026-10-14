import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CircleCheck, CirclePause, LogOut, Search, ShieldCheck, Store, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { BrandLogo } from '../../components/BrandLogo';
import { useToast } from '../../components/Toast';
import { Badge, Button, DataTable, ErrorBanner, Field, Modal, Pagination, Select, Textarea } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import type { Paginated } from '../../lib/types';

interface PlatformTenant {
  id: number;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  owner: { name: string; email: string | null } | null;
  branches_count: number;
  members_count: number;
  created_at: string;
}

type PlatformList = Paginated<PlatformTenant> & { summary: { total: number; active: number; suspended: number } };

/**
 * Platform Super Admin console: the directory of businesses on this system and their account status.
 * By design it shows no sales, payments, customers or other business data (the API does not expose them).
 */
export function PlatformPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [changing, setChanging] = useState<PlatformTenant | null>(null);
  const list = useQuery({
    queryKey: ['platform-tenants', page, status, q],
    queryFn: () => api<PlatformList>('/platform/tenants', { query: { page, status, q } }),
    placeholderData: keepPreviousData,
    enabled: !!user?.is_platform_admin,
  });

  if (!user?.is_platform_admin) return <Navigate to="/" replace />;
  const summary = list.data?.summary;

  return (
    <div className="min-h-full bg-gradient-to-br from-cream/60 via-slate-50 to-brand-50/60">
      <header className="sticky top-0 z-10 border-b border-brand-900/10 bg-brand-900 text-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <div className="w-11 rounded-lg bg-cream p-1"><BrandLogo /></div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-bold leading-tight">Unified SmartPOS</p>
            <p className="flex items-center gap-1.5 text-xs text-brand-100/80"><ShieldCheck className="size-3.5 text-sun-300" /> Platform administration</p>
          </div>
          <span className="hidden text-sm text-brand-100 sm:inline">{user.name}</span>
          <button
            type="button"
            onClick={async () => { await logout(); navigate('/login'); }}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-brand-50 ring-1 ring-white/20 hover:bg-white/10"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-brand-900 sm:text-3xl">Businesses</h1>
          <p className="mt-1 text-sm text-slate-500">Every business on this system and its account status. Business data such as sales and customers stays private to each business.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Stat icon={<Building2 />} label="All businesses" value={summary?.total} tone="brand" />
          <Stat icon={<CircleCheck />} label="Active" value={summary?.active} tone="green" />
          <Stat icon={<CirclePause />} label="Suspended" value={summary?.suspended} tone="amber" />
        </div>

        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                placeholder="Search name or business code"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                aria-label="Search businesses"
              />
            </div>
            <Select className="h-10 sm:w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </Select>
          </div>
          <DataTable
            rows={list.data?.data}
            loading={list.isPending}
            error={list.error}
            rowKey={(t) => t.id}
            empty="No businesses match."
            columns={[
              {
                header: 'Business',
                cell: (t) => (
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Store className="size-4" /></span>
                    <span><span className="block font-semibold text-slate-900">{t.name}</span><code className="text-xs text-slate-500">{t.slug}</code></span>
                  </div>
                ),
              },
              { header: 'Owner', cell: (t) => (t.owner ? <><p className="text-slate-900">{t.owner.name}</p><p className="text-xs text-slate-500">{t.owner.email}</p></> : '—') },
              { header: 'Branches', cell: (t) => t.branches_count, align: 'right' },
              { header: 'People', cell: (t) => <span className="inline-flex items-center gap-1"><Users className="size-3.5 text-slate-400" />{t.members_count}</span>, align: 'right' },
              { header: 'Joined', cell: (t) => formatDate(t.created_at) },
              { header: 'Status', cell: (t) => <Badge status={t.status === 'active' ? 'active' : 'suspended'} /> },
              {
                header: '',
                align: 'right',
                cell: (t) => (
                  <Button size="sm" variant={t.status === 'active' ? 'secondary' : 'primary'} onClick={() => setChanging(t)}>
                    {t.status === 'active' ? 'Suspend' : 'Reactivate'}
                  </Button>
                ),
              },
            ]}
          />
          <Pagination page={page} data={list.data} onPage={setPage} />
        </section>
      </main>

      {changing && <StatusDialog tenant={changing} onClose={() => setChanging(null)} />}
    </div>
  );
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number | undefined; tone: 'brand' | 'green' | 'amber' }) {
  const tones = { brand: 'bg-brand-50 text-brand-700', green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700' };
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
      <span className={`grid size-11 place-items-center rounded-xl [&>svg]:size-5 ${tones[tone]}`}>{icon}</span>
      <div>
        <p className="text-sm text-slate-500">{label}</p>
        <p className="font-display text-2xl font-bold text-slate-900">{value ?? '—'}</p>
      </div>
    </div>
  );
}

function StatusDialog({ tenant, onClose }: { tenant: PlatformTenant; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const suspending = tenant.status === 'active';
  const save = useMutation({
    mutationFn: () => api(`/platform/tenants/${tenant.id}/status`, { method: 'PATCH', body: { status: suspending ? 'suspended' : 'active', reason } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
      toast.success(suspending ? `${tenant.name} suspended.` : `${tenant.name} reactivated.`);
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={suspending ? `Suspend ${tenant.name}?` : `Reactivate ${tenant.name}?`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={suspending ? 'danger' : 'primary'} loading={save.isPending} disabled={!reason.trim()} onClick={() => save.mutate()}>{suspending ? 'Suspend business' : 'Reactivate business'}</Button></>}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {suspending
            ? 'Everyone in this business, including the owner, loses access until it is reactivated. Their data is kept.'
            : 'The owner and staff of this business can sign in and work again.'}
        </p>
        {save.error instanceof ApiError && <ErrorBanner error={save.error} />}
        <Field label="Reason (recorded in the audit log)">{(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={suspending ? 'e.g. Unpaid subscription' : 'e.g. Payment received'} />}</Field>
      </div>
    </Modal>
  );
}
