import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, Building2, Crown, Layers, LogOut, MapPin, ShieldCheck, Store, Users } from 'lucide-react';
import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar, ErrorBanner, Spinner, cx } from '../../components/ui';
import { api } from '../../lib/api';
import type { Membership } from '../../lib/types';
import { AuthLayout, PanelFeature, PanelLogo } from './AuthLayout';

const LAST_KEY = 'smartpos.last-workspace';
const readLast = () => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } };
const remember = (value: string) => { try { localStorage.setItem(LAST_KEY, value); } catch { /* not remembered */ } };

/** Role colours, matching the Team page. */
const ROLE_TONE: Record<string, string> = {
  business_owner: 'bg-amber-50 text-amber-800 ring-amber-200', user_access_manager: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  branch_manager: 'bg-brand-50 text-brand-800 ring-brand-200', accountant: 'bg-teal-50 text-teal-800 ring-teal-200',
  auditor: 'bg-slate-100 text-slate-700 ring-slate-300', purchasing_staff: 'bg-violet-50 text-violet-700 ring-violet-200',
  inventory_staff: 'bg-orange-50 text-orange-800 ring-orange-200', cashier: 'bg-sky-50 text-sky-700 ring-sky-200',
  customer_service: 'bg-rose-50 text-rose-700 ring-rose-200', delivery_rider: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/**
 * Where to go after signing in: the businesses the user works at and, for platform administrators, the super admin
 * console. With exactly one business (and no console) it goes straight in.
 */
export function SelectBusinessPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const memberships = useQuery({
    queryKey: ['memberships'],
    queryFn: () => api<{ data: Membership[] }>('/me/memberships'),
  });
  const choices = [
    ...(user?.is_platform_admin ? [{ key: 'platform', to: '/platform' }] : []),
    ...(memberships.data?.data ?? []).filter((m) => m.status === 'active').map((m) => ({ key: `t${m.tenant_id}`, to: `/t/${m.tenant_id}` })),
  ];
  // Press 1, 2, 3… to open a place without the mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName))) return;
      const choice = choices[Number(e.key) - 1];
      if (choice) { remember(choice.key); navigate(choice.to); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (memberships.isPending) return <Spinner />;
  // Pending invitations grant no access until accepted, so only active memberships are listed here.
  const list = (memberships.data?.data ?? []).filter((m) => m.status === 'active');
  const admin = !!user?.is_platform_admin;
  if (list.length === 1 && !admin) return <Navigate to={`/t/${list[0].tenant_id}`} replace />;
  if (list.length === 0 && admin) return <Navigate to="/platform" replace />;

  const last = readLast();
  const go = (key: string, to: string) => { remember(key); navigate(to); };
  const firstName = (user?.name ?? '').split(' ')[0];
  const total = list.length + (admin ? 1 : 0);

  return (
    <AuthLayout
      title={`${greeting()}, ${firstName}`}
      subtitle={total > 1 ? `You have ${total} places to work. Where would you like to go?` : 'Where would you like to go?'}
      panel={
        <div className="auth-fade">
          <PanelLogo />
          <p className="mt-7 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-brand-50 ring-1 ring-white/20">
            <ShieldCheck className="size-3.5 text-sun-300" /> Signed in
          </p>
          <h2 className="mt-3 max-w-md font-display text-[1.95rem] font-bold leading-[1.15] tracking-tight xl:text-[2.2rem]">
            Welcome back, <span className="text-sun-400">{firstName}</span>.
          </h2>
          <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-brand-100/80">Pick up where you left off. You can switch any time from the menu under your name.</p>
          <ul className="mt-6 grid max-w-md gap-2.5">
            {admin && <PanelFeature icon={<Crown />} title="Super admin console" text="Every business, accounts, admins and the activity log." />}
            {list.slice(0, admin ? 2 : 3).map((m) => (
              <PanelFeature key={m.id} icon={<Store />} title={m.tenant?.name ?? 'Business'} text={m.roles?.map((r) => r.name).join(', ') || 'Team member'} />
            ))}
          </ul>
        </div>
      }
      footer={
        <span className="flex flex-col items-center gap-3">
        <span className="hidden items-center gap-1.5 text-xs text-slate-400 sm:inline-flex">Tip: press <Kbd n={1} /> {total > 1 && <>or <Kbd n={2} /></>} to open a place</span>
        <span className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span className="text-slate-400">Not you?</span>
          <button type="button" onClick={async () => { await logout(); navigate('/login'); }} className="inline-flex items-center gap-1.5 font-semibold text-rose-600 hover:text-rose-700">
            <LogOut className="size-4" /> Sign out
          </button>
        </span>
        </span>
      }
    >
      <div className="space-y-5">
        {user && (
          <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
            <span className="[&>span]:size-11 [&>span]:text-sm"><Avatar name={user.name} /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-slate-900">{user.name}</p>
              <p className="truncate text-xs text-slate-500">{user.email ?? user.username}</p>
            </div>
            {admin && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sun-300/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800"><Crown className="size-3" />Admin</span>}
          </div>
        )}

        <ErrorBanner error={memberships.error} />

        {admin && (
          <button type="button" onClick={() => go('platform', '/platform')}
            className="sp-rise group relative w-full overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-800 to-[#082419] p-4 text-left text-white shadow-lg shadow-brand-900/20 ring-1 ring-brand-900/20 transition duration-200 hover:-translate-y-0.5 hover:shadow-xl">
            <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-sun-400/25 blur-2xl" />
            <span className="relative flex items-center gap-3.5">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sun-300 to-sun-500 text-brand-900 shadow-md"><Crown className="size-6" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-display text-base font-bold">Super admin console</span>
                  {last === 'platform' && <LastUsed dark />}
                </span>
                <span className="mt-0.5 block text-xs text-brand-100/80">Manage the whole platform</span>
              </span>
              <Kbd n={1} dark />
              <ArrowRight className="size-5 shrink-0 text-sun-300 transition group-hover:translate-x-1" />
            </span>
            <span className="relative mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold">
              {[[Building2, 'Businesses'], [Users, 'Accounts & admins'], [Activity, 'Activity log']].map(([Icon, label]) => {
                const I = Icon as typeof Building2;
                return <span key={label as string} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 ring-1 ring-white/15"><I className="size-3 text-sun-300" />{label as string}</span>;
              })}
            </span>
          </button>
        )}

        {list.length > 0 && (
          <div>
            {admin && <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Your {list.length === 1 ? 'business' : 'businesses'}</p>}
            <ul className="space-y-2.5">
              {list.map((m, i) => {
                const key = `t${m.tenant_id}`;
                const role = m.roles?.[0];
                return (
                  <li key={m.id} className="sp-rise" style={{ animationDelay: `${(i + 1) * 50}ms` }}>
                    <button type="button" onClick={() => go(key, `/t/${m.tenant_id}`)}
                      className="group flex w-full items-center gap-3.5 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition duration-200 hover:-translate-y-0.5 hover:shadow-md hover:ring-brand-300">
                      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 font-display text-lg font-bold text-white shadow-sm">{(m.tenant?.name ?? '?').charAt(0)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-display text-base font-bold text-slate-900">{m.tenant?.name}</span>
                          {last === key && <LastUsed />}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          {(m.roles ?? []).map((r) => <span key={r.id} className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1', ROLE_TONE[r.key] ?? 'bg-slate-100 text-slate-700 ring-slate-200')}>{r.name}</span>)}
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                            {m.all_branches ? <><Layers className="size-3 text-brand-600" />All branches</> : m.branches?.length ? <><MapPin className="size-3 text-brand-600" />{m.branches.map((b) => b.name).join(', ')}</> : null}
                          </span>
                        </span>
                      </span>
                      <Kbd n={i + 1 + (admin ? 1 : 0)} />
                      <span className={cx('grid size-9 shrink-0 place-items-center rounded-full transition duration-200', role ? 'bg-slate-50 text-slate-400 group-hover:bg-brand-600 group-hover:text-white' : 'bg-slate-50 text-slate-400')}><ArrowRight className="size-4" /></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {list.length === 0 && !admin && (
          <div className="sp-rise rounded-2xl bg-slate-50 p-6 text-center ring-1 ring-slate-100">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-slate-400 ring-1 ring-slate-200"><Store className="size-6" /></span>
            <p className="mt-3 font-display font-semibold text-slate-900">You are not part of a business yet</p>
            <p className="mt-1 text-sm text-slate-500">Ask a business owner to add you. If you were invited, check your email for the invitation.</p>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}

function Kbd({ n, dark }: { n: number; dark?: boolean }) {
  return <kbd className={cx('hidden min-w-6 rounded-md px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold shadow-[inset_0_-1px_0] sm:inline-block', dark ? 'bg-white/10 text-brand-50 shadow-white/20 ring-1 ring-white/15' : 'bg-white text-slate-500 shadow-slate-300 ring-1 ring-slate-200')}>{n}</kbd>;
}

function LastUsed({ dark }: { dark?: boolean }) {
  return <span className={cx('rounded-full px-2 py-px text-[10px] font-bold uppercase tracking-wide', dark ? 'bg-sun-400 text-brand-900' : 'bg-emerald-100 text-emerald-800')}>Last used</span>;
}
