import {
  ArrowDownRight,
  Bike,
  CalendarDays,
  ChevronRight,
  Download,
  Hash,
  Receipt,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingBag,
  Store,
  TrendingUp,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { BranchTag, ScopeChip } from '../../components/BranchSwitcher';
import { StatCard, ErrorBanner, Pagination, cx } from '../../components/ui';
import { formatMoney, todayManila } from '../../lib/format';
import { useDebounced, useTenantQuery } from '../../lib/hooks';
import type { Paginated, Sale, SaleChannel } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

type Filters = { date_from: string; date_to: string; status: string; receipt_number: string; channel: string };

const addDays = (isoDate: string, days: number): string => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Quick report periods, in Manila time. */
function periods(): { key: string; label: string; from: string; to: string }[] {
  const today = todayManila();
  return [
    { key: 'all', label: 'All time', from: '', to: '' },
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { key: '7d', label: 'Last 7 days', from: addDays(today, -6), to: today },
    { key: 'month', label: 'This month', from: `${today.slice(0, 8)}01`, to: today },
  ];
}

const longDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

const shortDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');

/** Sales grouped under the day they belong to, with that day's totals. */
function groupByDay(rows: Sale[]) {
  const days = new Map<string, Sale[]>();
  for (const sale of rows) {
    const key = sale.business_date;
    (days.get(key) ?? days.set(key, []).get(key)!).push(sale);
  }
  return [...days.entries()].map(([date, sales]) => {
    const counted = sales.filter((s) => s.status !== 'voided');
    return {
      date,
      sales,
      count: counted.length,
      gross: counted.reduce((sum, s) => sum + Number(s.total), 0),
      refunds: sales.reduce((sum, s) => sum + Number(s.refunded_total || 0), 0),
    };
  });
}

const STATUS: Record<string, { pill: string; dot: string; label: string }> = {
  paid: { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15', dot: 'bg-emerald-500', label: 'Paid' },
  partially_refunded: { pill: 'bg-amber-50 text-amber-800 ring-amber-600/20', dot: 'bg-amber-500', label: 'Partly refunded' },
  refunded: { pill: 'bg-rose-50 text-rose-700 ring-rose-600/15', dot: 'bg-rose-500', label: 'Refunded' },
  voided: { pill: 'bg-slate-100 text-slate-500 ring-slate-500/15', dot: 'bg-slate-400', label: 'Voided' },
};

/** Where a sale came from. Sales loaded before this existed have no channel and count as counter sales. */
const CHANNEL: Record<SaleChannel, { label: string; icon: LucideIcon; className: string }> = {
  in_store: { label: 'In store', icon: Store, className: 'bg-slate-100 text-slate-600 ring-slate-500/15' },
  pickup: { label: 'Pickup', icon: ShoppingBag, className: 'bg-sky-50 text-sky-700 ring-sky-600/20' },
  delivery: { label: 'Delivery', icon: Bike, className: 'bg-orange-50 text-orange-700 ring-orange-600/20' },
};

const DISCOUNT: Record<string, { label: string; className: string }> = {
  senior_citizen: { label: 'Senior', className: 'bg-sun-300/30 text-amber-800 ring-amber-500/25' },
  pwd: { label: 'PWD', className: 'bg-sky-50 text-sky-700 ring-sky-600/20' },
};

/** Downloads the listed sales as a CSV file. */
function exportCsv(rows: Sale[]) {
  const header = ['Receipt', 'Business date', 'Time', 'Type', 'Online order', 'Cashier', 'Discount', 'Status', 'Total', 'Refunded'];
  const lines = rows.map((s) => [
    s.receipt_number,
    s.business_date,
    timeOf(s.sold_at),
    CHANNEL[s.channel ?? 'in_store'].label,
    s.online_order?.order_number ?? '',
    s.cashier?.name ?? '',
    s.discount.type === 'none' ? '' : DISCOUNT[s.discount.type]?.label ?? s.discount.type,
    s.status === 'voided' ? 'Voided' : STATUS[s.payment_status]?.label ?? s.payment_status,
    s.total,
    s.refunded_total || '0.00',
  ]);
  const csv = [header, ...lines].map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `sales-${todayManila()}.csv` });
  link.click();
  URL.revokeObjectURL(url);
}

export function SalesPage() {
  const { can, tenantId, viewAll, scopeBranchId } = useTenant();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({ date_from: '', date_to: '', status: '', receipt_number: '', channel: '' });
  const receipt = useDebounced(filters.receipt_number.trim());
  const list = useTenantQuery<Paginated<Sale>>('/sales', { ...filters, branch_id: scopeBranchId, receipt_number: receipt || undefined, page });

  if (!can('sales.view') && !can('sales.view_all')) return <NoAccess what="sales" />;
  const set = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const ranges = periods();
  const activePeriod = ranges.find((r) => r.from === filters.date_from && r.to === filters.date_to);
  const filtered = filters.receipt_number !== '' || filters.date_from !== '' || filters.date_to !== '' || filters.status !== '' || filters.channel !== '';
  const resetFilters = () => set({ date_from: '', date_to: '', status: '', receipt_number: '', channel: '' });

  const rows = list.data?.data ?? [];
  const total = list.data?.meta?.total ?? list.data?.total ?? rows.length;
  const counted = rows.filter((r) => r.status !== 'voided');
  const gross = counted.reduce((sum, r) => sum + Number(r.total), 0);
  const refunds = rows.reduce((sum, r) => sum + Number(r.refunded_total || 0), 0);
  const net = gross - refunds;
  const voided = rows.length - counted.length;
  const partial = total > rows.length;
  const refundShare = gross > 0 ? Math.min(100, (refunds / gross) * 100) : 0;
  const scope = partial ? 'This page' : filtered ? 'Matching your filters' : 'All recorded sales';
  const periodLabel = activePeriod && activePeriod.key !== 'all'
    ? activePeriod.label
    : filters.date_from || filters.date_to
      ? `${filters.date_from ? shortDate(filters.date_from) : '…'} – ${filters.date_to ? shortDate(filters.date_to) : '…'}`
      : 'All time';

  // Removable chips for whatever is narrowing the list.
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.receipt_number) chips.push({ key: 'receipt', label: `Receipt “${filters.receipt_number}”`, clear: () => set({ receipt_number: '' }) });
  if (filters.date_from || filters.date_to) chips.push({ key: 'period', label: periodLabel, clear: () => set({ date_from: '', date_to: '' }) });
  if (filters.channel) chips.push({ key: 'channel', label: `${CHANNEL[filters.channel as SaleChannel].label} only`, clear: () => set({ channel: '' }) });
  if (filters.status) chips.push({ key: 'status', label: filters.status === 'voided' ? 'Voided only' : 'Completed only', clear: () => set({ status: '' }) });

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700 shadow-sm ring-1 ring-brand-900/10 backdrop-blur"><span className="size-1.5 rounded-full bg-gradient-to-br from-brand-400 to-brand-600" />Selling</p>
          <h1 className="mt-2.5 font-display text-[1.75rem] font-extrabold leading-[1.1] tracking-[-0.02em] text-brand-900 sm:text-[2.15rem]">Sales</h1>
          <p className="mt-1 text-sm text-slate-500">{can('sales.view_all') ? 'Every transaction across your branches, grouped by day.' : 'The sales you processed, grouped by day.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-3.5 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-900/5">
            <CalendarDays className="size-3.5 text-brand-600" />
            <span className="font-semibold text-slate-800">{periodLabel}</span>
          </span>
          <ScopeChip />
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={() => exportCsv(rows)}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-xs font-semibold text-brand-800 shadow-sm ring-1 ring-slate-900/5 transition hover:bg-brand-50 hover:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="size-3.5" /> Export CSV
          </button>
        </div>
      </header>

      {/* Totals for what is listed below */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi Icon={Hash} label="Transactions" value={list.data ? String(total) : null} note={voided > 0 ? `${voided} voided excluded` : scope} tint="slate" />
        <Kpi Icon={TrendingUp} label="Gross sales" value={list.data ? formatMoney(gross.toFixed(2)) : null} note={counted.length ? `Avg ${formatMoney((gross / counted.length).toFixed(2))} per sale` : 'No sales yet'} tint="brand" />
        <Kpi Icon={RotateCcw} label="Refunds" value={list.data ? `−${formatMoney(refunds.toFixed(2))}` : null} note={refunds > 0 ? `${refundShare.toFixed(1)}% of gross` : 'Nothing returned'} tint={refunds > 0 ? 'rose' : 'slate'} />
        <NetKpi value={list.data ? formatMoney(net.toFixed(2)) : null} refundShare={refundShare} note={partial ? 'This page only' : 'Gross less refunds'} />
      </section>

      {/* Ledger */}
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
        {/* Toolbar */}
        <div className="space-y-3 border-b border-slate-100 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <label className="group relative flex h-10 items-center rounded-xl bg-slate-50 ring-1 ring-slate-200 transition focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-500 xl:w-72">
              <Search className="pointer-events-none ml-3 size-4 text-slate-400 transition group-focus-within:text-brand-600" />
              <input
                className="h-full w-full bg-transparent pl-2.5 pr-8 text-sm outline-none placeholder:text-slate-400"
                placeholder="Search receipt number"
                value={filters.receipt_number}
                onChange={(e) => set({ receipt_number: e.target.value })}
                aria-label="Receipt number"
              />
              {filters.receipt_number && (
                <button type="button" aria-label="Clear search" onClick={() => set({ receipt_number: '' })} className="absolute right-2 grid size-6 place-items-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                  <X className="size-3.5" />
                </button>
              )}
            </label>

            <Pills label="Period" value={activePeriod?.key ?? 'custom'} onChange={(key) => { const r = ranges.find((x) => x.key === key); if (r) set({ date_from: r.from, date_to: r.to }); }}
              options={ranges.map((r) => ({ value: r.key, label: r.label }))} />

            <div className="flex h-10 items-center gap-1 rounded-xl bg-slate-50 px-2 ring-1 ring-slate-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-500">
              <CalendarDays className="size-4 shrink-0 text-slate-400" />
              <input type="date" value={filters.date_from} onChange={(e) => set({ date_from: e.target.value })} aria-label="From date"
                className="h-full bg-transparent px-1 text-xs text-slate-700 outline-none" />
              <span className="text-xs text-slate-400">→</span>
              <input type="date" value={filters.date_to} onChange={(e) => set({ date_to: e.target.value })} aria-label="To date"
                className="h-full bg-transparent px-1 text-xs text-slate-700 outline-none" />
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
              <Pills label="Type" value={filters.channel} onChange={(channel) => set({ channel })}
                options={[{ value: '', label: 'All' }, { value: 'in_store', label: 'In store' }, { value: 'pickup', label: 'Pickup' }, { value: 'delivery', label: 'Delivery' }]} />
              <Pills label="Status" value={filters.status} onChange={(status) => set({ status })}
                options={[{ value: '', label: 'All' }, { value: 'completed', label: 'Completed' }, { value: 'voided', label: 'Voided' }]} />
            </div>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Filtered by</span>
              {chips.map((chip) => (
                <button key={chip.key} type="button" onClick={chip.clear}
                  className="group inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-3 pr-2 text-xs font-medium text-brand-800 ring-1 ring-brand-200 transition hover:bg-brand-100">
                  {chip.label}
                  <X className="size-3 text-brand-500 group-hover:text-brand-800" />
                </button>
              ))}
              <button type="button" onClick={resetFilters} className="text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">
                Clear all
              </button>
            </div>
          )}
        </div>

        {list.error ? (
          <ErrorBanner error={list.error} className="m-4" />
        ) : list.isPending ? (
          <LoadingRows />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
              <ReceiptText className="size-6" />
            </span>
            <p className="mt-4 font-display font-semibold text-slate-900">{filtered ? 'No sales match these filters' : 'No sales yet'}</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">{filtered ? 'Try another period, status or receipt number.' : 'Sales rung up at the register will appear here.'}</p>
            {filtered && (
              <button type="button" onClick={resetFilters} className="mt-4 inline-flex h-9 items-center gap-2 rounded-full bg-brand-700 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-800">
                <RotateCcw className="size-3.5" /> Reset filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="sp-cards w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white/95 backdrop-blur">
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400">
                  <th scope="col" className="py-3 pl-5 pr-3 text-left font-semibold">Receipt</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Type</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Time</th>
                  {viewAll && <th scope="col" className="px-3 py-3 text-left font-semibold">Branch</th>}
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Cashier</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Discount</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Status</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Amount</th>
                  <th scope="col" className="w-10 pr-4" />
                </tr>
              </thead>
              {groupByDay(rows).map((day) => (
                <tbody key={day.date} className="border-b border-slate-100 last:border-b-0">
                  <tr className="bg-gradient-to-r from-brand-50/70 via-slate-50/60 to-slate-50/30">
                    <th scope="colgroup" colSpan={viewAll ? 6 : 5} className="py-2.5 pl-5 pr-3 text-left">
                      <span className="inline-flex items-center gap-2.5">
                        <span className="grid size-7 place-items-center rounded-lg bg-white text-brand-600 shadow-sm ring-1 ring-slate-900/5">
                          <CalendarDays className="size-3.5" />
                        </span>
                        <span className="text-[13px] font-semibold text-slate-800">{longDate(day.date)}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                          {day.count} {day.count === 1 ? 'sale' : 'sales'}
                        </span>
                      </span>
                    </th>
                    <td colSpan={3} className="py-2.5 pr-5 text-right">
                      {day.refunds > 0 && <span className="mr-3 text-xs tabular-nums text-rose-600">−{formatMoney(day.refunds.toFixed(2))} refunded</span>}
                      <span className="font-display text-sm font-bold tabular-nums text-brand-900">{formatMoney(day.gross.toFixed(2))}</span>
                    </td>
                  </tr>
                  {day.sales.map((sale) => {
                    const isVoid = sale.status === 'voided';
                    const status = STATUS[isVoid ? 'voided' : sale.payment_status] ?? STATUS.paid;
                    const discount = DISCOUNT[sale.discount.type];
                    const cashier = sale.cashier?.name;
                    const channel = CHANNEL[sale.channel ?? 'in_store'];
                    return (
                      <tr
                        key={sale.id}
                        onClick={() => navigate(`/t/${tenantId}/sales/${sale.id}`)}
                        onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/t/${tenantId}/sales/${sale.id}`); }}
                        tabIndex={0}
                        aria-label={`Open receipt ${sale.receipt_number}`}
                        className="group cursor-pointer border-t border-slate-100 transition-colors hover:bg-brand-50/50 focus-visible:bg-brand-50/60 focus-visible:outline-none"
                      >
                        <td className="py-3.5 pl-5 pr-3">
                          <span className="inline-flex items-center gap-3">
                            <span className={cx('grid size-8 place-items-center rounded-lg ring-1 transition', isVoid ? 'bg-slate-50 text-slate-300 ring-slate-200' : 'bg-white text-brand-600 ring-slate-200 group-hover:ring-brand-200')}>
                              <Receipt className="size-4" />
                            </span>
                            <span className={cx('font-mono text-[0.8rem] font-medium tracking-tight', isVoid ? 'text-slate-400 line-through' : 'text-slate-900')}>
                              {sale.receipt_number}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-3.5">
                          <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', channel.className)}>
                            <channel.icon className="size-3.5" /> {channel.label}
                          </span>
                          {sale.online_order && (
                            <span className="mt-1 block truncate text-[11px] text-slate-500" title={sale.online_order.delivery_address ?? undefined}>
                              {sale.online_order.order_number}{sale.online_order.rider_name ? ` · ${sale.online_order.rider_name}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3.5 tabular-nums text-slate-500">{timeOf(sale.sold_at)}</td>
                        {viewAll && <td className="px-3 py-3.5"><BranchTag id={sale.branch_id} /></td>}
                        <td className="px-3 py-3.5">
                          {cashier ? (
                            <span className="inline-flex items-center gap-2.5">
                              <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-[10px] font-bold text-white">{initials(cashier)}</span>
                              <span className="text-slate-700">{cashier}</span>
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-3.5">
                          {discount ? (
                            <span className={cx('rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset', discount.className)}>{discount.label}</span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-3.5">
                          <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', status.pill)}>
                            <span className={cx('size-1.5 rounded-full', status.dot)} />
                            {status.label}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-right">
                          <span className={cx('block font-display text-[0.95rem] font-semibold tabular-nums', isVoid ? 'text-slate-400 line-through' : 'text-slate-900')}>
                            {formatMoney(sale.total)}
                          </span>
                          {Number(sale.refunded_total) > 0 && (
                            <span className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] tabular-nums text-rose-600">
                              <ArrowDownRight className="size-3" />{formatMoney(sale.refunded_total)} refunded
                            </span>
                          )}
                        </td>
                        <td className="pr-4 text-right">
                          <ChevronRight className="inline size-4 -translate-x-1 text-slate-300 opacity-0 transition group-hover:translate-x-0 group-hover:text-brand-600 group-hover:opacity-100" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}
        <Pagination page={page} data={list.data} onPage={setPage} />
      </section>
    </div>
  );
}

/* --------------------------------------------------------------------------- Pieces */

const TINTS = {
  slate: 'bg-slate-100 text-slate-600',
  brand: 'bg-brand-50 text-brand-600',
  rose: 'bg-rose-50 text-rose-600',
};

function Kpi({ Icon, label, value, note, tint }: { Icon: LucideIcon; label: string; value: string | null; note: string; tint: keyof typeof TINTS }) {
  const tone = ({ brand: 'brand', emerald: 'brand', amber: 'warn', slate: 'default', rose: 'rose', sun: 'sun', sky: 'sky', violet: 'sky' } as const as Record<string, 'brand' | 'warn' | 'default' | 'rose' | 'sun' | 'sky'>)[tint] ?? 'default';
  return <StatCard icon={Icon} label={label} value={value} hint={note} tone={tone} />;
}

/** The headline figure: brand-green card with a bar showing how much of gross was refunded. */
function NetKpi({ value, refundShare, note }: { value: string | null; refundShare: number; note: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-5 text-white shadow-md shadow-brand-900/20">
      <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-sun-400/20 blur-xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-12 -left-6 size-28 rounded-full bg-white/5" />
      <div className="relative flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-100">Net sales</p>
        <span className="grid size-9 place-items-center rounded-xl bg-white/15 text-sun-300"><Wallet className="size-4" /></span>
      </div>
      {value === null ? (
        <span className="relative mt-3 block h-8 w-36 animate-pulse rounded-lg bg-white/15" />
      ) : (
        <p className="relative mt-2 font-display text-[1.65rem] font-bold leading-tight tabular-nums">{value}</p>
      )}
      <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-white/15" title={`${(100 - refundShare).toFixed(1)}% kept after refunds`}>
        <div className="h-full rounded-full bg-sun-400 transition-[width] duration-700" style={{ width: `${100 - refundShare}%` }} />
      </div>
      <p className="relative mt-1.5 text-xs text-brand-100/80">{note}</p>
    </div>
  );
}

function Pills({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-10 items-center gap-0.5 rounded-xl bg-slate-100 p-1 text-xs font-medium">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-full whitespace-nowrap rounded-lg px-3 transition',
            value === o.value ? 'bg-white text-brand-800 shadow-sm ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Placeholder rows shown while sales load. */
function LoadingRows() {
  return (
    <div className="divide-y divide-slate-100" role="status" aria-label="Loading sales">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <span className="size-8 animate-pulse rounded-lg bg-slate-100" />
          <span className="h-3 w-36 animate-pulse rounded bg-slate-100" />
          <span className="h-3 w-12 animate-pulse rounded bg-slate-100" />
          <span className="hidden h-3 w-28 animate-pulse rounded bg-slate-100 sm:block" />
          <span className="ml-auto h-3 w-20 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}
