import { useQuery } from '@tanstack/react-query';
import {
  Bike,
  ArrowLeftRight,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  CalendarDays,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  ClipboardList,
  Clock,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Settings,
  ShoppingCart,
  ShoppingBag,
  Tags,
  Truck,
  UserCog,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { api, ApiError } from '../lib/api';
import { useTenantQuery } from '../lib/hooks';
import type { AppNotification, Paginated } from '../lib/types';
import { TenantProvider, useTenant, useTenantContextQuery } from '../tenant/TenantProvider';
import { BranchSwitcher } from './BranchSwitcher';
import { BrandLogo } from './BrandLogo';
import { NotificationsPanel } from './NotificationsPanel';
import { ErrorBanner, Spinner, cx } from './ui';

type BadgeKey = 'refunds' | 'lowStock' | 'shift';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Visible when the member holds any of these permissions (empty = always). */
  any: string[];
  /** Live counter shown next to the label. */
  badge?: BadgeKey;
  /** Extra words the menu search matches. */
  keywords?: string;
  /** Further rule on top of `any`, e.g. hide rider screens from owners who hold every permission. */
  show?: (has: (permission: string) => boolean) => boolean;
}

/** Riders sign in only to deliver: they skip the store dashboard and go straight to their deliveries. */
export const isRiderOnly = (has: (permission: string) => boolean) =>
  has('deliveries.ride') && !has('sales.create') && !has('sales.view') && !has('sales.view_all') && !has('products.view');

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Selling',
    items: [
      { to: '', label: 'Dashboard', icon: LayoutDashboard, any: [], keywords: 'home overview', show: (has) => !isRiderOnly(has) },
      { to: 'deliveries', label: 'My deliveries', icon: Bike, any: ['deliveries.ride'], keywords: 'rider delivery map route', show: (has) => !has('tenant.manage') && !has('branches.manage') },
      { to: 'pos', label: 'Point of Sale', icon: ShoppingCart, any: ['sales.create'], badge: 'shift', keywords: 'register checkout sell cashier' },
      { to: 'online-orders', label: 'Online orders', icon: ShoppingBag, any: ['sales.view_all', 'sales.create'], keywords: 'pickup delivery shop customer orders' },
      { to: 'sales', label: 'Sales', icon: Receipt, any: ['sales.view', 'sales.view_all'], keywords: 'receipts transactions' },
      { to: 'refunds', label: 'Refunds', icon: RotateCcw, any: ['refunds.create', 'refunds.approve'], badge: 'refunds', keywords: 'returns' },
      { to: 'shifts', label: 'Shifts', icon: Clock, any: ['shifts.operate', 'shifts.view_all'], keywords: 'register sessions cash' },
      { to: 'customers', label: 'Customers', icon: UserRound, any: ['customers.view'], keywords: 'clients' },
    ],
  },
  {
    section: 'Stock',
    items: [
      { to: 'products', label: 'Products', icon: Package, any: ['products.view'], keywords: 'items catalog price' },
      { to: 'categories', label: 'Categories', icon: Tags, any: ['products.view'] },
      { to: 'inventory', label: 'Inventory', icon: Boxes, any: ['inventory.view'], badge: 'lowStock', keywords: 'stock count adjust' },
      { to: 'transfers', label: 'Transfers', icon: ArrowLeftRight, any: ['inventory.view'], keywords: 'move stock branches' },
      { to: 'purchasing', label: 'Purchasing', icon: Truck, any: ['purchasing.view', 'suppliers.view'], keywords: 'purchase orders suppliers receive' },
    ],
  },
  {
    section: 'Business',
    items: [
      { to: 'expenses', label: 'Expenses', icon: Wallet, any: ['expenses.view'], keywords: 'costs bills' },
      { to: 'reports', label: 'Reports', icon: BarChart3, any: ['reports.view', 'reports.financial'], keywords: 'profit analytics' },
      { to: 'audit', label: 'Audit log', icon: ClipboardList, any: ['audit_logs.view'], keywords: 'history activity' },
      { to: 'recruitment', label: 'Recruitment', icon: UserPlus, any: ['recruitment.view'], keywords: 'hiring applicants jobs vacancies' },
      { to: 'team', label: 'Team', icon: Users, any: ['staff.view'], keywords: 'staff employees roles' },
      { to: 'settings', label: 'Settings', icon: Settings, any: ['tenant.manage', 'branches.manage', 'registers.manage'], keywords: 'branches registers business' },
    ],
  },
];

/** Resolves /t/:tenantId, loads the member's context, and renders the app frame. */
export function TenantLayout() {
  const params = useParams();
  const tenantId = Number(params.tenantId);
  const context = useTenantContextQuery(tenantId);

  if (context.isPending) return <Spinner label="Loading business…" />;
  if (context.error) {
    const notFound = context.error instanceof ApiError && context.error.status === 404;
    return (
      <div className="mx-auto mt-24 max-w-md space-y-4 px-4 text-center">
        <ErrorBanner error={notFound ? new Error('This business was not found, or you are not a member of it.') : context.error} />
        <Link to="/" className="text-sm font-medium text-brand-700 hover:underline">
          Choose another business
        </Link>
      </div>
    );
  }

  return (
    <TenantProvider data={context.data} tenantId={tenantId}>
      <Shell />
    </TenantProvider>
  );
}

const ROLE_LABELS: Record<string, string> = {
  business_owner: 'Owner',
  user_access_manager: 'HR · User & Access',
  branch_manager: 'Branch Manager',
  cashier: 'Cashier',
  inventory_staff: 'Inventory Staff',
  accountant: 'Accountant',
  purchasing_staff: 'Purchasing',
  auditor: 'Auditor',
  customer_service: 'Customer Service',
};

const COLLAPSE_KEY = 'smartpos.sidebar-collapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
};

const totalOf = (p?: { meta?: { total: number }; total?: number }) => p?.meta?.total ?? p?.total ?? 0;

/** Small live counters for the menu: pending refunds, low stock, open shift. */
function useNavBadges() {
  const { can, scopeBranchId } = useTenant();
  const refunds = useTenantQuery<Paginated<unknown>>('/refunds', { status: 'pending_approval', branch_id: scopeBranchId, per_page: 1 }, { enabled: can('refunds.approve') });
  const low = useTenantQuery<Paginated<unknown>>('/inventory/low-stock', { branch_id: scopeBranchId, per_page: 1 }, { enabled: can('inventory.view') });
  const shift = useTenantQuery<{ data: { id: number } | null }>('/register-sessions/current', undefined, { enabled: can('shifts.operate') });
  return {
    refunds: totalOf(refunds.data),
    lowStock: totalOf(low.data),
    shift: shift.data?.data ? 1 : 0,
  } satisfies Record<BadgeKey, number>;
}

function Shell() {
  const { tenant, tenantId, permissions, path, roles, viewAll, branch, branches, can } = useTenant();
  const location = useLocation();
  // Switching branch remounts the page so paging and half-filled forms start fresh (except the POS cart).
  const scopeKey = location.pathname.endsWith('/pos') ? 'pos' : viewAll ? 'all' : `b${branch?.id ?? ''}`;
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const [filter, setFilter] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const badges = useNavBadges();

  const unread = useQuery({
    queryKey: ['t', tenantId, 'notifications-unread'],
    queryFn: () => api<Paginated<AppNotification>>(path('/notifications'), { query: { unread: 1, per_page: 1 } }),
    refetchInterval: 60_000,
  });
  const unreadCount = unread.data?.total ?? 0;

  const setCollapsed = (v: boolean) => {
    setCollapsedState(v);
    try {
      localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0');
    } catch {
      // Not remembered in private mode.
    }
  };

  // Ctrl/⌘+K jumps to the menu search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (window.innerWidth < 1024) setMobileOpen(true);
        else setCollapsed(false);
        setTimeout(() => searchRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close the user menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !userRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);

  // Close the drawer and the user menu after navigating.
  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  const allowed = NAV.map((s) => ({ ...s, items: s.items.filter((i) => (i.any.length === 0 || i.any.some((p) => permissions.has(p))) && (!i.show || i.show((p) => permissions.has(p)))) })).filter((s) => s.items.length > 0);
  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? allowed.map((s) => ({ ...s, items: s.items.filter((i) => `${i.label} ${i.keywords ?? ''}`.toLowerCase().includes(needle)) })).filter((s) => s.items.length > 0)
    : allowed;

  const segment = location.pathname.split('/')[3] ?? '';
  const current = allowed.flatMap((s) => s.items.map((i) => ({ ...i, section: s.section }))).find((i) => i.to === segment);

  const roleLabel = roles.map((r) => ROLE_LABELS[r] ?? r.replaceAll('_', ' ')).join(', ');
  const initials = (user?.name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  const signOut = async () => {
    await logout();
    navigate('/login');
  };
  const href = (to: string) => (to === '' ? `/t/${tenantId}` : `/t/${tenantId}/${to}`);

  const sidebar = (mini: boolean) => (
    <nav className="relative flex h-full flex-col bg-gradient-to-b from-brand-800 via-brand-900 to-[#0b2619] text-white" aria-label="Main">
      {/* Warm glow echoing the logo's sunrise, plus a faint texture. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-sun-400/15 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.035]" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '14px 14px' }} />
      </div>

      {/* Brand */}
      <div className={cx('relative flex items-center gap-2 pt-4', mini ? 'flex-col px-2' : 'px-3')}>
        <Link to={href('')} className={cx('flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-2 transition hover:bg-white/5', mini && 'justify-center')} title={tenant.name}>
          <span className={cx('shrink-0 rounded-xl bg-cream p-1 shadow-lg shadow-black/20 ring-1 ring-white/20', mini ? 'w-10' : 'w-11')}><BrandLogo /></span>
          {!mini && (
            <span className="min-w-0">
              <span className="line-clamp-2 block font-display text-[0.95rem] font-semibold leading-tight">{tenant.name}</span>
              <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-brand-100/60">
                <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400" /> Unified SmartPOS
              </span>
            </span>
          )}
        </Link>
      </div>

      {/* Quick actions */}
      <div className={cx('relative mt-3 space-y-2', mini ? 'px-2' : 'px-3')}>
        {can('sales.create') && (
          <Link
            to={href('pos')}
            title="New sale"
            className={cx(
              'group flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sun-300 to-sun-400 font-semibold text-brand-900 shadow-lg shadow-black/20 transition hover:from-sun-300 hover:to-sun-300',
              mini ? 'w-full' : 'text-sm',
            )}
          >
            <Plus className="size-4 transition group-hover:rotate-90" />
            {!mini && 'New sale'}
          </Link>
        )}
        {!mini && (
          <label className="flex h-9 items-center gap-2 rounded-xl bg-white/[0.06] px-3 ring-1 ring-white/10 transition focus-within:bg-white/10 focus-within:ring-sun-300/50">
            <Search className="size-3.5 shrink-0 text-brand-100/50" />
            <input
              ref={searchRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setFilter('');
                if (e.key === 'Enter' && visible[0]?.items[0]) {
                  navigate(href(visible[0].items[0].to));
                  setFilter('');
                }
              }}
              placeholder="Jump to…"
              aria-label="Search menu"
              className="h-full min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-brand-100/40"
            />
            {filter ? (
              <button type="button" onClick={() => setFilter('')} aria-label="Clear" className="text-brand-100/50 hover:text-white"><X className="size-3.5" /></button>
            ) : (
              <kbd className="rounded border border-white/15 px-1 font-sans text-[10px] text-brand-100/50">Ctrl K</kbd>
            )}
          </label>
        )}
      </div>

      {/* Menu */}
      <div className={cx('relative mt-3 flex-1 space-y-3 overflow-y-auto overscroll-contain pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', mini ? 'px-2' : 'px-3')}>
        {visible.length === 0 && <p className="px-3 py-6 text-center text-xs text-brand-100/50">No menu items match “{filter}”.</p>}
        {visible.map((section) => (
          <div key={section.section}>
            {mini ? (
              <div className="mx-auto mb-2 h-px w-6 bg-white/10" />
            ) : (
              <p className="flex items-center gap-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-100/40">
                {section.section}
                <span className="h-px flex-1 bg-white/[0.06]" />
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const count = item.badge ? badges[item.badge] : 0;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={href(item.to)}
                      end={item.to === ''}
                      title={mini ? item.label : undefined}
                      onClick={() => setFilter('')}
                      className={({ isActive }) =>
                        cx(
                          'group relative flex items-center gap-3 rounded-xl text-sm font-medium transition',
                          mini ? 'justify-center p-1' : 'px-2 py-1',
                          isActive ? 'bg-gradient-to-r from-white/[0.14] to-white/[0.04] text-white ring-1 ring-white/10' : 'text-brand-100/70 hover:bg-white/[0.06] hover:text-white',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className={cx('absolute top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-sun-400 shadow-[0_0_10px] shadow-sun-400/60', mini ? '-left-2' : '-left-3')} />}
                          <span
                            className={cx(
                              'relative grid size-7 shrink-0 place-items-center rounded-lg transition [&_svg]:size-4',
                              isActive ? 'bg-sun-400/15 text-sun-300' : 'text-brand-100/50 group-hover:bg-white/[0.06] group-hover:text-brand-50',
                            )}
                          >
                            <item.icon />
                            {mini && count > 0 && <span className={cx('absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-brand-900', item.badge === 'shift' ? 'bg-emerald-400' : 'bg-amber-400')} />}
                          </span>
                          {!mini && <span className="flex-1 truncate">{item.label}</span>}
                          {!mini && count > 0 && (
                            item.badge === 'shift' ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> Open
                              </span>
                            ) : (
                              <span className="min-w-5 rounded-full bg-amber-400/20 px-1.5 py-0.5 text-center text-[10px] font-bold tabular-nums text-amber-200 ring-1 ring-amber-300/30">{count > 99 ? '99+' : count}</span>
                            )
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* User */}
      <div ref={userRef} className={cx('relative border-t border-white/10', mini ? 'p-2' : 'p-3')}>
        {menuOpen && (
          <div className={cx('auth-fade absolute z-50 w-60', mini ? 'bottom-2 left-full ml-3' : 'bottom-full left-3 right-3 mb-2 w-auto')}>
          <div className=" overflow-hidden rounded-2xl bg-white p-1.5 text-slate-700 shadow-2xl shadow-black/30 ring-1 ring-slate-900/10">
            <div className="px-3 py-2">
              <p className="truncate text-sm font-semibold text-slate-900">{user?.name}</p>
              <p className="truncate text-xs text-slate-500">{user?.email ?? roleLabel}</p>
            </div>
            <div className="mx-1 mb-1 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <Building2 className="size-3.5 text-brand-600" />
              <span className="truncate">{viewAll ? `All ${branches.length} branches` : branch?.name}</span>
            </div>
            <Link to={`${href('settings')}?tab=account`} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition hover:bg-slate-50">
              <UserCog className="size-4 text-slate-400" /> Account & security
            </Link>
            <Link to="/" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition hover:bg-slate-50">
              <ChevronsUpDown className="size-4 text-slate-400" /> Switch business
            </Link>
            <button type="button" onClick={signOut} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-rose-600 transition hover:bg-rose-50">
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          title={mini ? `${user?.name} · ${roleLabel}` : undefined}
          className={cx('flex w-full items-center gap-3 rounded-2xl text-left ring-1 transition', mini ? 'justify-center p-1.5' : 'p-2.5', menuOpen ? 'bg-white/10 ring-white/20' : 'bg-white/[0.06] ring-white/10 hover:bg-white/10')}
          aria-expanded={menuOpen}
        >
          <span className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sun-300 to-sun-500 font-display text-sm font-bold text-brand-900">
            {initials}
            <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-brand-900" />
          </span>
          {!mini && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{user?.name}</span>
                <span className="block truncate text-[11px] text-brand-100/60">{roleLabel}</span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-brand-100/50" />
            </>
          )}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full bg-[#f6f7f2]">
      <aside className={cx('relative z-30 hidden shrink-0 transition-[width] duration-300 lg:block print:hidden', collapsed ? 'w-[4.75rem]' : 'w-[17rem]')}>
        {sidebar(collapsed)}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
          className="absolute -right-3 top-20 z-30 grid size-6 place-items-center rounded-full bg-white text-brand-700 shadow-md ring-1 ring-slate-900/10 transition hover:scale-110 hover:text-brand-900"
        >
          {collapsed ? <ChevronsRight className="size-3.5" /> : <ChevronsLeft className="size-3.5" />}
        </button>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden">
          <div className="absolute inset-0 bg-brand-900/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="auth-fade absolute inset-y-0 left-0 w-72 shadow-2xl">
            <button className="absolute right-3 top-5 z-10 grid size-8 place-items-center rounded-lg text-brand-100/70 hover:bg-white/10" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200/70 bg-white/80 px-4 backdrop-blur-md sm:px-6 print:hidden">
          <button className="grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>

          <BranchSwitcher />

          {current && (
            <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 text-sm xl:flex">
              <span className="mx-1 h-5 w-px bg-slate-200" />
              <span className="text-slate-400">{current.section}</span>
              <ChevronRight className="size-3.5 text-slate-300" />
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                <current.icon className="size-4 text-brand-600" />
                {current.label}
              </span>
            </nav>
          )}

          <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
            <span className="hidden items-center gap-2 rounded-full bg-slate-100/80 px-3 py-1.5 text-xs font-medium text-slate-600 md:flex">
              <CalendarDays className="size-3.5 text-brand-600" />
              {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
            <button
              className="relative grid size-10 place-items-center rounded-full text-slate-600 transition hover:bg-slate-100"
              onClick={() => setNotificationsOpen(true)}
              aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
            >
              <Bell className="size-5" />
              {unreadCount > 0 && (
                <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 font-display text-xs font-bold text-white shadow-sm lg:hidden" title={user?.name}>{initials}</span>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div key={location.pathname} className="auth-fade mx-auto w-full max-w-[1920px] px-4 py-6 sm:px-6 lg:px-8 2xl:px-10">
            <Outlet key={scopeKey} />
          </div>
        </main>
      </div>

      <NotificationsPanel open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    </div>
  );
}
