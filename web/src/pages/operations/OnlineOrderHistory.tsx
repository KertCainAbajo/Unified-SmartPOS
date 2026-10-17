import { Ban, Bike, CalendarDays, CheckCircle2, ChevronDown, History, MapPin, Phone, ReceiptText, Search, StickyNote, Store, Timer, Wallet, X, XCircle, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button, ErrorBanner, Pagination, Spinner, cx } from '../../components/ui';
import { formatDate } from '../../lib/format';
import { useDebounced, useTenantQuery } from '../../lib/hooks';
import type { Paginated } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { daysAgo, money, qty, type OnlineOrder, type OrderKind, type OrderView } from './onlineOrders';

interface HistorySummary {
  orders: number;
  value: string;
  delivery: number;
  pickup: number;
  average_minutes: number | null;
  cancelled_by_customer: number;
  cancelled_by_store: number;
  top_cancel_reason: string | null;
}

const COLUMNS = 'lg:grid-cols-[150px_minmax(0,1.3fr)_150px_minmax(0,1.4fr)_150px_120px_20px]';
const PRESETS: { label: string; days: number }[] = [
  { label: 'Today', days: 0 },
  { label: '7 days', days: 6 },
  { label: '30 days', days: 29 },
  { label: '90 days', days: 89 },
];

const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
function dayLabel(key: string) {
  if (key === daysAgo(0)) return 'Today';
  if (key === daysAgo(1)) return 'Yesterday';
  return new Date(`${key}T00:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function duration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return minutes % 60 ? `${h} hr ${minutes % 60} min` : `${h} hr`;
}

/** Completed or cancelled online orders as a day-by-day ledger, with figures for the chosen period. */
export function OrderHistory({ view, kind, search, range, onRange, onClearFilters }: {
  view: Exclude<OrderView, 'active'>;
  kind: OrderKind;
  search: string;
  range: { from: string; to: string };
  onRange: (range: { from: string; to: string }) => void;
  onClearFilters: () => void;
}) {
  const { scopeBranchId, tenantId, can } = useTenant();
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const q = useDebounced(search.trim(), 300);
  useEffect(() => setPage(1), [view, kind, q, range.from, range.to]);

  const list = useTenantQuery<Paginated<OnlineOrder> & { summary: HistorySummary }>('/online-orders', {
    branch_id: scopeBranchId, status: view, fulfilment: kind === 'all' ? undefined : kind, q: q || undefined,
    date_from: range.from, date_to: range.to, per_page: 25, page,
  });
  const cancelled = view === 'cancelled';
  const summary = list.data?.summary;
  const orders = list.data?.data ?? [];
  const filtered = kind !== 'all' || !!q;
  const days = orders.reduce<{ key: string; orders: OnlineOrder[] }[]>((acc, order) => {
    const key = dayKey(order.placed_at);
    const last = acc[acc.length - 1];
    if (last?.key === key) last.orders.push(order); else acc.push({ key, orders: [order] });
    return acc;
  }, []);

  return (
    <div className="space-y-5">
      {/* Period presets */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] font-bold uppercase tracking-[.16em] text-slate-400">Period</span>
        {PRESETS.map((p) => {
          const active = range.from === daysAgo(p.days) && range.to === daysAgo(0);
          return (
            <button key={p.label} onClick={() => onRange({ from: daysAgo(p.days), to: daysAgo(0) })} className={cx('rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition', active ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200 hover:text-brand-700 hover:ring-brand-300')}>
              {p.label}
            </button>
          );
        })}
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500"><CalendarDays className="size-3.5" /> {formatDate(range.from)} – {formatDate(range.to)}</span>
      </div>

      {/* Figures for the whole period */}
      <div className="grid overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label={cancelled ? 'Cancelled orders' : 'Completed orders'} value={summary ? String(summary.orders) : '–'} icon={cancelled ? XCircle : CheckCircle2} tone={cancelled ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-700'} />
        <Figure label={cancelled ? 'Value not sold' : 'Order value'} value={summary ? money(summary.value) : '–'} hint="Estimated order totals" icon={Wallet} tone="bg-amber-50 text-amber-700" />
        <Figure
          label="Pickup · Delivery"
          value={summary ? `${summary.pickup} · ${summary.delivery}` : '–'}
          icon={Bike}
          tone="bg-orange-50 text-orange-600"
          extra={summary && summary.orders > 0 ? (
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <span className="bg-slate-500" style={{ width: `${(summary.pickup / summary.orders) * 100}%` }} />
              <span className="bg-orange-500" style={{ width: `${(summary.delivery / summary.orders) * 100}%` }} />
            </div>
          ) : undefined}
        />
        {cancelled
          ? <Figure label="Cancelled by" value={summary ? `${summary.cancelled_by_customer} customer · ${summary.cancelled_by_store} store` : '–'} hint={summary?.top_cancel_reason ? `Most common: ${summary.top_cancel_reason}` : undefined} icon={Ban} tone="bg-slate-100 text-slate-600" small />
          : <Figure label="Average time to complete" value={summary?.average_minutes != null ? duration(summary.average_minutes) : '–'} hint="From order placed to paid" icon={Timer} tone="bg-violet-50 text-violet-600" />}
      </div>

      {/* Ledger */}
      {list.isPending ? <Spinner label="Loading order history…" />
        : list.isError ? <ErrorBanner error={list.error} />
          : !orders.length ? (
            <div className="rounded-3xl bg-white px-6 py-14 text-center ring-1 ring-slate-200">
              <span className={cx('mx-auto grid size-16 place-items-center rounded-2xl', cancelled ? 'bg-red-50 text-red-500' : 'bg-brand-50 text-brand-600')}>
                {filtered ? <Search className="size-7" /> : <History className="size-7" />}
              </span>
              <h2 className="mt-4 font-display text-lg font-bold text-slate-900">
                No {cancelled ? 'cancelled' : 'completed'}{kind !== 'all' ? ` ${kind}` : ''} orders{q ? ` matching “${q}”` : ''}
              </h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                Nothing between {formatDate(range.from)} and {formatDate(range.to)}. Try a longer period{filtered ? ' or clear the filters' : ''}.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {range.from !== daysAgo(89) && <Button variant="secondary" icon={<CalendarDays className="size-4" />} onClick={() => onRange({ from: daysAgo(89), to: daysAgo(0) })}>Show last 90 days</Button>}
                {filtered && <Button variant="secondary" icon={<X className="size-4" />} onClick={onClearFilters}>Clear filters</Button>}
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
              <div className={cx('hidden gap-4 border-b border-slate-100 bg-slate-50/80 px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 lg:grid', COLUMNS)}>
                <span>Order</span><span>Customer</span><span>Type</span><span>Items</span><span>{cancelled ? 'Cancelled by' : 'Took'}</span><span className="text-right">Total</span><span />
              </div>
              {days.map((day) => (
                <section key={day.key}>
                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-5 py-2">
                    <span className="text-xs font-bold text-slate-700">{dayLabel(day.key)}</span>
                    <span className="text-xs text-slate-500">
                      {day.orders.length} {day.orders.length === 1 ? 'order' : 'orders'} · <b className="text-slate-700">{money(day.orders.reduce((s, o) => s + Number(o.estimated_total), 0))}</b>
                    </span>
                  </div>
                  {day.orders.map((order) => (
                    <HistoryRow
                      key={order.id}
                      order={order}
                      open={openId === order.id}
                      onToggle={() => setOpenId(openId === order.id ? null : order.id)}
                      saleHref={order.sale_id && can('sales.view_all') ? `/t/${tenantId}/sales/${order.sale_id}` : undefined}
                    />
                  ))}
                </section>
              ))}
              {(list.data?.meta?.last_page ?? list.data?.last_page ?? 1) > 1 && <div className="border-t border-slate-100 px-5 py-3"><Pagination page={page} data={list.data} onPage={setPage} /></div>}
            </div>
          )}
    </div>
  );
}

function Figure({ label, value, hint, icon: Icon, tone, extra, small }: { label: string; value: string; hint?: string; icon: LucideIcon; tone: string; extra?: ReactNode; small?: boolean }) {
  return (
    <div className="flex gap-3 border-b border-slate-100 p-5 last:border-b-0 sm:odd:border-r xl:border-b-0 xl:border-r xl:last:border-r-0">
      <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', tone)}><Icon className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-500">{label}</p>
        <p className={cx('mt-0.5 truncate font-display font-bold text-slate-900', small ? 'text-base leading-8' : 'text-2xl')}>{value}</p>
        {hint && <p className="mt-0.5 truncate text-[11px] text-slate-400" title={hint}>{hint}</p>}
        {extra}
      </div>
    </div>
  );
}

function HistoryRow({ order, open, onToggle, saleHref }: { order: OnlineOrder; open: boolean; onToggle: () => void; saleHref?: string }) {
  const delivery = order.fulfilment === 'delivery';
  const cancelled = order.status === 'cancelled';
  const end = cancelled ? order.cancelled_at : order.completed_at;
  const took = end ? Math.max(0, Math.round((new Date(end).getTime() - new Date(order.placed_at).getTime()) / 60000)) : null;
  const names = order.items.map((i) => i.name);
  const byCustomer = order.cancelled_by === 'customer';
  const steps: [string, string | null | undefined][] = [
    ['Placed', order.placed_at],
    ['Confirmed', order.confirmed_at],
    ['Ready', order.ready_at],
    ...(delivery ? [[order.rider_name ? `Sent out with ${order.rider_name}` : 'Sent out', order.dispatched_at] as [string, string | null | undefined]] : []),
    [cancelled ? `Cancelled by ${byCustomer ? 'customer' : 'store'}` : delivery ? 'Delivered and paid' : 'Picked up and paid', end],
  ];
  const timeline = steps.filter(([, at]) => !!at) as [string, string][];

  return (
    <div className={cx('border-b border-slate-100 last:border-b-0', open && 'bg-brand-50/30')}>
      <button onClick={onToggle} aria-expanded={open} className={cx('grid w-full gap-x-4 gap-y-1.5 px-5 py-3.5 text-left transition hover:bg-slate-50 lg:items-center', COLUMNS)}>
        <span>
          <span className="block font-display text-sm font-bold text-slate-900">{order.order_number}</span>
          <span className="text-xs text-slate-500">{clock(order.placed_at)} · {order.branch.name}</span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-800">{order.contact_name}</span>
          <span className="block truncate text-xs text-slate-500">{order.contact_phone}</span>
        </span>
        <span className="min-w-0">
          <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', delivery ? 'bg-orange-100/70 text-orange-800' : 'bg-slate-100 text-slate-700')}>
            {delivery ? <Bike className="size-3" /> : <Store className="size-3" />} {delivery ? 'Delivery' : 'Pickup'}
          </span>
          {delivery && order.rider_name && <span className="mt-0.5 block truncate text-[11px] text-slate-500">Rider: {order.rider_name}</span>}
        </span>
        <span className="min-w-0 truncate text-sm text-slate-600" title={names.join(', ')}>
          <b className="text-slate-800">{order.items.length}</b> · {names.slice(0, 2).join(', ')}{names.length > 2 && ` +${names.length - 2}`}
        </span>
        <span className="min-w-0 text-xs text-slate-600">
          {cancelled ? <>
            <span className={cx('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold', byCustomer ? 'bg-slate-100 text-slate-700' : 'bg-red-50 text-red-700')}>{byCustomer ? 'Customer' : 'Store'}</span>
            {order.cancel_reason && <span className="mt-0.5 block truncate text-[11px] text-slate-500" title={order.cancel_reason}>{order.cancel_reason}</span>}
          </> : took != null && <span className="inline-flex items-center gap-1"><Timer className="size-3.5 text-slate-400" /> {duration(took)}</span>}
        </span>
        <span className={cx('font-display text-base font-bold lg:text-right', cancelled ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-900')}>{money(order.estimated_total)}</span>
        <ChevronDown className={cx('hidden size-4 text-slate-400 transition lg:block', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="grid gap-5 px-5 pb-5 lg:grid-cols-[260px_minmax(0,1fr)_minmax(0,1fr)]">
          <ol className="relative ml-1.5 space-y-3 border-l-2 border-slate-200 pl-5">
            {timeline.map(([label, at], i) => (
              <li key={label} className="relative">
                <span className={cx('absolute -left-[27px] top-1 size-3 rounded-full ring-4 ring-white', i === timeline.length - 1 ? (cancelled ? 'bg-red-500' : 'bg-brand-600') : 'bg-slate-300')} />
                <p className="text-sm font-semibold text-slate-800">{label}</p>
                <p className="text-xs text-slate-500">{new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
              </li>
            ))}
          </ol>
          <ul className="divide-y divide-slate-100 self-start rounded-xl bg-white ring-1 ring-slate-200">
            {order.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate"><b className="mr-1.5 text-slate-700">{qty(item.quantity)}×</b>{item.name}</span>
                <span className="shrink-0 tabular-nums text-slate-700">{money(item.line_total)}</span>
              </li>
            ))}
            <li className="flex justify-between px-3 py-2 text-sm font-bold"><span>Estimated total</span><span>{money(order.estimated_total)}</span></li>
          </ul>
          <div className="space-y-3 self-start">
            {delivery && (
              <div className="rounded-xl bg-orange-50/60 p-3 text-sm ring-1 ring-orange-200/70">
                <p className="flex gap-2 text-slate-800"><MapPin className="mt-0.5 size-4 shrink-0 text-orange-600" /> {order.delivery_address}</p>
                <p className="mt-2 text-xs text-slate-600">Customer paid with <b>{money(order.cash_amount ?? order.estimated_total)}</b> · change <b>{money(order.change_due ?? 0)}</b></p>
              </div>
            )}
            <p className="flex items-center gap-2 text-sm text-slate-600"><Phone className="size-4 shrink-0 text-slate-400" /> <span className="truncate">{order.contact_phone} · {order.account.email}</span></p>
            {order.note && <p className="flex gap-2 rounded-xl bg-yellow-50 px-3 py-2 text-sm text-yellow-900 ring-1 ring-yellow-200"><StickyNote className="mt-0.5 size-4 shrink-0" /> {order.note}</p>}
            {saleHref && <Link to={saleHref} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"><ReceiptText className="size-4" /> View sale receipt</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
