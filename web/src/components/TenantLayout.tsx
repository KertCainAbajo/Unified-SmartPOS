import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Boxes,
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
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { api, ApiError } from '../lib/api';
import type { AppNotification, Paginated } from '../lib/types';
import { TenantProvider, useTenant, useTenantContextQuery } from '../tenant/TenantProvider';
import { Button, ErrorBanner, Spinner, cx } from './ui';
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
        <Link to="/" className="text-sm font-medium text-teal-700 hover:underline">
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

function Shell() {
  const { tenant, tenantId, branches, branch, setBranchId, permissions, path } = useTenant();
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

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5" aria-label="Main">
      <Link to={`/t/${tenantId}`} className="flex items-center gap-2 px-2" onClick={() => setMobileOpen(false)}>
        <span className="grid size-8 place-items-center rounded-lg bg-teal-700 text-sm font-bold text-white">SP</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-white">{tenant.name}</span>
          <span className="block text-xs text-slate-400">Unified SmartPOS</span>
        </span>
      </Link>
      {visible.map((section) => (
        <div key={section.section}>
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{section.section}</p>
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to === '' ? `/t/${tenantId}` : `/t/${tenantId}/${item.to}`}
                  end={item.to === ''}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cx(
                      'flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium [&_svg]:size-4',
                      isActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
                    )
                  }
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 bg-slate-900 lg:block print:hidden">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-slate-900">
            <button className="absolute right-3 top-4 text-slate-400" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 print:hidden">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5 text-slate-600" />
          </button>

          <label className="flex items-center gap-2 text-sm text-slate-500">
            <span className="hidden sm:inline">Branch</span>
            <select
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800"
              value={branch?.id ?? ''}
              onChange={(e) => setBranchId(Number(e.target.value))}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          <div className="ml-auto flex items-center gap-2">
            <button
              className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
              onClick={() => setNotificationsOpen(true)}
              aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
            >
              <Bell className="size-5" />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <span className="hidden text-sm text-slate-600 sm:inline">{user?.name}</span>
            <Button
              variant="ghost"
              size="sm"
              icon={<LogOut className="size-4" />}
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            <Outlet />
          </div>
        </main>
      </div>

      <NotificationsPanel open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    </div>
  );
}
