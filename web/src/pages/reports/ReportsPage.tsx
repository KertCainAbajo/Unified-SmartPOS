import {
  Bike,
  Store,
  AlertTriangle,
  BarChart3,
  Boxes,
  Building2,
  Coins,
  Download,
  Info,
  Landmark,
  PiggyBank,
  Receipt,
  RotateCcw,
  ShoppingBag,
  Tag,
  TrendingUp,
  Trophy,
  UserRound,
  Wallet,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ScopeChip } from '../../components/BranchSwitcher';
import { Avatar, Card, DateRange, EmptyState, ErrorBanner, LoadingRows, PageHeader, Segmented, StatCard, Tabs, cx } from '../../components/ui';
import { downloadCsv } from '../../lib/csv';
import { firstOfMonthManila, formatMoney, formatQty, fromCents, titleCase, toCents, todayManila } from '../../lib/format';
import { useTenantQuery } from '../../lib/hooks';
import type { ReportResponse } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

type Tab = 'sales' | 'breakdown' | 'products' | 'profit';

interface Filters {
  date_from: string;
  date_to: string;
  branch_id?: number;
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function presets() {
  const today = todayManila();
  const monthStart = firstOfMonthManila();
  const lastMonthEnd = addDays(monthStart, -1);
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: '7', label: '7 days', from: addDays(today, -6), to: today },
    { key: 'month', label: 'This month', from: monthStart, to: today },
    { key: 'last', label: 'Last month', from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd },
    { key: 'year', label: 'This year', from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
}

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

export function ReportsPage() {
  const { can, scopeBranchId } = useTenant();
  const [tab, setTab] = useState<Tab>(can('reports.view') ? 'sales' : 'profit');
  const [range, setFilters] = useState({ date_from: firstOfMonthManila(), date_to: todayManila() });
  const filters: Filters = { ...range, branch_id: scopeBranchId };

  if (!can('reports.view') && !can('reports.financial')) return <NoAccess what="reports" />;

  const tabs = [
    ...(can('reports.view')
      ? [{ value: 'sales' as Tab, label: 'Sales', icon: TrendingUp }, { value: 'breakdown' as Tab, label: 'By channel / branch / cashier', icon: Building2 }, { value: 'products' as Tab, label: 'Products & stock', icon: Boxes }]
      : []),
    ...(can('reports.financial') ? [{ value: 'profit' as Tab, label: 'Profit & expenses', icon: PiggyBank }] : []),
  ];
  const ranges = presets();
  const active = ranges.find((r) => r.from === filters.date_from && r.to === filters.date_to)?.key ?? 'custom';

  return (
    <>
      <PageHeader eyebrow="Insights" title="Reports" description="Figures are computed by the server for your authorized branches. Voided sales are excluded." />

      <section className="mb-5 flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5 lg:flex-row lg:items-center">
        <Segmented label="Period" value={active} onChange={(k) => { const r = ranges.find((x) => x.key === k); if (r) setFilters((f) => ({ ...f, date_from: r.from, date_to: r.to })); }}
          options={[...ranges.map((r) => ({ value: r.key, label: r.label })), ...(active === 'custom' ? [{ value: 'custom', label: 'Custom' }] : [])]} />
        <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
          <DateRange from={filters.date_from} to={filters.date_to} onChange={(r) => setFilters((f) => ({ ...f, date_from: r.from, date_to: r.to }))} />
          <ScopeChip />
        </div>
      </section>

      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      <div key={tab} className="auth-fade">
        {tab === 'sales' && <SalesReport filters={filters} />}
        {tab === 'breakdown' && <BreakdownReport filters={filters} />}
        {tab === 'products' && <ProductsReport filters={filters} />}
        {tab === 'profit' && <ProfitReport filters={filters} />}
      </div>
    </>
  );
}

function useReport<T>(endpoint: string, filters: Filters, extra: Record<string, string | number> = {}) {
  return useTenantQuery<ReportResponse<T>>(`/reports/${endpoint}`, { ...filters, ...extra });
}

/* ------------------------------------------------------------------ Shared table bits */

const Th = ({ children, right }: { children?: ReactNode; right?: boolean }) => (
  <th scope="col" className={cx('whitespace-nowrap px-4 py-3 font-semibold first:pl-5 last:pr-5', right ? 'text-right' : 'text-left')}>{children}</th>
);
const Td = ({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <td className={cx('whitespace-nowrap px-4 py-3 first:pl-5 last:pr-5', right && 'text-right tabular-nums', className)}>{children}</td>
);

function ReportTable({ head, children, foot, loading, error, empty, emptyIcon = BarChart3 }: { head: ReactNode; children: ReactNode; foot?: ReactNode; loading?: boolean; error?: unknown; empty?: string | false; emptyIcon?: typeof BarChart3 }) {
  if (error) return <ErrorBanner error={error} className="m-4" />;
  if (loading) return <LoadingRows rows={4} />;
  if (empty) return <EmptyState icon={emptyIcon} title={empty} description="Try a wider period or another branch." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wider text-slate-400">{head}</tr></thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
        {foot && <tfoot><tr className="border-t-2 border-slate-200 bg-brand-50/50 font-semibold text-slate-900">{foot}</tr></tfoot>}
      </table>
    </div>
  );
}

/** Inline share bar next to a figure. */
function Share({ value, color = 'bg-brand-500' }: { value: number; color?: string }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 sm:block"><span className={cx('block h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${Math.min(100, value)}%` }} /></span>
      <span className="w-10 text-right text-xs tabular-nums text-slate-400">{value.toFixed(0)}%</span>
    </span>
  );
}

/* ------------------------------------------------------------------ Sales */

interface SummaryRow { period: string; transactions: number; gross_sales: string; discounts: string; vat_exemptions: string; net_sales: string; vat: string; refunds: string; net_after_refunds: string }

const periodLabel = (p: string, groupBy: 'day' | 'month') => {
  const d = new Date(groupBy === 'month' ? `${p.slice(0, 7)}-01T00:00:00` : `${p.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { short: p, long: p };
  return groupBy === 'month'
    ? { short: d.toLocaleDateString('en-PH', { month: 'short' }), long: d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }) }
    : { short: String(d.getDate()), long: d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }) };
};

function SalesChart({ rows, groupBy }: { rows: SummaryRow[]; groupBy: 'day' | 'month' }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = rows.map((r) => Number(r.net_after_refunds));
  const max = Math.max(1, ...values);
  const avg = values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
  const best = values.indexOf(Math.max(...values));
  const shown = hover ?? best;
  const r = rows[shown];
  const every = Math.ceil(rows.length / 16);

  return (
    <div>
      {r && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs text-slate-500">{hover === null ? 'Best ' + (groupBy === 'month' ? 'month' : 'day') : 'Selected'} · {periodLabel(r.period, groupBy).long}</p>
            <p className="font-display text-2xl font-bold tabular-nums text-brand-900">{formatMoney(r.net_after_refunds)}</p>
          </div>
          <p className="text-xs text-slate-500"><strong className="text-slate-800">{r.transactions}</strong> transactions{Number(r.refunds) > 0 && <> · <span className="text-rose-600">−{formatMoney(r.refunds)} refunds</span></>}</p>
        </div>
      )}
      <div className="relative h-56">
        {/* grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <div key={g} className="absolute inset-x-0 border-t border-dashed border-slate-100" style={{ bottom: `${g * 100}%` }}>
            <span className="absolute -top-2 left-0 bg-white pr-1 text-[10px] tabular-nums text-slate-300">{g > 0 ? formatMoney((max * g).toFixed(0)).replace('.00', '') : ''}</span>
          </div>
        ))}
        <div className="absolute inset-x-0 z-10 border-t-2 border-sun-400/70" style={{ bottom: `${(avg / max) * 100}%` }}>
          <span className="absolute -top-5 right-0 rounded bg-sun-300/40 px-1.5 text-[10px] font-semibold text-sun-500">avg {formatMoney(avg.toFixed(0)).replace('.00', '')}</span>
        </div>
        <div className="absolute inset-0 flex items-end gap-[3px] pl-14" onMouseLeave={() => setHover(null)}>
          {rows.map((row, i) => (
            <button
              key={row.period}
              type="button"
              aria-label={`${periodLabel(row.period, groupBy).long}: ${formatMoney(row.net_after_refunds)}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              className="group relative flex h-full flex-1 items-end focus-visible:outline-none"
            >
              <span
                className={cx('w-full rounded-t-md transition-all duration-500', i === shown ? 'bg-gradient-to-t from-brand-700 to-brand-500' : 'bg-gradient-to-t from-brand-200 to-brand-100 group-hover:from-brand-400 group-hover:to-brand-300')}
                style={{ height: `${Math.max(1.5, (values[i] / max) * 100)}%` }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex gap-[3px] pl-14">
        {rows.map((row, i) => (
          <span key={row.period} className={cx('flex-1 text-center text-[10px] tabular-nums', i === shown ? 'font-bold text-brand-700' : 'text-slate-400')}>
            {i % every === 0 || i === shown ? periodLabel(row.period, groupBy).short : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

const DISCOUNT_TAG: Record<string, string> = {
  senior: 'bg-violet-50 text-violet-700 ring-violet-200',
  senior_citizen: 'bg-violet-50 text-violet-700 ring-violet-200',
  pwd: 'bg-sky-50 text-sky-700 ring-sky-200',
};

function SalesReport({ filters }: { filters: Filters }) {
  const [groupBy, setGroupBy] = useState<'day' | 'month'>('day');
  const report = useReport<SummaryRow[]>('sales-summary', filters, { group_by: groupBy });
  const discounts = useReport<{ discounts: { discount_type: string; transactions: number; discounts: string; vat_exemptions: string }[]; refunds: { completed_count: number; completed_total: string; pending_count: number; pending_total: string }; voided_sales: number }>('discounts-refunds', filters);
  const rows = report.data?.data ?? [];
  const sum = (key: keyof SummaryRow) => fromCents(rows.reduce((s, r) => s + toCents(String(r[key])), 0));
  const txns = rows.reduce((s, r) => s + r.transactions, 0);
  const ready = report.data !== undefined;
  const net = Number(sum('net_sales'));
  const refunds = Number(sum('refunds'));
  const discountRows = discounts.data?.data.discounts ?? [];
  const discountTotal = discountRows.reduce((s, r) => s + Number(r.discounts), 0);

  const exportRows = () => downloadCsv(`sales-${filters.date_from}-to-${filters.date_to}.csv`,
    ['Period', 'Transactions', 'Gross', 'Discounts', 'SC/PWD VAT', 'Net sales', 'VAT', 'Refunds', 'Net after refunds'],
    rows.map((r) => [r.period, r.transactions, r.gross_sales, r.discounts, r.vat_exemptions, r.net_sales, r.vat, r.refunds, r.net_after_refunds]));

  return (
    <div className="space-y-6">
      <ErrorBanner error={report.error} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard tone="brand" icon={TrendingUp} label="Net sales" value={ready ? formatMoney(sum('net_sales')) : null} hint={`${txns} transactions${txns ? ` · avg ${formatMoney((net / txns).toFixed(2))}` : ''}`} />
        <StatCard tone={refunds > 0 ? 'rose' : 'default'} icon={RotateCcw} label="Refunds" value={ready ? formatMoney(sum('refunds')) : null} hint={discounts.data ? `${discounts.data.data.refunds.pending_count} pending approval` : `${pct(refunds, net).toFixed(1)}% of net`} />
        <StatCard tone="featured" icon={Wallet} label="Net after refunds" value={ready ? formatMoney(sum('net_after_refunds')) : null} hint={`${rows.length} ${groupBy === 'day' ? 'days' : 'months'} with sales`} />
        <StatCard tone="sun" icon={Landmark} label="VAT collected" value={ready ? formatMoney(sum('vat')) : null} hint={discounts.data ? `${discounts.data.data.voided_sales} voided sales excluded` : undefined} />
      </div>

      <Card title="Sales over time" subtitle="Net after refunds. Hover a bar for details." icon={BarChart3}
        actions={<Segmented<'day' | 'month'> label="Group by" value={groupBy} onChange={setGroupBy} options={[{ value: 'day', label: 'Daily' }, { value: 'month', label: 'Monthly' }]} />}>
        {report.isPending ? <div className="h-64 animate-pulse rounded-xl bg-slate-50" /> : rows.length === 0 ? (
          <EmptyState icon={BarChart3} title="No sales in this period" description="Try a wider period or another branch." />
        ) : <SalesChart rows={rows} groupBy={groupBy} />}
      </Card>

      <Card title="Details" subtitle={`${rows.length} ${groupBy === 'day' ? 'days' : 'months'}`} icon={Receipt} padded={false}
        actions={<button type="button" disabled={rows.length === 0} onClick={exportRows} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-brand-800 ring-1 ring-slate-200 transition hover:bg-brand-50 disabled:opacity-50"><Download className="size-3.5" /> CSV</button>}>
        <ReportTable loading={report.isPending} empty={rows.length === 0 && 'No sales in this period'}
          head={<><Th>Period</Th><Th right>Txns</Th><Th right>Gross</Th><Th right>Discounts</Th><Th right>SC/PWD VAT</Th><Th right>Net sales</Th><Th right>VAT</Th><Th right>Refunds</Th><Th right>Net after refunds</Th></>}
          foot={<><Td>Total</Td><Td right>{txns}</Td><Td right>{formatMoney(sum('gross_sales'))}</Td><Td right>{formatMoney(sum('discounts'))}</Td><Td right>{formatMoney(sum('vat_exemptions'))}</Td><Td right>{formatMoney(sum('net_sales'))}</Td><Td right>{formatMoney(sum('vat'))}</Td><Td right className="text-rose-600">{formatMoney(sum('refunds'))}</Td><Td right className="font-display text-brand-900">{formatMoney(sum('net_after_refunds'))}</Td></>}>
          {rows.map((r) => (
            <tr key={r.period} className="transition-colors hover:bg-brand-50/40">
              <Td className="font-medium text-slate-900">{periodLabel(r.period, groupBy).long}</Td>
              <Td right className="text-slate-500">{r.transactions}</Td>
              <Td right>{formatMoney(r.gross_sales)}</Td>
              <Td right className="text-slate-500">{Number(r.discounts) ? `−${formatMoney(r.discounts)}` : '—'}</Td>
              <Td right className="text-slate-500">{Number(r.vat_exemptions) ? formatMoney(r.vat_exemptions) : '—'}</Td>
              <Td right>{formatMoney(r.net_sales)}</Td>
              <Td right className="text-slate-500">{formatMoney(r.vat)}</Td>
              <Td right className={Number(r.refunds) ? 'text-rose-600' : 'text-slate-300'}>{Number(r.refunds) ? `−${formatMoney(r.refunds)}` : '—'}</Td>
              <Td right className="font-display font-semibold text-slate-900">{formatMoney(r.net_after_refunds)}</Td>
            </tr>
          ))}
        </ReportTable>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Discounts" subtitle="Senior citizen, PWD and other discounts given" icon={Tag} padded={false}>
          <ReportTable loading={discounts.isPending} error={discounts.error} empty={discountRows.length === 0 && 'No discounts given'} emptyIcon={Tag}
            head={<><Th>Type</Th><Th right>Sales</Th><Th right>Discount</Th><Th right>VAT exempted</Th><Th right>Share</Th></>}>
            {discountRows.map((r) => (
              <tr key={r.discount_type} className="transition-colors hover:bg-brand-50/40">
                <Td><span className={cx('rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', DISCOUNT_TAG[r.discount_type] ?? 'bg-amber-50 text-amber-800 ring-amber-200')}>{titleCase(r.discount_type)}</span></Td>
                <Td right className="text-slate-500">{r.transactions}</Td>
                <Td right className="font-medium text-slate-900">{formatMoney(r.discounts)}</Td>
                <Td right className="text-slate-500">{formatMoney(r.vat_exemptions)}</Td>
                <Td right><Share value={pct(Number(r.discounts), discountTotal)} color="bg-violet-500" /></Td>
              </tr>
            ))}
          </ReportTable>
        </Card>
        <Card title="Refunds & voids" icon={RotateCcw}>
          {!discounts.data ? <div className="space-y-3">{[0, 1, 2].map((i) => <span key={i} className="block h-10 animate-pulse rounded-lg bg-slate-50" />)}</div> : (
            <ul className="space-y-3 text-sm">
              <li className="flex items-center justify-between rounded-xl bg-rose-50/60 px-4 py-3 ring-1 ring-rose-100">
                <span><span className="block font-medium text-slate-900">Completed refunds</span><span className="text-xs text-slate-500">{discounts.data.data.refunds.completed_count} refunds</span></span>
                <span className="font-display font-semibold tabular-nums text-rose-600">{formatMoney(discounts.data.data.refunds.completed_total)}</span>
              </li>
              <li className="flex items-center justify-between rounded-xl bg-amber-50/60 px-4 py-3 ring-1 ring-amber-100">
                <span><span className="block font-medium text-slate-900">Pending approval</span><span className="text-xs text-slate-500">{discounts.data.data.refunds.pending_count} requests</span></span>
                <span className="font-display font-semibold tabular-nums text-amber-700">{formatMoney(discounts.data.data.refunds.pending_total)}</span>
              </li>
              <li className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
                <span><span className="block font-medium text-slate-900">Voided sales</span><span className="text-xs text-slate-500">Excluded from every figure</span></span>
                <span className="font-display font-semibold tabular-nums text-slate-700">{discounts.data.data.voided_sales}</span>
              </li>
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Breakdown */

const METHOD_COLORS = ['bg-brand-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500'];

function BreakdownReport({ filters }: { filters: Filters }) {
  const byBranch = useReport<{ branch_id: number; branch_name: string; transactions: number; net_sales: string; vat: string }[]>('sales-by-branch', filters);
  const byCashier = useReport<{ cashier_id: number; cashier_name: string; transactions: number; net_sales: string; discounts: string }[]>('sales-by-cashier', filters);
  const byMethod = useReport<{ method: string; payments: number; collected: string; refunded: string; net: string }[]>('sales-by-payment-method', filters);
  const byChannel = useReport<{ channel: 'in_store' | 'pickup' | 'delivery'; sales: number; total: string }[]>('sales-by-channel', filters);
  const channelRows = byChannel.data?.data ?? [];
  const channelTotal = channelRows.reduce((s, r) => s + Number(r.total), 0);
  const branchRows = byBranch.data?.data ?? [];
  const cashierRows = [...(byCashier.data?.data ?? [])].sort((a, b) => Number(b.net_sales) - Number(a.net_sales));
  const methodRows = byMethod.data?.data ?? [];
  const branchTotal = branchRows.reduce((s, r) => s + Number(r.net_sales), 0);
  const cashierTotal = cashierRows.reduce((s, r) => s + Number(r.net_sales), 0);
  const methodTotal = methodRows.reduce((s, r) => s + Math.max(0, Number(r.net)), 0);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="By channel" subtitle="In-store sales compared with online pickup and delivery" icon={ShoppingBag} padded={false} className="lg:col-span-2">
        <ReportTable loading={byChannel.isPending} error={byChannel.error} empty={channelRows.every((r) => r.sales === 0) && 'No sales'} emptyIcon={ShoppingBag}
          head={<><Th>Channel</Th><Th right>Sales</Th><Th right>Total</Th><Th right>Average</Th><Th right>Share</Th></>}>
          {channelRows.map((r) => {
            const look = { in_store: { label: 'In store', note: 'Rung up at the counter', icon: Store, tone: 'bg-slate-100 text-slate-600' }, pickup: { label: 'Online pickup', note: 'Ordered online, collected in store', icon: ShoppingBag, tone: 'bg-sky-50 text-sky-700' }, delivery: { label: 'Online delivery', note: 'Delivered by a rider', icon: Bike, tone: 'bg-orange-50 text-orange-700' } }[r.channel];
            return (
              <tr key={r.channel} className="transition-colors hover:bg-brand-50/40">
                <Td><span className="flex items-center gap-2.5"><span className={cx('grid size-8 place-items-center rounded-lg', look.tone)}><look.icon className="size-4" /></span><span><span className="block font-medium text-slate-900">{look.label}</span><span className="block text-xs text-slate-500">{look.note}</span></span></span></Td>
                <Td right className="text-slate-500">{r.sales}</Td>
                <Td right className="font-display font-semibold text-slate-900">{formatMoney(r.total)}</Td>
                <Td right className="text-slate-500">{r.sales ? formatMoney((Number(r.total) / r.sales).toFixed(2)) : '—'}</Td>
                <Td right><Share value={pct(Number(r.total), channelTotal)} /></Td>
              </tr>
            );
          })}
        </ReportTable>
      </Card>

      <Card title="By branch" subtitle="Net sales per branch" icon={Building2} padded={false}>
        <ReportTable loading={byBranch.isPending} error={byBranch.error} empty={branchRows.length === 0 && 'No sales'} emptyIcon={Building2}
          head={<><Th>Branch</Th><Th right>Txns</Th><Th right>Net sales</Th><Th right>Share</Th></>}>
          {branchRows.map((r) => (
            <tr key={r.branch_id} className="transition-colors hover:bg-brand-50/40">
              <Td><span className="flex items-center gap-2.5"><Avatar name={r.branch_name} square size="sm" /><span className="font-medium text-slate-900">{r.branch_name}</span></span></Td>
              <Td right className="text-slate-500">{r.transactions}</Td>
              <Td right className="font-display font-semibold text-slate-900">{formatMoney(r.net_sales)}</Td>
              <Td right><Share value={pct(Number(r.net_sales), branchTotal)} /></Td>
            </tr>
          ))}
        </ReportTable>
      </Card>

      <Card title="By payment method" subtitle="Collected less refunded" icon={Coins}>
        {byMethod.error ? <ErrorBanner error={byMethod.error} /> : byMethod.isPending ? <LoadingRows rows={3} /> : methodRows.length === 0 ? (
          <EmptyState icon={Coins} title="No payments" description="Try a wider period or another branch." />
        ) : (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
              {methodRows.map((r, i) => <span key={r.method} className={cx('h-full transition-[width] duration-500', METHOD_COLORS[i % METHOD_COLORS.length])} style={{ width: `${pct(Math.max(0, Number(r.net)), methodTotal)}%` }} title={titleCase(r.method)} />)}
            </div>
            <ul className="mt-5 divide-y divide-slate-100">
              {methodRows.map((r, i) => (
                <li key={r.method} className="flex items-center gap-3 py-3 text-sm">
                  <span className={cx('size-2.5 shrink-0 rounded-full', METHOD_COLORS[i % METHOD_COLORS.length])} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900">{titleCase(r.method)}</span>
                    <span className="block text-xs text-slate-400">{r.payments} payments · {formatMoney(r.collected)} collected{Number(r.refunded) > 0 && <span className="text-rose-500"> · −{formatMoney(r.refunded)}</span>}</span>
                  </span>
                  <span className="text-xs tabular-nums text-slate-400">{pct(Math.max(0, Number(r.net)), methodTotal).toFixed(0)}%</span>
                  <span className="w-28 text-right font-display font-semibold tabular-nums text-slate-900">{formatMoney(r.net)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title="By cashier" subtitle="Ranked by net sales" icon={UserRound} padded={false} className="lg:col-span-2">
        <ReportTable loading={byCashier.isPending} error={byCashier.error} empty={cashierRows.length === 0 && 'No sales'} emptyIcon={UserRound}
          head={<><Th>Cashier</Th><Th right>Txns</Th><Th right>Avg sale</Th><Th right>Discounts given</Th><Th right>Net sales</Th><Th right>Share</Th></>}>
          {cashierRows.map((r, i) => (
            <tr key={r.cashier_id} className="transition-colors hover:bg-brand-50/40">
              <Td>
                <span className="flex items-center gap-2.5">
                  <span className="w-5 text-center text-xs font-bold tabular-nums text-slate-300">{i + 1}</span>
                  <Avatar name={r.cashier_name} size="sm" />
                  <span className="font-medium text-slate-900">{r.cashier_name}</span>
                </span>
              </Td>
              <Td right className="text-slate-500">{r.transactions}</Td>
              <Td right className="text-slate-500">{r.transactions ? formatMoney((Number(r.net_sales) / r.transactions).toFixed(2)) : '—'}</Td>
              <Td right className="text-slate-500">{Number(r.discounts) ? formatMoney(r.discounts) : '—'}</Td>
              <Td right className="font-display font-semibold text-slate-900">{formatMoney(r.net_sales)}</Td>
              <Td right><Share value={pct(Number(r.net_sales), cashierTotal)} color="bg-sky-500" /></Td>
            </tr>
          ))}
        </ReportTable>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ Products */

const MEDAL = ['bg-gradient-to-br from-sun-300 to-sun-500 text-brand-900', 'bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800', 'bg-gradient-to-br from-orange-300 to-orange-500 text-orange-950'];

function ProductsReport({ filters }: { filters: Filters }) {
  const best = useReport<{ product_id: number; sku: string; name: string; quantity_sold: string; quantity_refunded: string; net_quantity: string; revenue: string }[]>('best-sellers', filters, { limit: 20 });
  const movements = useReport<{ type: string; movements: number; quantity: string; value_at_cost: string }[]>('inventory-movements', filters);
  const bestRows = best.data?.data ?? [];
  const moveRows = movements.data?.data ?? [];
  const topRevenue = Math.max(1, ...bestRows.map((r) => Number(r.revenue)));

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <Card title="Best sellers" subtitle="Top 20 by net quantity sold" icon={Trophy} padded={false}>
        {best.error ? <ErrorBanner error={best.error} className="m-4" /> : best.isPending ? <LoadingRows rows={5} /> : bestRows.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="No sales" description="Try a wider period or another branch." />
        ) : (
          <ol className="divide-y divide-slate-100">
            {bestRows.map((r, i) => (
              <li key={r.product_id} className="flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-brand-50/40">
                <span className={cx('grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums', MEDAL[i] ?? 'bg-slate-100 text-slate-500')}>{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900">{r.name}</span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600" style={{ width: `${pct(Number(r.revenue), topRevenue)}%` }} /></span>
                </span>
                <span className="w-20 text-right">
                  <span className="block font-medium tabular-nums text-slate-900">{formatQty(r.net_quantity)}</span>
                  <span className="block text-[11px] text-slate-400">{Number(r.quantity_refunded) > 0 ? <span className="text-rose-500">−{formatQty(r.quantity_refunded)} ret.</span> : 'sold'}</span>
                </span>
                <span className="w-28 text-right font-display font-semibold tabular-nums text-slate-900">{formatMoney(r.revenue)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card title="Inventory movements" subtitle="Stock in and out by type" icon={Boxes} padded={false}>
        <ReportTable loading={movements.isPending} error={movements.error} empty={moveRows.length === 0 && 'No movements'} emptyIcon={Boxes}
          head={<><Th>Type</Th><Th right>Count</Th><Th right>Qty</Th><Th right>Value at cost</Th></>}>
          {moveRows.map((r) => {
            const q = Number(r.quantity);
            return (
              <tr key={r.type} className="transition-colors hover:bg-brand-50/40">
                <Td className="font-medium text-slate-900">{titleCase(r.type)}</Td>
                <Td right className="text-slate-500">{r.movements}</Td>
                <Td right className={q < 0 ? 'text-rose-600' : 'text-emerald-700'}>{q > 0 ? '+' : ''}{formatQty(r.quantity)}</Td>
                <Td right className="font-medium text-slate-900">{formatMoney(r.value_at_cost)}</Td>
              </tr>
            );
          })}
        </ReportTable>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ Profit */

interface Profit {
  net_sales_excluding_vat: string;
  refunds_excluding_vat: string;
  net_revenue: string;
  cost_of_goods_sold: string;
  gross_profit: string;
  gross_margin_percent: string | null;
  operating_expenses: string;
  estimated_operating_profit: string;
  data_quality: { sale_lines_without_cost: number; cogs_complete: boolean; business_wide_expenses_included: boolean };
  notes: string[];
}

const EXPENSE_COLORS = ['bg-brand-500', 'bg-sky-500', 'bg-amber-500', 'bg-violet-500', 'bg-rose-500', 'bg-teal-500'];

function ProfitReport({ filters }: { filters: Filters }) {
  const profit = useReport<Profit>('profit', filters);
  const expenses = useReport<{ expense_category_id: number; category: string; count: number; amount: string }[]>('expenses', filters);
  const p = profit.data?.data;
  if (profit.error) return <ErrorBanner error={profit.error} />;
  if (!p) return <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <StatCard key={i} label="Loading" value={null} />)}</div>;

  const opProfit = Number(p.estimated_operating_profit);
  const margin = p.gross_margin_percent === null ? null : Number(p.gross_margin_percent);
  const opMargin = pct(opProfit, Number(p.net_revenue));
  const expRows = [...(expenses.data?.data ?? [])].sort((a, b) => Number(b.amount) - Number(a.amount));
  const expTotal = expRows.reduce((s, r) => s + Number(r.amount), 0);

  const line = (label: string, value: string, kind: 'plus' | 'minus' | 'total', note?: string) => (
    <div className={cx('flex items-center justify-between gap-3 px-5 py-3 text-sm', kind === 'total' ? 'bg-slate-50 font-semibold text-slate-900' : 'text-slate-600')}>
      <span className={cx(kind === 'minus' && 'pl-4')}>
        {label}
        {note && <span className="ml-2 text-xs font-normal text-slate-400">{note}</span>}
      </span>
      <span className={cx('tabular-nums', kind === 'minus' && 'text-rose-600', kind === 'total' && 'font-display')}>{kind === 'minus' ? `−${formatMoney(value)}` : formatMoney(value)}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard tone="brand" icon={TrendingUp} label="Net revenue" value={formatMoney(p.net_revenue)} hint="Excluding VAT, after refunds" />
        <StatCard tone="sky" icon={Boxes} label="Gross profit" value={formatMoney(p.gross_profit)} hint={margin === null ? 'Margin unavailable' : `${margin.toFixed(1)}% gross margin`} />
        <StatCard tone="rose" icon={Wallet} label="Operating expenses" value={formatMoney(p.operating_expenses)} hint={`${expRows.length} categories`} />
        <StatCard tone="featured" icon={PiggyBank} label="Operating profit" value={formatMoney(p.estimated_operating_profit)} hint={`${opMargin.toFixed(1)}% of net revenue · estimate`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Estimated profit" subtitle="Excluding VAT" icon={PiggyBank} padded={false}>
          <div className="divide-y divide-slate-100">
            {line('Net sales', p.net_sales_excluding_vat, 'plus')}
            {line('Refunds', p.refunds_excluding_vat, 'minus')}
            {line('Net revenue', p.net_revenue, 'total')}
            {line('Cost of goods sold', p.cost_of_goods_sold, 'minus')}
            {line('Gross profit', p.gross_profit, 'total', margin === null ? undefined : `${margin.toFixed(1)}% margin`)}
            {line('Recorded operating expenses', p.operating_expenses, 'minus')}
            <div className={cx('flex items-center justify-between px-5 py-4', opProfit >= 0 ? 'bg-gradient-to-r from-brand-700 to-brand-900 text-white' : 'bg-gradient-to-r from-rose-600 to-rose-800 text-white')}>
              <span className="font-semibold">Estimated operating profit</span>
              <span className="font-display text-lg font-bold tabular-nums">{formatMoney(p.estimated_operating_profit)}</span>
            </div>
          </div>
          {margin !== null && (
            <div className="px-5 py-4">
              <div className="flex justify-between text-xs text-slate-500"><span>Gross margin</span><span className="font-semibold text-slate-800">{margin.toFixed(1)}%</span></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-700" style={{ width: `${Math.max(0, Math.min(100, margin))}%` }} /></div>
            </div>
          )}
          {!p.data_quality.cogs_complete && (
            <p className="mx-5 mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-100">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />{p.data_quality.sale_lines_without_cost} sale lines had no cost recorded, so COGS may be understated.
            </p>
          )}
          {p.notes.length > 0 && (
            <ul className="space-y-1.5 border-t border-slate-100 px-5 py-4 text-xs text-slate-500">
              {p.notes.map((n) => <li key={n} className="flex items-start gap-2"><Info className="mt-0.5 size-3.5 shrink-0 text-slate-400" />{n}</li>)}
            </ul>
          )}
        </Card>

        <Card title="Expenses by category" subtitle={formatMoney(expTotal.toFixed(2)) + ' in total'} icon={Wallet}>
          {expenses.error ? <ErrorBanner error={expenses.error} /> : expenses.isPending ? <LoadingRows rows={3} /> : expRows.length === 0 ? (
            <EmptyState icon={Wallet} title="No expenses recorded" description="Record expenses to see an operating profit estimate." />
          ) : (
            <>
              <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                {expRows.map((r, i) => <span key={r.expense_category_id} className={cx('h-full', EXPENSE_COLORS[i % EXPENSE_COLORS.length])} style={{ width: `${pct(Number(r.amount), expTotal)}%` }} title={r.category} />)}
              </div>
              <ul className="mt-5 divide-y divide-slate-100">
                {expRows.map((r, i) => (
                  <li key={r.expense_category_id} className="flex items-center gap-3 py-3 text-sm">
                    <span className={cx('size-2.5 shrink-0 rounded-full', EXPENSE_COLORS[i % EXPENSE_COLORS.length])} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-900">{r.category}</span>
                      <span className="block text-xs text-slate-400">{r.count} {r.count === 1 ? 'entry' : 'entries'}</span>
                    </span>
                    <span className="text-xs tabular-nums text-slate-400">{pct(Number(r.amount), expTotal).toFixed(0)}%</span>
                    <span className="w-28 text-right font-display font-semibold tabular-nums text-slate-900">{formatMoney(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!p.data_quality.business_wide_expenses_included && <p className="mt-4 flex items-start gap-2 text-xs text-slate-500"><Info className="mt-0.5 size-3.5 shrink-0" />Business-wide expenses are excluded because this report covers only some branches.</p>}
        </Card>
      </div>
    </div>
  );
}
