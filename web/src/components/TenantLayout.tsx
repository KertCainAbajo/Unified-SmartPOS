import { BranchSwitcher } from './BranchSwitcher';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Boxes,
  CalendarDays,
  ClipboardList,
  Clock,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Receipt,
  RotateCcw,
  Settings,
  ShoppingCart,
  Tags,
  Truck,
  UserRound,
  Users,
  Wallet,
  X,
  UserPlus,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { api, ApiError } from '../lib/api';
import type { AppNotification, Paginated } from '../lib/types';
import { TenantProvider, useTenant, useTenantContextQuery } from '../tenant/TenantProvider';
import { BrandLogo } from './BrandLogo';
import { ErrorBanner, Spinner, cx } from './ui';
import { NotificationsPanel } from './NotificationsPanel';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Visible when the member holds any of these permissions (empty = always). */
  any: string[];
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Selling',
    items: [
      { to: '', label: 'Dashboard', icon: <LayoutDashboard />, any: [] },
      { to: 'pos', label: 'Point of Sale', icon: <ShoppingCart />, any: ['sales.create'] },
      { to: 'sales', label: 'Sales', icon: <Receipt />, any: ['sales.view', 'sales.view_all'] },
      { to: 'refunds', label: 'Refunds', icon: <RotateCcw />, any: ['refunds.create', 'refunds.approve'] },
      { to: 'shifts', label: 'Shifts', icon: <Clock />, any: ['shifts.operate', 'shifts.view_all'] },
      { to: 'customers', label: 'Customers', icon: <UserRound />, any: ['customers.view'] },
    ],
  },
  {
    section: 'Stock',
    items: [
      { to: 'products', label: 'Products', icon: <Package />, any: ['products.view'] },
      { to: 'categories', label: 'Categories', icon: <Tags />, any: ['products.view'] },
      { to: 'inventory', label: 'Inventory', icon: <Boxes />, any: ['inventory.view'] },
      { to: 'transfers', label: 'Transfers', icon: <ArrowLeftRight />, any: ['inventory.view'] },
      { to: 'purchasing', label: 'Purchasing', icon: <Truck />, any: ['purchasing.view', 'suppliers.view'] },
    ],
  },
  {
    section: 'Business',
    items: [
      { to: 'expenses', label: 'Expenses', icon: <Wallet />, any: ['expenses.view'] },
      { to: 'reports', label: 'Reports', icon: <BarChart3 />, any: ['reports.view', 'reports.financial'] },
      { to: 'audit', label: 'Audit log', icon: <ClipboardList />, any: ['audit_logs.view'] },
      { to: 'recruitment', label: 'Recruitment', icon: <UserPlus />, any: ['recruitment.view'] },
      { to: 'team', label: 'Team', icon: <Users />, any: ['staff.view'] },
      { to: 'settings', label: 'Settings', icon: <Settings />, any: ['tenant.manage', 'branches.manage', 'registers.manage'] },
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

function Shell() {
  const { tenant, tenantId, permissions, path, roles, viewAll, branch } = useTenant();
  const location = useLocation();
  // Switching branch remounts the page so paging and half-filled forms start fresh (except the POS cart).
  const scopeKey = location.pathname.endsWith('/pos') ? 'pos' : viewAll ? 'all' : `b${branch?.id ?? ''}`;
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const unread = useQuery({
    queryKey: ['t', tenantId, 'notifications-unread'],
    queryFn: () => api<Paginated<AppNotification>>(path('/notifications'), { query: { unread: 1, per_page: 1 } }),
    refetchInterval: 60_000,
  });
  const unreadCount = unread.data?.total ?? 0;

  const visible = NAV.map((s) => ({ ...s, items: s.items.filter((i) => i.any.length === 0 || i.any.some((p) => permissions.has(p))) })).filter(
    (s) => s.items.length > 0,
  );
  const roleLabel = roles.map((r) => ROLE_LABELS[r] ?? r.replaceAll('_', ' ')).join(', ');
  const initials = (user?.name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  const signOut = async () => {
    await logout();
    navigate('/login');
  };

  const sidebar = (
    <nav className="relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-brand-800 via-brand-900 to-[#0b2619] text-white" aria-label="Main">
      {/* Warm glow echoing the logo's sunrise. */}
      <div className="pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-sun-400/15 blur-3xl" />

      <Link to={`/t/${tenantId}`} className="relative mx-3 mt-4 flex items-center gap-3 rounded-2xl p-2 transition hover:bg-white/5" onClick={() => setMobileOpen(false)}>
        <span className="w-12 shrink-0 rounded-xl bg-cream p-1 shadow-lg shadow-black/20 ring-1 ring-white/20"><BrandLogo /></span>
        <span className="min-w-0">
          <span className="line-clamp-2 block font-display text-[0.95rem] font-semibold leading-tight">{tenant.name}</span>
          <span className="block text-[11px] text-brand-100/60">Unified SmartPOS</span>
        </span>
      </Link>

      <div className="relative mt-4 flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {visible.map((section) => (
          <div key={section.section}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-100/40">{section.section}</p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to === '' ? `/t/${tenantId}` : `/t/${tenantId}/${item.to}`}
                    end={item.to === ''}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cx(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition [&_svg]:size-[1.05rem]',
                        isActive ? 'bg-white/10 text-white shadow-inner shadow-black/10' : 'text-brand-100/70 hover:bg-white/5 hover:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-sun-400 shadow-[0_0_10px] shadow-sun-400/60" />}
                        <span className={cx('transition', isActive ? 'text-sun-300' : 'text-brand-100/50 group-hover:text-brand-100')}>{item.icon}</span>
                        {item.label}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="relative border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-2xl bg-white/[0.06] p-2.5 ring-1 ring-white/10">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sun-300 to-sun-500 font-display text-sm font-bold text-brand-900">{initials}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{user?.name}</span>
            <span className="block truncate text-[11px] text-brand-100/60">{roleLabel}</span>
          </span>
          <button type="button" onClick={signOut} className="grid size-8 place-items-center rounded-lg text-brand-100/70 transition hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full bg-[#f6f7f2]">
      <aside className="hidden w-64 shrink-0 lg:block print:hidden">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden">
          <div className="absolute inset-0 bg-brand-900/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72">
            <button className="absolute right-3 top-5 z-10 text-brand-100/70" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200/70 bg-white/80 px-4 backdrop-blur-md sm:px-6 print:hidden">
          <button className="grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>

          <BranchSwitcher />

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
          <div className="mx-auto w-full max-w-[1920px] px-4 py-6 sm:px-6 lg:px-8 2xl:px-10">
            <Outlet key={scopeKey} />
          </div>
        </main>
      </div>

      <NotificationsPanel open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    </div>
  );
}
