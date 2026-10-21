import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, ArrowRight, Building2, CheckCircle2, KeyRound, Pencil, XCircle, CalendarDays, ChevronRight, CircleCheck, CirclePause, Clock, Crown, Download, Globe, LayoutDashboard,
  LogOut, Mail, MapPin, Phone, Search, ShieldCheck, ShieldOff, ShoppingBag, Store, UserCheck, UserCog, UserPlus, UserX, Users, type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { BrandLogo } from '../../components/BrandLogo';
import { useToast } from '../../components/Toast';
import { Avatar, Button, ErrorBanner, Modal, Pagination, Spinner, cx } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';
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
  shop_enabled?: boolean;
  last_activity_at?: string | null;
  status_reason?: string | null;
}
type PlatformList = Paginated<PlatformTenant> & { summary: { total: number; active: number; suspended: number } };

interface OverviewTenant { id: number; name: string; slug: string; status: 'active' | 'suspended'; owner: string | null; branches_count: number; members_count: number; created_at: string; last_activity_at: string | null }
interface Overview {
  businesses: { total: number; active: number; suspended: number; new_this_month: number; online_shops: number };
  branches: number; staff_accounts: number; customer_accounts: number; platform_admins: number; disabled_accounts: number;
  newest: OverviewTenant[]; attention: OverviewTenant[];
}
interface TenantDetail {
  id: number; name: string; slug: string; status: 'active' | 'suspended'; legal_name: string | null; tin: string | null; address: string | null;
  phone: string | null; email: string | null; timezone: string; currency: string; vat_registered: boolean; shop_enabled: boolean;
  created_at: string; last_activity_at: string | null; owner: { id: number; name: string; email: string | null; phone: string | null } | null;
  branches: { id: number; name: string; code: string; address: string | null; is_active: boolean }[];
  people: { active: number; invited: number; suspended: number; offboarded: number };
  roles: { role: string; total: number }[];
  customer_accounts: number;
  status_history: LogEntry[];
}
interface PlatformUser {
  id: number; name: string; email: string | null; username: string | null; status: 'active' | 'pending' | 'disabled'; is_platform_admin: boolean;
  company_managed: boolean; last_login_at: string | null; created_at: string; businesses: { name: string | null; slug: string | null; status: string }[];
}
interface LogEntry { id: number; action: string; by: string | null; target: string | null; business: string | null; old: Record<string, unknown> | null; new: Record<string, unknown> | null; reason: string | null; created_at: string }

type Tab = 'overview' | 'businesses' | 'accounts' | 'activity';

/** "Today", "3 days ago", or the date. */
function ago(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(iso);
}

/**
 * Platform Super Admin console: overview of the platform, the business directory with each business's account details,
 * sign-in accounts and platform admins, and the log of everything administrators did. By design it shows no sales,
 * payments, products or customer records of any business (the API does not expose them).
 */
export function PlatformPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [openTenant, setOpenTenant] = useState<number | null>(null);

  if (!user?.is_platform_admin) return <Navigate to="/" replace />;

  const tabs: { value: Tab; label: string; icon: LucideIcon }[] = [
    { value: 'overview', label: 'Overview', icon: LayoutDashboard },
    { value: 'businesses', label: 'Businesses', icon: Building2 },
    { value: 'accounts', label: 'Accounts & admins', icon: UserCog },
    { value: 'activity', label: 'Activity log', icon: Activity },
  ];

  return (
    <div className="min-h-full bg-[#f4f6f2]">
      <header className="relative overflow-hidden bg-gradient-to-br from-brand-800 via-brand-900 to-[#06231a] text-white">
        <span aria-hidden className="pointer-events-none absolute -right-20 -top-32 size-96 rounded-full bg-sun-400/15 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex items-center gap-4 py-4">
            <div className="w-11 rounded-xl bg-cream p-1 shadow-md"><BrandLogo /></div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-bold leading-tight">Unified SmartPOS</p>
              <p className="flex items-center gap-1.5 text-xs text-brand-100/80"><ShieldCheck className="size-3.5 text-sun-300" /> Super admin console</p>
            </div>
            <button type="button" onClick={() => navigate('/')} title="Open a business you work at" className="hidden items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-brand-50 ring-1 ring-white/20 transition hover:bg-white/10 md:inline-flex"><Store className="size-4" /> My businesses</button>
            <span className="hidden items-center gap-2 rounded-full bg-white/10 py-1 pl-1 pr-3 text-sm ring-1 ring-white/15 sm:inline-flex"><Avatar name={user.name} size="sm" />{user.name}</span>
            <button type="button" onClick={async () => { await logout(); navigate('/login'); }}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-brand-50 ring-1 ring-white/20 transition hover:bg-white/10">
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
          <nav className="-mb-px flex gap-1 overflow-x-auto pt-2 [scrollbar-width:none]" aria-label="Console sections">
            {tabs.map((t) => (
              <button key={t.value} type="button" onClick={() => setTab(t.value)} aria-current={tab === t.value ? 'page' : undefined}
                className={cx('inline-flex shrink-0 items-center gap-2 rounded-t-xl px-4 py-3 text-sm font-semibold transition duration-200', tab === t.value ? 'bg-[#f4f6f2] text-brand-900' : 'text-brand-100/80 hover:bg-white/10 hover:text-white')}>
                <t.icon className="size-4" />{t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main key={tab} className="auth-fade mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {tab === 'overview' && <OverviewTab onOpen={setOpenTenant} onBusinesses={() => setTab('businesses')} />}
        {tab === 'businesses' && <BusinessesTab onOpen={setOpenTenant} />}
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'activity' && <ActivityTab />}
      </main>

      {openTenant !== null && <TenantDrawer id={openTenant} onClose={() => setOpenTenant(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ Overview */

function OverviewTab({ onOpen, onBusinesses }: { onOpen: (id: number) => void; onBusinesses: () => void }) {
  const overview = useQuery({ queryKey: ['platform-overview'], queryFn: () => api<Overview>('/platform/overview') });
  if (overview.error) return <ErrorBanner error={overview.error} />;
  if (overview.isPending) return <Spinner />;
  const o = overview.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-brand-900 sm:text-3xl">Platform overview</h1>
        <p className="mt-1 text-sm text-slate-500">How the platform is doing. Business data such as sales and customers stays private to each business.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat featured icon={Building2} label="Businesses" value={o.businesses.total} hint={`${o.businesses.new_this_month} new this month`} />
        <Stat icon={CircleCheck} tone="green" label="Active" value={o.businesses.active} hint={`${o.businesses.online_shops} with an online shop`} />
        <Stat icon={CirclePause} tone="amber" label="Suspended" value={o.businesses.suspended} hint={o.businesses.suspended ? 'Cannot sign in' : 'None suspended'} />
        <Stat icon={Store} tone="sky" label="Branches" value={o.branches} hint="Across all businesses" />
        <Stat icon={Users} tone="violet" label="Staff accounts" value={o.staff_accounts} hint="Active memberships" />
        <Stat icon={ShoppingBag} tone="rose" label="Shop customers" value={o.customer_accounts} hint="Online shop accounts" />
        <Stat icon={Crown} tone="amber" label="Platform admins" value={o.platform_admins} hint="Can open this console" />
        <Stat icon={UserX} tone="slate" label="Disabled accounts" value={o.disabled_accounts} hint="Blocked from signing in" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Needs attention" icon={AlertTriangle} tone="amber" description="Suspended businesses, and active ones nobody has used for 14 days.">
          {o.attention.length === 0
            ? <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-100"><CircleCheck className="size-4" />Every business is active and in use.</p>
            : <ul className="divide-y divide-slate-100">{o.attention.map((t) => <TenantRow key={t.id} t={t} onOpen={onOpen} note={t.status === 'suspended' ? 'Suspended' : `Last used ${ago(t.last_activity_at).toLowerCase()}`} />)}</ul>}
        </Card>
        <Card title="Newest businesses" icon={CalendarDays} tone="brand" description="The latest businesses to join the platform."
          action={<button type="button" onClick={onBusinesses} className="text-xs font-semibold text-brand-700 hover:underline">See all</button>}>
          <ul className="divide-y divide-slate-100">{o.newest.map((t) => <TenantRow key={t.id} t={t} onOpen={onOpen} note={`Joined ${formatDate(t.created_at)}`} />)}</ul>
        </Card>
      </div>
    </div>
  );
}

function TenantRow({ t, note, onOpen }: { t: OverviewTenant; note: string; onOpen: (id: number) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(t.id)} className="group flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-slate-50">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Store className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-slate-900">{t.name}</span>
          <span className="block truncate text-xs text-slate-500">{t.owner ?? 'No owner'} · {t.branches_count} branches · {t.members_count} people</span>
        </span>
        <span className="text-right">
          <StatusPill status={t.status} />
          <span className="mt-0.5 block text-[11px] text-slate-400">{note}</span>
        </span>
        <ChevronRight className="size-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ Businesses */

function BusinessesTab({ onOpen }: { onOpen: (id: number) => void }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [changing, setChanging] = useState<PlatformTenant | null>(null);
  const list = useQuery({
    queryKey: ['platform-tenants', page, status, q],
    queryFn: () => api<PlatformList>('/platform/tenants', { query: { page, status, q } }),
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.data ?? [];
  const summary = list.data?.summary;

  const exportCsv = () => {
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Business', 'Business code', 'Owner', 'Owner email', 'Branches', 'People', 'Online shop', 'Status', 'Joined', 'Last used'],
      ...rows.map((t) => [t.name, t.slug, t.owner?.name, t.owner?.email, t.branches_count, t.members_count, t.shop_enabled ? 'Yes' : 'No', t.status, formatDate(t.created_at), t.last_activity_at ? formatDate(t.last_activity_at) : 'Never'])];
    const url = URL.createObjectURL(new Blob([lines.map((l) => l.map(cell).join(',')).join('\n')], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'businesses.csv' });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-brand-900 sm:text-3xl">Businesses</h1>
          <p className="mt-1 text-sm text-slate-500">Every business on the platform. Open one to see its branches, people and suspension history.</p>
        </div>
        <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-900/5 sm:flex-row sm:items-center">
        <div className="relative sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
            placeholder="Search name or business code" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search businesses" />
        </div>
        <div className="inline-flex rounded-xl bg-slate-100 p-1 sm:ml-auto" role="group" aria-label="Status">
          {[['', 'All', summary?.total], ['active', 'Active', summary?.active], ['suspended', 'Suspended', summary?.suspended]].map(([v, label, count]) => (
            <button key={String(v)} type="button" aria-pressed={status === v} onClick={() => { setStatus(String(v)); setPage(1); }}
              className={cx('rounded-lg px-3 py-1.5 text-xs font-semibold transition duration-200', status === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
              {label}{count !== undefined && <span className="ml-1.5 text-slate-400">{count}</span>}
            </button>
          ))}
        </div>
      </div>

      {list.error ? <ErrorBanner error={list.error} /> : list.isPending ? <Spinner /> : rows.length === 0 ? (
        <p className="rounded-2xl bg-white p-10 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-900/5">No businesses match.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => (
            <article key={t.id} className={cx('sp-rise flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg', t.status === 'suspended' ? 'ring-amber-200' : 'ring-slate-900/5')}>
              <span aria-hidden className={cx('h-1.5 bg-gradient-to-r', t.status === 'suspended' ? 'from-amber-400 to-orange-500' : 'from-brand-500 to-emerald-400')} />
              <button type="button" onClick={() => onOpen(t.id)} className="flex-1 p-5 text-left">
                <div className="flex items-start gap-3">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-100"><Store className="size-6" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg font-bold text-slate-900">{t.name}</p>
                    <code className="text-xs text-slate-500">{t.slug}</code>
                  </div>
                  <StatusPill status={t.status} />
                </div>
                {t.status === 'suspended' && t.status_reason && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-100"><strong>Reason:</strong> {t.status_reason}</p>}
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <Mini label="Branches" value={t.branches_count} />
                  <Mini label="People" value={t.members_count} />
                  <Mini label="Shop" value={t.shop_enabled ? 'On' : 'Off'} />
                </dl>
                <div className="mt-4 space-y-1.5 text-xs text-slate-600">
                  <p className="flex items-center gap-2"><Crown className="size-3.5 text-amber-500" /><span className="truncate">{t.owner?.name ?? 'No owner'}{t.owner?.email && <span className="text-slate-400"> · {t.owner.email}</span>}</span></p>
                  <p className="flex items-center gap-2"><Clock className="size-3.5 text-slate-400" />Last used {ago(t.last_activity_at).toLowerCase()} · joined {formatDate(t.created_at)}</p>
                </div>
              </button>
              <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
                <button type="button" onClick={() => onOpen(t.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">View details <ChevronRight className="size-3.5" /></button>
                <Button size="sm" variant={t.status === 'active' ? 'secondary' : 'primary'} onClick={() => setChanging(t)}>{t.status === 'active' ? 'Suspend' : 'Reactivate'}</Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5"><Pagination page={page} data={list.data} onPage={setPage} /></div>
      {changing && <StatusDialog tenant={changing} onClose={() => setChanging(null)} />}
    </div>
  );
}

function TenantDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const detail = useQuery({ queryKey: ['platform-tenant', id], queryFn: () => api<{ data: TenantDetail }>(`/platform/tenants/${id}`) });
  const [changing, setChanging] = useState(false);
  const t = detail.data?.data;
  return (
    <Modal open onClose={onClose} title={t?.name ?? 'Business'} icon={Store} size="xl" description={t ? <>Business code <code>{t.slug}</code> · joined {formatDate(t.created_at)}</> : undefined}
      footer={t && <><Button variant="secondary" onClick={onClose}>Close</Button><Button variant={t.status === 'active' ? 'danger' : 'primary'} onClick={() => setChanging(true)}>{t.status === 'active' ? 'Suspend business' : 'Reactivate business'}</Button></>}>
      {detail.error ? <ErrorBanner error={detail.error} /> : !t ? <Spinner /> : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-4">
            <Mini big label="Status" value={<StatusPill status={t.status} />} />
            <Mini big label="Last used" value={ago(t.last_activity_at)} />
            <Mini big label="People" value={t.people.active + t.people.invited} />
            <Mini big label="Shop customers" value={t.customer_accounts} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Section title="Owner" icon={Crown}>
              {t.owner ? (
                <div className="flex items-center gap-3">
                  <Avatar name={t.owner.name} />
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-slate-900">{t.owner.name}</p>
                    {t.owner.email && <p className="flex items-center gap-1.5 text-slate-600"><Mail className="size-3.5 text-slate-400" />{t.owner.email}</p>}
                    {t.owner.phone && <p className="flex items-center gap-1.5 text-slate-600"><Phone className="size-3.5 text-slate-400" />{t.owner.phone}</p>}
                  </div>
                </div>
              ) : <p className="text-sm text-slate-500">No owner on record.</p>}
            </Section>
            <Section title="Business profile" icon={Building2}>
              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-slate-500">Registered name</dt><dd className="text-slate-800">{t.legal_name || '—'}</dd>
                <dt className="text-slate-500">TIN</dt><dd className="text-slate-800">{t.tin || '—'}</dd>
                <dt className="text-slate-500">Contact</dt><dd className="text-slate-800">{[t.phone, t.email].filter(Boolean).join(' · ') || '—'}</dd>
                <dt className="text-slate-500">Tax</dt><dd className="text-slate-800">{t.vat_registered ? 'VAT-registered' : 'Non-VAT'} · {t.currency}</dd>
                <dt className="text-slate-500">Time zone</dt><dd className="flex items-center gap-1 text-slate-800"><Globe className="size-3.5 text-slate-400" />{t.timezone}</dd>
              </dl>
            </Section>
          </div>

          <Section title={`Branches (${t.branches.length})`} icon={MapPin}>
            <ul className="grid gap-2 sm:grid-cols-2">
              {t.branches.map((b) => (
                <li key={b.id} className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                  <Store className="mt-0.5 size-4 shrink-0 text-brand-600" />
                  <span className="min-w-0 text-sm">
                    <span className="block font-semibold text-slate-900">{b.name} <code className="text-[11px] font-normal text-slate-400">{b.code}</code>{!b.is_active && <span className="ml-1 text-[11px] font-semibold text-amber-700">Inactive</span>}</span>
                    <span className="block truncate text-xs text-slate-500">{b.address || 'No address'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <div className="grid gap-4 md:grid-cols-2">
            <Section title="People" icon={Users}>
              <div className="grid grid-cols-4 gap-2 text-center">
                <Mini label="Active" value={t.people.active} />
                <Mini label="Invited" value={t.people.invited} />
                <Mini label="Suspended" value={t.people.suspended} />
                <Mini label="Left" value={t.people.offboarded} />
              </div>
              {t.roles.length > 0 && <ul className="mt-3 flex flex-wrap gap-1.5">{t.roles.map((r) => <li key={r.role} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 ring-1 ring-brand-100">{r.role} · {r.total}</li>)}</ul>}
            </Section>
            <Section title="Suspension history" icon={ShieldOff}>
              {t.status_history.length === 0 ? <p className="text-sm text-slate-500">Never suspended.</p> : (
                <ol className="space-y-2">
                  {t.status_history.map((h) => (
                    <li key={h.id} className="rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-100">
                      <p className="font-semibold text-slate-900">{h.new?.status === 'suspended' ? 'Suspended' : 'Reactivated'} <span className="font-normal text-slate-500">by {h.by ?? 'an administrator'}</span></p>
                      {h.reason && <p className="mt-0.5 text-slate-600">“{h.reason}”</p>}
                      <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(h.created_at)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>
          {changing && <StatusDialog tenant={{ id: t.id, name: t.name, status: t.status }} onClose={() => setChanging(false)} />}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ Accounts */

type AccountFilter = '' | 'admins' | 'disabled' | 'never';
type UserList = Paginated<PlatformUser> & { summary?: { total: number; admins: number; disabled: number; never: number } };

function AccountsTab() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AccountFilter>('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim());
  const [action, setAction] = useState<{ user: PlatformUser; kind: 'status' | 'admin' | 'reset' } | null>(null);
  const [addAccount, setAddAccount] = useState(false);
  const [addAdmin, setAddAdmin] = useState(false);
  const { user: me } = useAuth();
  const list = useQuery({
    queryKey: ['platform-users', q, filter, page],
    queryFn: () => api<UserList>('/platform/users', { query: { q, filter, page } }),
    placeholderData: keepPreviousData,
  });
  const admins = useQuery({ queryKey: ['platform-users', '', 'admins', 1], queryFn: () => api<UserList>('/platform/users', { query: { filter: 'admins' } }) });
  const rows = list.data?.data ?? [];
  const summary = list.data?.summary;
  const pick = (f: AccountFilter) => { setFilter(f); setPage(1); };

  const tiles: { value: AccountFilter; label: string; count?: number; icon: LucideIcon; tone: keyof typeof TONES }[] = [
    { value: '', label: 'All accounts', count: summary?.total, icon: Users, tone: 'brand' },
    { value: 'admins', label: 'Platform admins', count: summary?.admins, icon: Crown, tone: 'amber' },
    { value: 'disabled', label: 'Disabled', count: summary?.disabled, icon: UserX, tone: 'rose' },
    { value: 'never', label: 'Never signed in', count: summary?.never, icon: Clock, tone: 'slate' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
        <h1 className="font-display text-2xl font-bold text-brand-900 sm:text-3xl">Accounts & admins</h1>
        <p className="mt-1 text-sm text-slate-500">Manage sign-in accounts, business staff roles, and who can open this console.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Crown className="size-4" />} onClick={() => setAddAdmin(true)}>Add Super Admin</Button>
          <Button icon={<UserPlus className="size-4" />} onClick={() => setAddAccount(true)}>Add business account</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <button key={t.value || 'all'} type="button" onClick={() => pick(t.value)} aria-pressed={filter === t.value}
            className={cx('sp-rise flex items-center gap-3 rounded-2xl p-4 text-left ring-1 transition duration-200', filter === t.value ? 'bg-white shadow-md ring-2 ring-brand-500' : 'bg-white/70 shadow-sm ring-slate-900/5 hover:bg-white')}>
            <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', TONES[t.tone])}><t.icon className="size-5" /></span>
            <span className="min-w-0">
              <span className="block font-display text-2xl font-bold leading-none text-slate-900">{t.count ?? '—'}</span>
              <span className="mt-1 block truncate text-xs font-medium text-slate-500">{t.label}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
            <div className="relative sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                placeholder="Search name, email or username" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search accounts" />
            </div>
            <p className="text-xs text-slate-400 sm:ml-auto">{list.data ? `${list.data.meta?.total ?? list.data.total ?? rows.length} ${filter ? tiles.find((t) => t.value === filter)?.label.toLowerCase() : 'accounts'}` : ''}</p>
          </div>

          {list.error ? <div className="p-4"><ErrorBanner error={list.error} /></div> : list.isPending ? <Spinner /> : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-500">No accounts match.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="sp-cards w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="py-3 pl-4 pr-3">Account</th>
                    <th className="px-3 py-3">Login</th>
                    <th className="px-3 py-3">Businesses</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Last sign-in</th>
                    <th className="py-3 pl-3 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((u) => {
                    const self = u.id === me?.id;
                    const canAdmin = !self && !!u.email && (u.is_platform_admin || u.status === 'active');
                    return (
                      <tr key={u.id} className={cx('group transition-colors hover:bg-slate-50/70', u.status === 'disabled' && 'bg-rose-50/30')}>
                        <td className="py-3 pl-4 pr-3">
                          <div className="flex items-center gap-3">
                            <span className="relative">
                              <Avatar name={u.name} />
                              {u.is_platform_admin && <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-sun-400 text-brand-900 ring-2 ring-white"><Crown className="size-2.5" /></span>}
                            </span>
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 truncate font-semibold text-slate-900">{u.name}{self && <span className="rounded bg-brand-700 px-1 py-px text-[9px] font-bold uppercase text-white">You</span>}</p>
                              <p className="truncate text-xs text-slate-500">{u.email ?? u.username}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {u.is_platform_admin
                            ? <span className="inline-flex items-center gap-1 rounded-full bg-sun-300/30 px-2 py-0.5 text-[11px] font-bold text-amber-800 ring-1 ring-amber-200"><Crown className="size-3" />Platform admin</span>
                            : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{u.company_managed ? 'Business login' : 'Personal'}</span>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex max-w-[14rem] flex-wrap gap-1">
                            {u.businesses.slice(0, 2).map((b, i) => <span key={i} className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200"><Store className="size-3 shrink-0 text-brand-500" /><span className="truncate">{b.name}</span></span>)}
                            {u.businesses.length > 2 && <span className="text-[11px] text-slate-400">+{u.businesses.length - 2}</span>}
                            {u.businesses.length === 0 && <span className="text-xs text-slate-300">—</span>}
                          </div>
                        </td>
                        <td className="px-3 py-3"><AccountPill status={u.status} /></td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500" title={u.last_login_at ? formatDateTime(u.last_login_at) : undefined}>{u.last_login_at ? ago(u.last_login_at) : <span className="text-slate-300">Never</span>}</td>
                        <td className="py-3 pl-3 pr-4">
                          <div className="flex justify-end gap-1.5">
                            {canAdmin && (
                              <IconAction label={u.is_platform_admin ? 'Remove admin' : 'Make admin'} tone={u.is_platform_admin ? 'amber' : 'default'} onClick={() => setAction({ user: u, kind: 'admin' })}>
                                {u.is_platform_admin ? <ShieldOff className="size-4" /> : <Crown className="size-4" />}
                              </IconAction>
                            )}
                            {!self && u.status !== 'pending' && (
                              <IconAction label={u.status === 'disabled' ? 'Enable account' : 'Disable account'} tone={u.status === 'disabled' ? 'green' : 'rose'} onClick={() => setAction({ user: u, kind: 'status' })}>
                                {u.status === 'disabled' ? <UserCheck className="size-4" /> : <UserX className="size-4" />}
                              </IconAction>
                            )}
                            {!self && u.status === 'active' && <IconAction label="Reset password" tone="default" onClick={() => setAction({ user: u, kind: 'reset' })}><KeyRound className="size-4" /></IconAction>}
                            {self && <span className="text-[11px] text-slate-400">Your account</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} data={list.data} onPage={setPage} />
        </section>

        <aside className="space-y-6">
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
            <h2 className="flex items-center gap-2 font-display font-bold text-slate-900"><Crown className="size-4 text-amber-500" />Platform admins</h2>
            <p className="mt-0.5 text-xs text-slate-500">People who can open this console.</p>
            <ul className="mt-3 space-y-2">
              {(admins.data?.data ?? []).map((a) => (
                <li key={a.id} className="flex items-center gap-2.5">
                  <Avatar name={a.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">{a.name}{a.id === me?.id && <span className="ml-1 text-[10px] font-bold uppercase text-brand-700">· you</span>}</span>
                    <span className="block truncate text-[11px] text-slate-500">{a.email}</span>
                  </span>
                  <span className="text-[11px] text-slate-400" title={a.last_login_at ? formatDateTime(a.last_login_at) : undefined}>{ago(a.last_login_at)}</span>
                </li>
              ))}
            </ul>
            {(admins.data?.data.length ?? 0) === 1 && <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800 ring-1 ring-amber-100"><AlertTriangle className="mt-px size-3.5 shrink-0" />Only one admin. Add a second trusted person so the platform is never locked out.</p>}
          </section>
          <ShopCustomerAdmin />
        </aside>
      </div>
      {action && <AccountDialog user={action.user} kind={action.kind} onClose={() => setAction(null)} />}
      {addAccount && <AddStaffAccountDialog onClose={() => setAddAccount(false)} />}
      {addAdmin && <AddPlatformAdminDialog onClose={() => setAddAdmin(false)} />}
    </div>
  );
}

function IconAction({ label, tone, onClick, children }: { label: string; tone: 'default' | 'amber' | 'rose' | 'green'; onClick: () => void; children: ReactNode }) {
  const tones = {
    default: 'text-slate-500 hover:bg-amber-50 hover:text-amber-700 hover:ring-amber-200',
    amber: 'text-amber-700 hover:bg-amber-50 hover:ring-amber-200',
    rose: 'text-slate-500 hover:bg-rose-50 hover:text-rose-600 hover:ring-rose-200',
    green: 'text-emerald-700 hover:bg-emerald-50 hover:ring-emerald-200',
  };
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className={cx('group/btn relative grid size-9 place-items-center rounded-xl bg-white ring-1 ring-slate-200 transition duration-150 active:scale-95', tones[tone])}>
      {children}
      <span className="pointer-events-none absolute -top-8 right-0 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow transition group-hover/btn:opacity-100">{label}</span>
    </button>
  );
}

interface ShopCustomer { id: number; name: string; email: string; phone: string | null; status: string; shop: string | null; created_at: string }
interface CustomerLookup { data: ShopCustomer[]; login: { id: number; name: string; status: string; is_platform_admin: boolean } | null }

/**
 * Make someone who signed up in an online shop a platform admin. Search is by exact email only, so the console never
 * lists a business's customers.
 */
function ShopCustomerAdmin() {
  const [email, setEmail] = useState('');
  const [searched, setSearched] = useState('');
  const [promoting, setPromoting] = useState<ShopCustomer | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const lookup = useQuery({
    queryKey: ['platform-customer-lookup', searched],
    queryFn: () => api<CustomerLookup>('/platform/customer-lookup', { query: { email: searched } }),
    enabled: !!searched,
  });
  const found = lookup.data?.data ?? [];
  const already = lookup.data?.login?.is_platform_admin;

  return (
    <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-amber-50 via-white to-white shadow-sm ring-1 ring-amber-200/70">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sun-400 to-amber-500 text-white shadow-sm"><Crown className="size-5" /></span>
          <div>
            <h2 className="font-display font-bold text-slate-900">Add an admin from the online shop</h2>
            <p className="text-xs text-slate-500">Ask the person to sign up in any online shop first, then enter the exact email they used. Their shop account moves here: they sign in on the Management sign-in with the same email and shop password, and no longer as a shop customer.</p>
          </div>
        </div>
        <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) setSearched(email.trim().toLowerCase()); }}>
          <div className="relative flex-1">
            <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their.email@gmail.com" aria-label="Shop customer email"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100" />
          </div>
          <Button type="submit" disabled={!valid} loading={lookup.isFetching} icon={<Search className="size-4" />}>Find</Button>
        </form>
      </div>

      {searched && !lookup.isPending && (
        <div className="sp-rise border-t border-amber-100 bg-white/70 px-5 py-4">
          {lookup.error ? <ErrorBanner error={lookup.error} /> : found.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-slate-600"><AlertTriangle className="size-4 text-amber-500" />No shop account uses <strong>{searched}</strong>. Check the spelling, or ask them to sign up in the online shop first.</p>
          ) : (
            <ul className="space-y-2">
              {already && <li className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-100"><CheckCircle2 className="size-4 text-emerald-600" /><span><strong>{lookup.data?.login?.name}</strong> is already a platform admin. Finish the move so they sign in with their shop password and stop using the shop account.</span></li>}
              {found.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
                  <Avatar name={c.name} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{c.name} <span className="ml-1 rounded-full bg-rose-50 px-2 py-px text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200">Shop customer</span></p>
                    <p className="truncate text-xs text-slate-500">{c.email}{c.phone && <> · {c.phone}</>} · signed up at <strong>{c.shop ?? 'a shop'}</strong> on {formatDate(c.created_at)}</p>
                  </div>
                  <Button size="sm" icon={<Crown className="size-3.5" />} disabled={c.status !== 'active'} onClick={() => setPromoting(c)}>{already ? 'Finish move' : 'Make admin'}</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {promoting && <CustomerAdminDialog customer={promoting} existingLogin={lookup.data?.login?.name ?? null} onClose={() => setPromoting(null)} onDone={() => { setSearched(''); setEmail(''); }} />}
    </section>
  );
}

function CustomerAdminDialog({ customer, existingLogin, onClose, onDone }: { customer: ShopCustomer; existingLogin: string | null; onClose: () => void; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user: me } = useAuth();
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api(`/platform/customer-accounts/${customer.id}/make-admin`, { method: 'POST', body: { reason: reason.trim() } }),
    onSuccess: () => {
      for (const key of ['platform-users', 'platform-overview', 'platform-activity', 'platform-customer-lookup']) void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(`${customer.name} is now a platform admin. They sign in with ${customer.email} and their shop password on the Management sign-in.`);
      onDone();
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={`Make ${customer.name} a platform admin?`} icon={Crown} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={reasonQuality(reason).level !== 'good'} onClick={() => save.mutate()}>Make admin</Button></>}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-gradient-to-br from-slate-50 to-white p-4 ring-1 ring-slate-200">
          <span className="[&>span]:size-12 [&>span]:text-sm"><Avatar name={customer.name} /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-bold text-slate-900">{customer.name}</p>
            <p className="truncate text-xs text-slate-500">{customer.email} · {customer.shop ?? 'Online shop'}</p>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">Shop customer</span>
            <ArrowRight className="size-4 text-slate-400" />
            <span className="rounded-full bg-sun-300/30 px-2.5 py-1 text-amber-800 ring-1 ring-amber-200">Platform admin</span>
          </div>
        </div>

        <ul className="grid gap-1.5 sm:grid-cols-2">
          {[
            { ok: true, text: 'Signs in on the Management sign-in with the same email and their shop password' },
            { ok: true, text: 'Opens this console: every business, suspensions and accounts' },
            { ok: false, text: 'No longer signs in to the shop as a customer (their past orders are kept)' },
            { ok: false, text: 'Still cannot see any business’s sales, products or customers' },
          ].map((e) => (
            <li key={e.text} className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-100">
              {e.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />}<span>{e.text}</span>
            </li>
          ))}
        </ul>

        {existingLogin && <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">This email already signs in as <strong>{existingLogin}</strong>. That login becomes the admin and its password <strong>changes to the shop password</strong>; its old password stops working and its devices are signed out.</p>}
        {save.error instanceof ApiError && <ErrorBanner error={save.error} />}
        <ReasonField value={reason} onChange={setReason} suggestions={['Runs the platform', 'New support lead', 'Verified owner of the system']} preview={`${me?.name ?? 'You'} · made ${customer.name} a platform admin`} />
      </div>
    </Modal>
  );
}

function AccountDialog({ user, kind, onClose }: { user: PlatformUser; kind: 'status' | 'admin' | 'reset'; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user: me } = useAuth();
  const [reason, setReason] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const disabling = kind === 'status' && user.status !== 'disabled';
  const granting = kind === 'admin' && !user.is_platform_admin;
  const converting = granting && user.company_managed;
  const destructive = disabling || (kind === 'admin' && !granting);
  const save = useMutation({
    mutationFn: () => kind === 'reset'
      ? api<{ data: { temporary_password: string } }>(`/platform/users/${user.id}/password-reset`, { method: 'POST', body: { reason: reason.trim() } })
      : kind === 'status'
      ? api(`/platform/users/${user.id}/status`, { method: 'PATCH', body: { status: disabling ? 'disabled' : 'active', reason: reason.trim() } })
      : api(`/platform/users/${user.id}/admin`, { method: 'PATCH', body: { is_platform_admin: granting, reason: reason.trim() } }),
    onSuccess: (result) => {
      for (const key of ['platform-users', 'platform-overview', 'platform-activity']) void queryClient.invalidateQueries({ queryKey: [key] });
      if (kind === 'reset') { setTemporaryPassword((result as { data: { temporary_password: string } }).data.temporary_password); toast.success('Temporary password created. Copy it now.'); }
      else { toast.success(kind === 'status' ? `${user.name} ${disabling ? 'can no longer sign in' : 'can sign in again'}.` : `${user.name} ${granting ? 'is now a platform admin' : 'is no longer a platform admin'}.`); onClose(); }
    },
  });

  const title = kind === 'reset' ? `Reset ${user.name}'s password?` : kind === 'status' ? `${disabling ? 'Disable' : 'Enable'} ${user.name}'s account?` : granting ? `Make ${user.name} a platform admin?` : `Remove ${user.name} as platform admin?`;
  const from = kind === 'admin' ? (user.is_platform_admin ? 'Platform admin' : user.company_managed ? 'Business login' : 'Personal account') : user.status === 'disabled' ? 'Disabled' : 'Active';
  const to = kind === 'admin' ? (granting ? 'Platform admin' : user.company_managed ? 'Business login' : 'Personal account') : disabling ? 'Disabled' : 'Active';
  const effects: { ok: boolean; text: string }[] = kind === 'reset'
    ? [{ ok: true, text: 'Creates a one-time temporary password that expires in 24 hours' }, { ok: false, text: 'Signs them out everywhere; they must choose a new password at next sign-in' }]
    : kind === 'admin'
    ? granting
      ? [
          { ok: true, text: 'Open this super admin console' },
          { ok: true, text: 'See every business, suspend and reactivate them' },
          { ok: true, text: 'Disable accounts and manage platform admins' },
          { ok: false, text: 'Still cannot see any business’s sales, products or customers' },
        ]
      : [{ ok: false, text: 'Can no longer open this super admin console' }, { ok: true, text: 'Keeps their job and sign-in at their businesses' }]
    : disabling
      ? [{ ok: false, text: 'Cannot sign in to any business, and is signed out everywhere now' }, { ok: true, text: 'Their records and history are kept' }]
      : [{ ok: true, text: 'Can sign in again with their usual password' }];
  const suggestions = kind === 'reset' ? ['User asked for sign-in help', 'Password may have been exposed', 'Account recovery requested'] : kind === 'admin'
    ? granting ? ['Runs the platform', 'New support lead', 'Verified owner of the system'] : ['Left the team', 'No longer needs console access', 'Role changed']
    : disabling ? ['Account reported as compromised', 'Lost or stolen phone', 'Misuse reported by the owner'] : ['Verified with the owner', 'Issue resolved', 'Phone recovered'];
  const quality = reasonQuality(reason);

  return (
    <Modal open onClose={onClose} title={title} icon={kind === 'admin' ? Crown : kind === 'reset' ? KeyRound : disabling ? UserX : UserCheck} size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        {!temporaryPassword && <Button variant={destructive ? 'danger' : 'primary'} loading={save.isPending} disabled={quality.level !== 'good'} onClick={() => save.mutate()}>
          {kind === 'reset' ? 'Generate temporary password' : kind === 'status' ? (disabling ? 'Disable account' : 'Enable account') : granting ? 'Make admin' : 'Remove admin'}
        </Button>}
      </>}>
      <div className="space-y-5">
        {/* Who, and what changes */}
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-gradient-to-br from-slate-50 to-white p-4 ring-1 ring-slate-200">
          <span className="[&>span]:size-12 [&>span]:text-sm"><Avatar name={user.name} /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-bold text-slate-900">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email ?? user.username}{user.businesses[0]?.name && <> · {user.businesses[0].name}</>}</p>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className="rounded-full bg-white px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">{from}</span>
            <ArrowRight className="size-4 text-slate-400" />
            <span className={cx('rounded-full px-2.5 py-1 ring-1', destructive ? 'bg-rose-50 text-rose-700 ring-rose-200' : kind === 'admin' ? 'bg-sun-300/30 text-amber-800 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200')}>{to}</span>
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{granting ? 'They will be able to' : 'After this'}</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {effects.map((e) => (
              <li key={e.text} className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-100">
                {e.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />}
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {converting && (
          <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-400 text-amber-950"><KeyRound className="size-4" /></span>
            <div>
              <p className="font-semibold">This login was created by {user.businesses[0]?.name ?? 'a business'}</p>
              <p className="mt-0.5 text-amber-900/90">It becomes a personal account first, so the business can no longer reset its password. {user.name} keeps their job and password there, and signs in with <strong>{user.email}</strong> on the <strong>Management</strong> sign-in.</p>
            </div>
          </div>
        )}

        {temporaryPassword && <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200"><p className="text-sm font-semibold text-emerald-900">Temporary password — copy and give it directly to {user.name}</p><code className="mt-2 block select-all break-all rounded-lg bg-white p-3 text-base font-bold text-slate-900 ring-1 ring-emerald-200">{temporaryPassword}</code><p className="mt-2 text-xs text-emerald-800">Shown once. Expires in 24 hours and must be changed at next sign-in.</p></div>}
        {save.error instanceof ApiError && <ErrorBanner error={save.error} />}
        {!temporaryPassword && <ReasonField value={reason} onChange={setReason} suggestions={suggestions} preview={`${me?.name ?? 'You'} · ${kind === 'reset' ? `reset ${user.name}'s password` : kind === 'admin' ? (granting ? `made ${user.name} a platform admin` : `removed ${user.name} as platform admin`) : `${disabling ? 'disabled' : 'enabled'} ${user.name}`}`} />}
      </div>
    </Modal>
  );
}

function AddPlatformAdminDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [created, setCreated] = useState<{ email: string; name: string; source: 'existing_login' | 'shop_customer' | 'new_email'; temporary_password: string | null; expires_at: string | null; converted_to_personal: boolean } | null>(null);
  const save = useMutation({
    mutationFn: () => api<{ data: NonNullable<typeof created> }>('/platform/admins', {
      method: 'POST', body: { email: email.trim() },
    }),
    onSuccess: (response) => {
      setCreated(response.data);
      for (const key of ['platform-users', 'platform-overview', 'platform-activity']) void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success('Super Admin added.');
    },
  });

  return <Modal open onClose={onClose} title={created ? 'Super Admin account created' : 'Add Super Admin'} icon={Crown} size="md"
    footer={created ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!email.trim()} onClick={() => save.mutate()}>Add Super Admin</Button></>}>
    <div className="space-y-4">
      {created ? <div className="space-y-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
        <p className="text-sm font-semibold text-amber-950">{created.name} now has Super Admin access.</p>
        <p className="text-sm text-slate-700">Management sign-in email: <code className="select-all font-bold">{created.email}</code></p>
        {created.temporary_password ? <>
          <p className="text-sm text-slate-700">The account name was set from the email address; they can update it after signing in.</p>
          <div><p className="text-xs font-semibold text-amber-950">Temporary password (expires in 24 hours)</p><code className="mt-1 block select-all break-all rounded-lg bg-white p-3 font-bold text-slate-900 ring-1 ring-amber-200">{created.temporary_password}</code></div>
          <p className="text-xs text-amber-900">Share it directly. They must change it at first sign-in and confirm a sign-in code sent to their email.</p>
        </> : <p className="text-xs text-amber-900">They keep their existing password and should sign in through Management. {created.source === 'shop_customer' ? 'Their online-shop account has been moved to this login.' : created.converted_to_personal ? 'Their business login is now a personal Super Admin login; their business membership remains.' : ''}</p>}
      </div> : <>
        <p className="text-sm text-slate-600">Enter the person’s email. If they already have an account, it will be promoted and their password will stay the same. A new email gets a temporary password. Only add someone you trust to manage the platform.</p>
        <label className="block text-sm font-medium text-slate-700">Email address<input type="email" className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} autoFocus /></label>
        {save.error instanceof ApiError && <ErrorBanner error={save.error} />}
      </>}
    </div>
  </Modal>;
}

interface StaffSetupOptions {
  tenant: { id: number; name: string; status: string };
  branches: { id: number; name: string; code: string }[];
  roles: { id: number; key: string; name: string }[];
}

function AddStaffAccountDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tenantSearch, setTenantSearch] = useState('');
  const tenantQuery = useDebounced(tenantSearch.trim());
  const [tenantId, setTenantId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [created, setCreated] = useState<{ business_code: string; email: string | null; username: string; employee_code: string; role: string; role_key: string; branch: string; temporary_password: string } | null>(null);
  const businesses = useQuery({
    queryKey: ['platform-staff-tenants', tenantQuery],
    queryFn: () => api<PlatformList>('/platform/tenants', { query: { q: tenantQuery, status: 'active', per_page: 100 } }),
  });
  const options = useQuery({
    queryKey: ['platform-staff-options', tenantId],
    queryFn: () => api<{ data: StaffSetupOptions }>(`/platform/tenants/${tenantId}/staff-options`),
    enabled: !!tenantId,
  });
  const save = useMutation({
    mutationFn: () => api<{ data: NonNullable<typeof created> }>(`/platform/tenants/${tenantId}/staff`, {
      method: 'POST', body: { name: name.trim(), email: email.trim() || null, role_id: Number(roleId), branch_id: Number(branchId) },
    }),
    onSuccess: (response) => {
      setCreated(response.data);
      for (const key of ['platform-users', 'platform-overview', 'platform-activity']) void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success('Business account created. Copy the temporary password now.');
    },
  });
  const config = options.data?.data;
  const selectedRole = config?.roles.find((role) => String(role.id) === roleId);
  const ownerRole = selectedRole?.key === 'business_owner';
  const emailSignInRole = selectedRole?.key === 'business_owner' || selectedRole?.key === 'branch_manager';
  const canSubmit = !!tenantId && !!name.trim() && !!roleId && (!emailSignInRole || !!email.trim())
    && (ownerRole || (!!branchId && !!config?.branches.length)) && !!config?.roles.length;

  return <Modal open onClose={onClose} title={created ? 'Account created' : 'Add business account'} icon={created ? CheckCircle2 : UserPlus} size="md"
    footer={created ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!canSubmit} onClick={() => save.mutate()}>Create account</Button></>}>
    <div className="space-y-4">
      {created ? <div className="space-y-3 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
        <p className="text-sm font-semibold text-emerald-900">Give these sign-in details directly to the employee. The password is shown once.</p>
        <p className="text-sm text-slate-700">{created.role_key === 'business_owner' || created.role_key === 'branch_manager' ? <>Management sign-in email: <code className="select-all font-bold">{created.email}</code></> : <>Business code: <code className="select-all font-bold">{created.business_code}</code><br />Username: <code className="select-all font-bold">{created.username}</code></>}<br />Employee ID: <code className="select-all font-bold">{created.employee_code}</code><br />Role: {created.role}<br />Branch: {created.branch}</p>
        <div><p className="text-xs font-semibold text-emerald-900">Temporary password (expires in 24 hours)</p><code className="mt-1 block select-all break-all rounded-lg bg-white p-3 font-bold text-slate-900 ring-1 ring-emerald-200">{created.temporary_password}</code></div>
        <p className="text-xs text-emerald-800">{created.role_key === 'business_owner' || created.role_key === 'branch_manager' ? 'They use the Management sign-in with their email and change the temporary password. They will land on this business dashboard with their role access.' : 'They sign in from the Staff option using the business code and username, then choose a new password.'}</p>
      </div> : <>
        <p className="text-xs text-slate-500">Business Owners get all-branch access. Managers are assigned to one branch. After sign-in, each lands in the business dashboard with access based on their role.</p>
        <label className="block text-sm font-medium text-slate-700">Find business
          <input className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" value={tenantSearch} onChange={(e) => { setTenantSearch(e.target.value); setTenantId(''); setRoleId(''); setBranchId(''); }} placeholder="Search business name" />
        </label>
        <label className="block text-sm font-medium text-slate-700">Business
          <select className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" value={tenantId} onChange={(e) => { setTenantId(e.target.value); setRoleId(''); setBranchId(''); }}>
            <option value="">Select a business</option>{(businesses.data?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        {businesses.error instanceof ApiError && <ErrorBanner error={businesses.error} />}
        {tenantId && options.error instanceof ApiError && <ErrorBanner error={options.error} />}
        {tenantId && !options.isPending && config && <>
          {!config.branches.length || !config.roles.length ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">This business needs an active branch and seeded staff roles before an account can be created.</p> : <>
            <label className="block text-sm font-medium text-slate-700">Employee name<input className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} /></label>
            <label className="block text-sm font-medium text-slate-700">Email {emailSignInRole ? '(required for sign-in)' : '(optional)'}<input type="email" className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} required={emailSignInRole} /></label>
            <label className="block text-sm font-medium text-slate-700">System role<select className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" value={roleId} onChange={(e) => setRoleId(e.target.value)}><option value="">Choose role</option>{config.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            {ownerRole ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Business Owner can access every branch and the full business dashboard.</p> : <label className="block text-sm font-medium text-slate-700">Branch<select className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">Choose branch</option>{config.branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}</select></label>}
          </>}
        </>}
        {save.error instanceof ApiError && <ErrorBanner error={save.error} />}
      </>}
    </div>
  </Modal>;
}

const MAX_REASON = 255;
const VAGUE = /^(none|n\/?a|na|no|nothing|test|testing|ok|okay|x+|\.+|-+|asdf|qwerty|reason|wala|ewan)$/i;

/** How useful a typed reason is: empty, too vague, or good enough to record. */
function reasonQuality(text: string): { level: 'empty' | 'weak' | 'good'; message: string } {
  const t = text.trim();
  if (!t) return { level: 'empty', message: 'Type why you are doing this. It is saved in the activity log.' };
  if (VAGUE.test(t)) return { level: 'weak', message: `"${t}" does not explain anything. Say what happened or who asked.` };
  if (t.length < 8) return { level: 'weak', message: `A little more detail, please (${8 - t.length} more character${8 - t.length === 1 ? '' : 's'}).` };
  return { level: 'good', message: 'Clear reason. It will be recorded exactly as written.' };
}

/** Reason box with live feedback: status, character count, suggestions and a preview of the activity log entry. */
function ReasonField({ value, onChange, suggestions, preview }: { value: string; onChange: (v: string) => void; suggestions: string[]; preview: string }) {
  const quality = reasonQuality(value);
  const used = value.length;
  const tone = { empty: { ring: 'border-slate-200 focus-within:border-brand-500 focus-within:ring-brand-100', text: 'text-slate-500', bar: 'bg-slate-300', icon: Pencil },
    weak: { ring: 'border-amber-300 focus-within:border-amber-400 focus-within:ring-amber-100', text: 'text-amber-700', bar: 'bg-amber-400', icon: AlertTriangle },
    good: { ring: 'border-emerald-300 focus-within:border-emerald-500 focus-within:ring-emerald-100', text: 'text-emerald-700', bar: 'bg-emerald-500', icon: CheckCircle2 } }[quality.level];

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor="platform-reason" className="text-sm font-semibold text-slate-800">Reason <span className="font-normal text-slate-400">· recorded in the activity log</span></label>
        <span className={cx('text-[11px] tabular-nums', used > MAX_REASON - 30 ? 'font-semibold text-amber-700' : 'text-slate-400')}>{used}/{MAX_REASON}</span>
      </div>
      <div className={cx('overflow-hidden rounded-2xl border bg-white shadow-sm transition duration-200 focus-within:ring-4', tone.ring)}>
        <textarea id="platform-reason" rows={3} maxLength={MAX_REASON} value={value} onChange={(e) => onChange(e.target.value)} autoFocus
          placeholder="e.g. Verified owner of the system" className="block w-full resize-none bg-transparent px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400" />
        <div className="h-1 bg-slate-100"><div className={cx('h-full transition-all duration-300', tone.bar)} style={{ width: `${Math.min(100, quality.level === 'good' ? Math.max(35, (used / 60) * 100) : (used / 8) * 35)}%` }} /></div>
      </div>
      <p key={quality.level} className={cx('sp-alert-in mt-2 flex items-center gap-1.5 text-xs font-medium', tone.text)}><tone.icon className="size-3.5 shrink-0" />{quality.message}</p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Quick pick</span>
        {suggestions.map((s) => (
          <button key={s} type="button" onClick={() => onChange(s)}
            className={cx('rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition duration-150', value === s ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300')}>{s}</button>
        ))}
      </div>

      {quality.level === 'good' && (
        <div className="sp-rise mt-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Activity log preview</p>
          <p className="mt-1 text-xs text-slate-600"><strong className="text-slate-800">{preview}</strong> · “{value.trim()}”</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Activity */

type ActivityType = '' | 'businesses' | 'accounts' | 'admins';
type ActivityList = Paginated<LogEntry> & { summary?: { total: number; this_week: number; businesses: number; accounts: number; admins: number } };

const ACTIVITY: Record<string, { verb: (e: LogEntry) => string; icon: LucideIcon; tone: string; category: string; chip: string }> = {
  'platform.tenant_status_changed': { verb: (e) => (e.new?.status === 'suspended' ? 'suspended' : 'reactivated'), icon: CirclePause, tone: 'bg-amber-100 text-amber-700 ring-amber-200', category: 'Business', chip: 'bg-amber-50 text-amber-800 ring-amber-200' },
  'platform.user_status_changed': { verb: (e) => (e.new?.status === 'disabled' ? 'disabled the account of' : 'enabled the account of'), icon: UserX, tone: 'bg-rose-100 text-rose-700 ring-rose-200', category: 'Account', chip: 'bg-rose-50 text-rose-700 ring-rose-200' },
  'platform.admin_granted': { verb: () => 'made', icon: Crown, tone: 'bg-sun-300/40 text-amber-800 ring-amber-200', category: 'Admin', chip: 'bg-sun-300/30 text-amber-800 ring-amber-200' },
  'platform.admin_revoked': { verb: () => 'removed', icon: ShieldOff, tone: 'bg-slate-100 text-slate-700 ring-slate-200', category: 'Admin', chip: 'bg-slate-100 text-slate-700 ring-slate-200' },
};
const suffix = (e: LogEntry) => (e.action === 'platform.admin_granted' ? ' a platform admin' : e.action === 'platform.admin_revoked' ? ' as platform admin' : '');

function dayLabel(iso: string): string {
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function ActivityTab() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState<ActivityType>('');
  const list = useQuery({ queryKey: ['platform-activity', type, page], queryFn: () => api<ActivityList>('/platform/activity', { query: { page, type } }), placeholderData: keepPreviousData });
  const rows = list.data?.data ?? [];
  const s = list.data?.summary;
  const days = rows.reduce<{ label: string; items: LogEntry[] }[]>((acc, e) => {
    const label = dayLabel(e.created_at);
    const last = acc[acc.length - 1];
    if (last?.label === label) last.items.push(e); else acc.push({ label, items: [e] });
    return acc;
  }, []);
  const filters: { value: ActivityType; label: string; count?: number; icon: LucideIcon; tone: keyof typeof TONES }[] = [
    { value: '', label: 'All actions', count: s?.total, icon: Activity, tone: 'brand' },
    { value: 'businesses', label: 'Businesses', count: s?.businesses, icon: Building2, tone: 'amber' },
    { value: 'accounts', label: 'Accounts', count: s?.accounts, icon: UserX, tone: 'rose' },
    { value: 'admins', label: 'Admins', count: s?.admins, icon: Crown, tone: 'violet' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-brand-900 sm:text-3xl">Activity log</h1>
          <p className="mt-1 text-sm text-slate-500">Everything platform administrators did, with the reason they gave. Entries are permanent and cannot be edited.</p>
        </div>
        {s && <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-900/5"><span className="size-2 rounded-full bg-emerald-500" />{s.this_week} in the last 7 days</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {filters.map((f) => (
          <button key={f.value || 'all'} type="button" onClick={() => { setType(f.value); setPage(1); }} aria-pressed={type === f.value}
            className={cx('sp-rise flex items-center gap-3 rounded-2xl p-4 text-left ring-1 transition duration-200', type === f.value ? 'bg-white shadow-md ring-2 ring-brand-500' : 'bg-white/70 shadow-sm ring-slate-900/5 hover:bg-white')}>
            <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', TONES[f.tone])}><f.icon className="size-5" /></span>
            <span><span className="block font-display text-2xl font-bold leading-none text-slate-900">{f.count ?? '—'}</span><span className="mt-1 block text-xs font-medium text-slate-500">{f.label}</span></span>
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
        {list.error ? <div className="p-4"><ErrorBanner error={list.error} /></div> : list.isPending ? <Spinner /> : rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-slate-100 text-slate-400"><Activity className="size-6" /></span>
            <p className="mt-3 font-display font-semibold text-slate-900">No actions yet</p>
            <p className="mt-1 text-sm text-slate-500">Suspensions, account changes and admin changes appear here.</p>
          </div>
        ) : days.map((d) => (
          <div key={d.label}>
            <p className="sticky top-0 z-[1] flex items-center gap-2 border-y border-slate-100 bg-slate-50/90 px-5 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 backdrop-blur first:border-t-0">
              <CalendarDays className="size-3.5 text-brand-600" />{d.label}<span className="font-semibold normal-case tracking-normal text-slate-400">· {d.items.length}</span>
            </p>
            <ol className="relative px-5 py-2 before:absolute before:bottom-6 before:left-[2.6rem] before:top-6 before:w-px before:bg-slate-200">
              {d.items.map((e) => {
                const look = ACTIVITY[e.action] ?? { verb: () => e.action, icon: Activity, tone: 'bg-slate-100 text-slate-600 ring-slate-200', category: 'Other', chip: 'bg-slate-100 text-slate-600 ring-slate-200' };
                const vague = !!e.reason && reasonQuality(e.reason).level !== 'good';
                return (
                  <li key={e.id} className="sp-rise relative flex gap-4 py-3">
                    <span className={cx('relative z-[1] grid size-9 shrink-0 place-items-center rounded-full ring-4 ring-white', look.tone)}><look.icon className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                        <p className="text-sm text-slate-700">
                          <strong className="font-semibold text-slate-900">{e.by ?? 'An administrator'}</strong> {look.verb(e)} <strong className="font-semibold text-slate-900">{e.target ?? 'a record'}</strong>{suffix(e)}
                          {e.business && e.business !== e.target && <span className="text-slate-500"> · {e.business}</span>}
                        </p>
                        <span className="shrink-0 text-xs tabular-nums text-slate-400" title={formatDateTime(e.created_at)}>{new Date(e.created_at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className={cx('rounded-full px-2 py-px text-[10px] font-bold uppercase tracking-wide ring-1', look.chip)}>{look.category}</span>
                        {vague && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-px text-[10px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-amber-200"><AlertTriangle className="size-3" />Vague reason</span>}
                      </div>
                      {e.reason && (
                        <blockquote className={cx('mt-2 rounded-xl border-l-4 px-3 py-2 text-sm', vague ? 'border-amber-300 bg-amber-50/50 text-slate-600' : 'border-brand-300 bg-slate-50 text-slate-700')}>{e.reason}</blockquote>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
        <Pagination page={page} data={list.data} onPage={setPage} />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ Shared */

const TONES = { brand: 'bg-brand-50 text-brand-700', green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', sky: 'bg-sky-50 text-sky-700', violet: 'bg-violet-50 text-violet-700', rose: 'bg-rose-50 text-rose-700', slate: 'bg-slate-100 text-slate-600' };

function Stat({ icon: Icon, label, value, hint, tone = 'brand', featured }: { icon: LucideIcon; label: string; value: number; hint: string; tone?: keyof typeof TONES; featured?: boolean }) {
  return (
    <div className={cx('sp-rise relative overflow-hidden rounded-2xl p-5 shadow-sm ring-1', featured ? 'bg-gradient-to-br from-brand-700 to-brand-900 text-white ring-brand-900/20' : 'bg-white ring-slate-900/5')}>
      <div className="flex items-start justify-between">
        <p className={cx('text-xs font-semibold uppercase tracking-wider', featured ? 'text-brand-100/80' : 'text-slate-500')}>{label}</p>
        <span className={cx('grid size-9 place-items-center rounded-xl', featured ? 'bg-white/15 text-sun-300' : TONES[tone])}><Icon className="size-4" /></span>
      </div>
      <p className="mt-2 font-display text-3xl font-bold">{value}</p>
      <p className={cx('mt-0.5 text-xs', featured ? 'text-brand-100/70' : 'text-slate-500')}>{hint}</p>
    </div>
  );
}

function Card({ title, description, icon: Icon, tone, action, children }: { title: string; description: string; icon: LucideIcon; tone: keyof typeof TONES; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
      <div className="mb-3 flex items-start gap-3">
        <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', TONES[tone])}><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-bold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="rounded-2xl p-4 ring-1 ring-slate-200">
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-700"><Icon className="size-3.5" />{title}</h3>
      {children}
    </section>
  );
}

function Mini({ label, value, big }: { label: string; value: ReactNode; big?: boolean }) {
  return (
    <div className={cx('rounded-xl bg-slate-50 ring-1 ring-slate-100', big ? 'p-3' : 'px-2 py-2')}>
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className={cx('font-display font-bold text-slate-900', big ? 'mt-1 text-lg' : 'text-base')}>{value}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: 'active' | 'suspended' }) {
  return status === 'active'
    ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200"><span className="size-1.5 rounded-full bg-emerald-500" />Active</span>
    : <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200"><span className="size-1.5 rounded-full bg-amber-500" />Suspended</span>;
}

function AccountPill({ status }: { status: PlatformUser['status'] }) {
  const look = { active: 'bg-emerald-50 text-emerald-700 ring-emerald-200', pending: 'bg-sky-50 text-sky-700 ring-sky-200', disabled: 'bg-rose-50 text-rose-700 ring-rose-200' }[status];
  return <span className={cx('rounded-full px-2 py-px text-[10px] font-semibold ring-1', look)}>{status === 'pending' ? 'Not activated' : status === 'active' ? 'Active' : 'Disabled'}</span>;
}

function StatusDialog({ tenant, onClose }: { tenant: { id: number; name: string; status: 'active' | 'suspended' }; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const suspending = tenant.status === 'active';
  const save = useMutation({
    mutationFn: () => api(`/platform/tenants/${tenant.id}/status`, { method: 'PATCH', body: { status: suspending ? 'suspended' : 'active', reason: reason.trim() } }),
    onSuccess: () => {
      for (const key of ['platform-tenants', 'platform-tenant', 'platform-overview', 'platform-activity']) void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(suspending ? `${tenant.name} suspended.` : `${tenant.name} reactivated.`);
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={suspending ? `Suspend ${tenant.name}?` : `Reactivate ${tenant.name}?`} icon={suspending ? CirclePause : CircleCheck}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={suspending ? 'danger' : 'primary'} loading={save.isPending} disabled={reasonQuality(reason).level !== 'good'} onClick={() => save.mutate()}>{suspending ? 'Suspend business' : 'Reactivate business'}</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {suspending
            ? 'Everyone in this business, including the owner, loses access until it is reactivated. Their online shop closes too. Their data is kept.'
            : 'The owner and staff of this business can sign in and work again.'}
        </p>
        {save.error instanceof ApiError && <ErrorBanner error={save.error} />}
        <ReasonField value={reason} onChange={setReason}
          suggestions={suspending ? ['Unpaid subscription', 'Requested by the owner', 'Terms of service violation'] : ['Payment received', 'Issue resolved', 'Requested by the owner']}
          preview={`${suspending ? 'Suspended' : 'Reactivated'} ${tenant.name}`} />
      </div>
    </Modal>
  );
}
