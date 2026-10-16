import { BranchTag } from '../components/BranchSwitcher';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CalendarRange,
  CheckCircle2,
  Coins,
  CreditCard,
  Package,
  PackageSearch,
  Receipt,
  RotateCcw,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Badge } from '../components/ui';
import { firstOfMonthManila, formatDateTime, formatMoney, formatQty, titleCase, todayManila } from '../lib/format';
import { useTenantQuery } from '../lib/hooks';
import type { Paginated, ReportResponse, Sale } from '../lib/types';
import { useTenant } from '../tenant/TenantProvider';

interface SummaryRow {
  period: string;
  transactions: number;
  net_sales: string;
  refunds: string;
  net_after_refunds: string;
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** Store overview: today's numbers, what sells, what is running low and the latest sales. */
export function DashboardPage() {
  const { can, branch, viewAll, scopeBranchId, branches, tenant, tenantId } = useTenant();
  const { user } = useAuth();
  const today = todayManila();
  const scope = { branch_id: scopeBranchId };
  const canReports = can('reports.view');
  const canSales = can('sales.view') || can('sales.view_all');
  const base = `/t/${tenantId}`;

  const todaySummary = useTenantQuery<ReportResponse<SummaryRow[]>>('/reports/sales-summary', { ...scope, date_from: today, date_to: today }, { enabled: canReports });
  const monthSummary = useTenantQuery<ReportResponse<SummaryRow[]>>('/reports/sales-summary', { ...scope, date_from: firstOfMonthManila(), date_to: today, group_by: 'month' }, { enabled: canReports });
  const methods = useTenantQuery<ReportResponse<{ method: string; payments: number; net: string }[]>>('/reports/sales-by-payment-method', { ...scope, date_from: today, date_to: today }, { enabled: canReports });
  const best = useTenantQuery<ReportResponse<{ product_id: number; name: string; net_quantity: string; revenue: string }[]>>('/reports/best-sellers', { ...scope, date_from: firstOfMonthManila(), date_to: today, limit: 5 }, { enabled: canReports });
  const lowStock = useTenantQuery<Paginated<{ branch_id: number; product_id: number; name: string; sku: string; quantity: string; reorder_level: string; unit: string }>>('/inventory/low-stock', { ...scope, per_page: 6 }, { enabled: can('inventory.view') });
  const recent = useTenantQuery<Paginated<Sale>>('/sales', { ...scope, per_page: 6 }, { enabled: canSales });

  const t = todaySummary.data?.data[0];
  const m = monthSummary.data?.data[0];
  const lowCount = lowStock.data?.total ?? 0;
  const firstName = (user?.name ?? '').split(' ')[0];

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-6 text-white shadow-xl shadow-brand-900/15 sm:p-8">
        <div className="pointer-events-none absolute -right-10 -top-24 size-80 rounded-full bg-sun-400/25 blur-3xl" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: 'repeating-conic-gradient(from 0deg at 85% -20%, #fff 0deg 1.5deg, transparent 1.5deg 9deg)' }}
        />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-brand-50 ring-1 ring-white/15">
              <Sparkles className="size-3.5 text-sun-300" /> {tenant.name} · {viewAll ? `All ${branches.length} branches` : branch?.name ?? 'All branches'}
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {greeting()}, <span className="text-sun-300">{firstName}</span>
            </h1>
            <p className="mt-1.5 text-sm text-brand-100/80">
              {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} — here's how the store is doing.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {can('sales.create') && (
              <Link to={`${base}/pos`} className="inline-flex h-11 items-center gap-2 rounded-xl bg-sun-400 px-5 text-sm font-semibold text-brand-900 shadow-lg shadow-black/15 transition hover:bg-sun-300">
                <ShoppingCart className="size-4" /> Open POS
              </Link>
            )}
            {canSales && (
              <Link to={`${base}/sales`} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/15">
                <Receipt className="size-4" /> Sales
              </Link>
            )}
            {(can('reports.view') || can('reports.financial')) && (
              <Link to={`${base}/reports`} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/15">
                <BarChart3 className="size-4" /> Reports
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Key numbers */}
      {(canReports || can('inventory.view')) && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {canReports && (
            <>
              <Kpi icon={<Wallet />} tone="green" label="Today's net sales" value={formatMoney(t?.net_after_refunds ?? '0.00')} hint={`${t?.transactions ?? 0} transactions`} loading={todaySummary.isPending} />
              <Kpi icon={<RotateCcw />} tone="rose" label="Today's refunds" value={formatMoney(t?.refunds ?? '0.00')} hint="Returned to customers" loading={todaySummary.isPending} />
              <Kpi icon={<CalendarRange />} tone="sun" label="Month to date" value={formatMoney(m?.net_after_refunds ?? '0.00')} hint={`${m?.transactions ?? 0} transactions`} loading={monthSummary.isPending} />
            </>
          )}
          {can('inventory.view') && (
            <Kpi
              icon={lowCount > 0 ? <AlertTriangle /> : <CheckCircle2 />}
              tone={lowCount > 0 ? 'amber' : 'slate'}
              label="Low-stock items"
              value={lowStock.data ? String(lowCount) : '—'}
              hint={lowCount > 0 ? 'Need restocking' : 'All above reorder level'}
              loading={lowStock.isPending}
            />
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {canReports && (
          <Panel className="lg:col-span-2" title="Today by payment method" subtitle="Net amount per payment type">
            <PaymentBreakdown rows={methods.data?.data} loading={methods.isPending} />
          </Panel>
        )}

        {canReports && (
          <Panel className="lg:col-span-3" title="Best sellers this month" subtitle="Top 5 products and their share">
            <BestSellers rows={best.data?.data} loading={best.isPending} />
          </Panel>
        )}

        {can('inventory.view') && (
          <Panel className="lg:col-span-2" title="Low stock" subtitle="At or below reorder level" action={<PanelLink to={`${base}/inventory`}>View inventory</PanelLink>}>
            {lowStock.isPending ? <Skeleton rows={3} /> : !lowStock.data?.data.length ? (
              <Empty icon={<CheckCircle2 />} tone="green" title="Everything is well stocked" text="No product is at or below its reorder level." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {lowStock.data.data.map((r) => (
                  <li key={`${r.branch_id}-${r.product_id}`} className="flex items-center gap-3 px-5 py-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600"><Package className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{r.name}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">{viewAll && <BranchTag id={r.branch_id} />}Reorder at {formatQty(r.reorder_level)}</span>
                    </span>
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">{formatQty(r.quantity)} {r.unit}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {canSales && (
          <Panel className="lg:col-span-3" title={can('sales.view_all') ? 'Recent sales' : 'My recent sales'} subtitle="Latest receipts" action={<PanelLink to={`${base}/sales`}>All sales</PanelLink>}>
            {recent.isPending ? <Skeleton rows={4} /> : !recent.data?.data.length ? (
              <Empty icon={<Receipt />} tone="slate" title="No sales yet" text="Sales appear here as soon as they are rung up." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {recent.data.data.map((r) => (
                  <li key={r.id}>
                    <Link to={`${base}/sales/${r.id}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><Receipt className="size-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">{r.receipt_number}</span>
                        <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">{viewAll && <BranchTag id={r.branch_id} />}{formatDateTime(r.sold_at)}</span>
                      </span>
                      <Badge status={r.payment_status} />
                      <span className="w-24 text-right font-display text-sm font-semibold tabular-nums text-slate-900">{formatMoney(r.total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------- Building blocks */

const TONES = {
  green: 'bg-brand-50 text-brand-600 ring-brand-100',
  rose: 'bg-rose-50 text-rose-600 ring-rose-100',
  sun: 'bg-sun-400/15 text-sun-500 ring-sun-400/30',
  amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  slate: 'bg-slate-100 text-slate-500 ring-slate-200',
} as const;

function Kpi({ icon, tone, label, value, hint, loading }: { icon: ReactNode; tone: keyof typeof TONES; label: string; value: string; hint: string; loading?: boolean }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className={`grid size-10 place-items-center rounded-xl ring-1 [&>svg]:size-5 ${TONES[tone]}`}>{icon}</span>
      </div>
      {loading ? <div className="mt-2 h-8 w-32 animate-pulse rounded-lg bg-slate-100" /> : <p className="mt-1 font-display text-[1.75rem] font-bold tracking-tight text-slate-900 tabular-nums">{value}</p>}
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function Panel({ title, subtitle, icon, action, className = '', children }: { title: string; subtitle?: string; icon?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5 ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-display text-[0.95rem] font-semibold text-slate-900">{icon}{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-50">
      {children} <ArrowUpRight className="size-3.5" />
    </Link>
  );
}

function Empty({ icon, tone, title, text }: { icon: ReactNode; tone: keyof typeof TONES; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className={`grid size-12 place-items-center rounded-2xl ring-1 [&>svg]:size-6 ${TONES[tone]}`}>{icon}</span>
      <p className="mt-1 font-semibold text-slate-800">{title}</p>
      <p className="max-w-xs text-sm text-slate-500">{text}</p>
    </div>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-10 animate-pulse rounded-xl bg-slate-100" />)}
    </div>
  );
}

const METHOD_ICONS: Record<string, ReactNode> = {
  cash: <Coins className="size-4" />,
  card: <CreditCard className="size-4" />,
  gcash: <Smartphone className="size-4" />,
  maya: <Smartphone className="size-4" />,
};

function PaymentBreakdown({ rows, loading }: { rows?: { method: string; payments: number; net: string }[]; loading: boolean }) {
  if (loading) return <Skeleton rows={3} />;
  if (!rows?.length) return <Empty icon={<Wallet />} tone="slate" title="No payments yet today" text="Cash, card and e-wallet totals will show here." />;
  const total = rows.reduce((sum, r) => sum + Number(r.net), 0) || 1;
  return (
    <ul className="space-y-4 p-5">
      {rows.map((r) => {
        const share = Math.round((Number(r.net) / total) * 100);
        return (
          <li key={r.method}>
            <div className="mb-1.5 flex items-center gap-2 text-sm">
              <span className="grid size-7 place-items-center rounded-lg bg-brand-50 text-brand-600">{METHOD_ICONS[r.method] ?? <Wallet className="size-4" />}</span>
              <span className="flex-1 font-medium text-slate-800">{titleCase(r.method)} <span className="text-xs font-normal text-slate-400">· {r.payments}</span></span>
              <span className="font-display font-semibold tabular-nums text-slate-900">{formatMoney(r.net)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400" style={{ width: `${share}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

type Seller = { product_id: number; name: string; net_quantity: string; revenue: string };

/** One colour per rank: brand greens, then the logo's yellow, then neutral. */
const SHARE_COLORS = ['#13412b', '#2a7c51', '#78ba94', '#f5c347', '#cbd5e1'];

/** Top sellers as share of the top five: leader summary, one stacked bar and an aligned ranking. */
function BestSellers({ rows, loading }: { rows?: Seller[]; loading: boolean }) {
  const [by, setBy] = useState<'qty' | 'revenue'>('qty');
  if (loading) return <Skeleton rows={5} />;
  if (!rows?.length) return <Empty icon={<PackageSearch />} tone="slate" title="No sales this month" text="Your top products will rank here." />;

  const metric = (r: Seller) => (by === 'qty' ? Number(r.net_quantity) : Number(r.revenue));
  const ranked = [...rows].sort((a, b) => metric(b) - metric(a));
  const total = ranked.reduce((sum, r) => sum + metric(r), 0) || 1;
  const share = (r: Seller) => (metric(r) / total) * 100;
  const leader = ranked[0];

  return (
    <div key={by} className="auth-fade">
      <div className="flex flex-wrap items-end justify-between gap-4 px-5 pt-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Top product</p>
          <p className="truncate font-display text-lg font-semibold text-slate-900">{leader.name}</p>
          <p className="text-xs text-slate-500">
            <span className="font-semibold text-brand-700">{Math.round(share(leader))}%</span> of top-5 {by === 'qty' ? 'units' : 'revenue'} ·{' '}
            {by === 'qty' ? `${formatQty(leader.net_quantity)} sold` : formatMoney(leader.revenue)}
          </p>
        </div>
        <div role="radiogroup" aria-label="Rank by" className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs font-medium">
          {(['qty', 'revenue'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={by === v} onClick={() => setBy(v)}
              className={`rounded-md px-3 py-1.5 transition ${by === v ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'}`}>
              {v === 'qty' ? 'Units' : 'Revenue'}
            </button>
          ))}
        </div>
      </div>

      {/* Composition of the top five. */}
      <div className="mx-5 mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        {ranked.map((r, i) => (
          <span key={r.product_id} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${share(r)}%`, backgroundColor: SHARE_COLORS[i] ?? SHARE_COLORS[4] }} />
        ))}
      </div>

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-slate-400">
            <th className="py-2 pl-5 text-left font-medium">#</th>
            <th className="py-2 text-left font-medium">Product</th>
            <th className="py-2 text-right font-medium">Units</th>
            <th className="py-2 text-right font-medium">Revenue</th>
            <th className="py-2 pr-5 text-right font-medium">Share</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 border-t border-slate-100">
          {ranked.map((r, i) => (
            <tr key={r.product_id} className="transition hover:bg-slate-50/80">
              <td className="w-10 py-3 pl-5 font-mono text-xs text-slate-400">{String(i + 1).padStart(2, '0')}</td>
              <td className="max-w-0 py-3 pr-3">
                <span className="flex items-center gap-2.5">
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: SHARE_COLORS[i] ?? SHARE_COLORS[4] }} />
                  <span className={`truncate ${i === 0 ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{r.name}</span>
                </span>
              </td>
              <td className={`py-3 text-right tabular-nums ${by === 'qty' ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{formatQty(r.net_quantity)}</td>
              <td className={`py-3 text-right tabular-nums ${by === 'revenue' ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{formatMoney(r.revenue)}</td>
              <td className="w-20 py-3 pr-5 text-right tabular-nums text-slate-500">{share(r).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
