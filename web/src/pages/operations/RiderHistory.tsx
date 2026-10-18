import { CalendarDays, CheckCircle2, ChevronDown, Clock3, MapPin, Package, Search, Timer, Wallet, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DateRange, ErrorBanner, Pagination, Spinner, cx } from '../../components/ui';
import { formatDate } from '../../lib/format';
import { useDebounced, useTenantQuery } from '../../lib/hooks';
import type { Paginated } from '../../lib/types';
import { daysAgo, money, qty, type OnlineOrder } from './onlineOrders';

interface HistorySummary { deliveries: number; value: string; average_minutes: number | null; days_worked: number; not_handed_in: string }

const PRESETS = [{ label: '7 days', days: 6 }, { label: '30 days', days: 29 }, { label: '90 days', days: 89 }];
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
function dayLabel(key: string) {
  if (key === daysAgo(0)) return 'Today';
  if (key === daysAgo(1)) return 'Yesterday';
  return new Date(`${key}T00:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '–');
const tripMinutes = (o: OnlineOrder) => (o.dispatched_at && o.delivered_at ? Math.max(0, Math.round((new Date(o.delivered_at).getTime() - new Date(o.dispatched_at).getTime()) / 60000)) : null);
const duration = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60 ? `${m % 60} min` : ''}`.trim());

/** Every delivery the signed-in rider made in a period, day by day, with totals for the period. */
export function RiderHistory() {
  const [range, setRange] = useState(() => ({ from: daysAgo(29), to: daysAgo(0) }));
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const q = useDebounced(search.trim(), 300);
  useEffect(() => setPage(1), [range.from, range.to, q]);
  const list = useTenantQuery<Paginated<OnlineOrder> & { summary: HistorySummary }>('/deliveries/history', { date_from: range.from, date_to: range.to, q: q || undefined, page });

  const summary = list.data?.summary;
  const orders = list.data?.data ?? [];
  const days = orders.reduce<{ key: string; orders: OnlineOrder[] }[]>((acc, o) => {
    const key = dayKey(o.delivered_at!);
    const last = acc[acc.length - 1];
    if (last?.key === key) last.orders.push(o); else acc.push({ key, orders: [o] });
    return acc;
  }, []);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200 xl:flex-row xl:items-center">
        <div className="flex shrink-0 gap-1 rounded-xl bg-slate-100 p-1">
          {PRESETS.map((p) => {
            const active = range.from === daysAgo(p.days) && range.to === daysAgo(0);
            return <button key={p.label} type="button" onClick={() => setRange({ from: daysAgo(p.days), to: daysAgo(0) })} className={cx('flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition xl:flex-none', active ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>{p.label}</button>;
          })}
        </div>
        <DateRange from={range.from} to={range.to} onChange={setRange} className="xl:w-[280px]" />
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order no., customer or address" aria-label="Search deliveries" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100" />
        </label>
      </div>

      {/* Period totals */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Figure icon={CheckCircle2} tone="bg-brand-50 text-brand-700" label="Deliveries" value={summary ? String(summary.deliveries) : '–'} hint={summary ? `${summary.days_worked} ${summary.days_worked === 1 ? 'day' : 'days'} worked` : undefined} />
        <Figure icon={Wallet} tone="bg-amber-50 text-amber-700" label="Cash collected" value={summary ? money(summary.value) : '–'} hint="Order totals" />
        <Figure icon={Timer} tone="bg-violet-50 text-violet-600" label="Average trip" value={summary?.average_minutes != null ? duration(summary.average_minutes) : '–'} hint="Leaving the store to delivered" />
        <Figure icon={Clock3} tone={Number(summary?.not_handed_in ?? 0) > 0 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'} label="Not handed in yet" value={summary ? money(summary.not_handed_in) : '–'} hint="Give to the cashier" />
      </div>

      {/* Ledger */}
      {list.isPending ? <Spinner label="Loading your history…" />
        : list.isError ? <ErrorBanner error={list.error} />
          : !orders.length ? (
            <div className="rounded-3xl bg-white px-6 py-14 text-center ring-1 ring-slate-200">
              <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-brand-50 text-brand-600"><CalendarDays className="size-8" /></span>
              <h2 className="mt-4 font-display text-lg font-bold">No deliveries {q ? `matching “${q}”` : 'in this period'}</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{formatDate(range.from)} – {formatDate(range.to)}. Try a longer period.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200">
              {days.map((day) => (
                <section key={day.key}>
                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-2.5">
                    <span className="text-sm font-bold text-slate-800">{dayLabel(day.key)}</span>
                    <span className="text-xs text-slate-500">{day.orders.length} {day.orders.length === 1 ? 'delivery' : 'deliveries'} · <b className="text-slate-800">{money(day.orders.reduce((s, o) => s + Number(o.estimated_total), 0))}</b></span>
                  </div>
                  {day.orders.map((o) => {
                    const handedIn = o.status === 'completed';
                    const minutes = tripMinutes(o);
                    const open = openId === o.id;
                    return (
                      <div key={o.id} className={cx('border-b border-slate-100 last:border-b-0', open && 'bg-brand-50/30')}>
                        <button type="button" onClick={() => setOpenId(open ? null : o.id)} aria-expanded={open} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-slate-50">
                          <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', handedIn ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700')}>{handedIn ? <CheckCircle2 className="size-5" /> : <Wallet className="size-5" />}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-slate-900">{o.contact_name} <span className="font-normal text-slate-400">· {o.order_number}</span></span>
                            <span className="block truncate text-xs text-slate-500">{clock(o.delivered_at)}{minutes != null && ` · ${duration(minutes)} trip`} · {o.delivery_address}</span>
                          </span>
                          <span className="text-right">
                            <span className="block font-display font-bold text-slate-900">{money(o.estimated_total)}</span>
                            <span className={cx('block text-[11px] font-semibold', handedIn ? 'text-brand-700' : 'text-amber-700')}>{handedIn ? 'Handed in' : 'To hand in'}</span>
                          </span>
                          <ChevronDown className={cx('hidden size-4 shrink-0 text-slate-400 transition sm:block', open && 'rotate-180')} />
                        </button>
                        {open && (
                          <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
                            <ol className="space-y-2 text-sm">
                              <Row label="Ordered" value={clock(o.placed_at)} />
                              <Row label="Left the store" value={clock(o.dispatched_at)} />
                              <Row label="Delivered" value={clock(o.delivered_at)} />
                              <Row label="Collected" value={money(o.cash_amount ?? o.estimated_total)} />
                              <Row label="Change given" value={money(o.change_due ?? 0)} />
                              <p className="flex gap-2 pt-1 text-xs text-slate-500"><MapPin className="mt-0.5 size-3.5 shrink-0 text-orange-500" /> {o.delivery_address}</p>
                            </ol>
                            <ul className="divide-y divide-slate-100 self-start rounded-xl ring-1 ring-slate-200">
                              <li className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-500"><Package className="size-3.5" /> {o.items.length} {o.items.length === 1 ? 'item' : 'items'} · from {o.branch.name}</li>
                              {o.items.map((i) => <li key={i.id} className="flex justify-between px-3 py-2 text-sm"><span className="truncate"><b className="mr-1.5">{qty(i.quantity)}×</b>{i.name}</span><span className="shrink-0 text-slate-600">{money(i.line_total)}</span></li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>
              ))}
              {(list.data?.meta?.last_page ?? list.data?.last_page ?? 1) > 1 && <div className="border-t border-slate-100 px-5 py-3"><Pagination page={page} data={list.data} onPage={setPage} /></div>}
            </div>
          )}
    </div>
  );
}

function Figure({ icon: Icon, tone, label, value, hint }: { icon: LucideIcon; tone: string; label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', tone)}><Icon className="size-5" /></span>
      <div className="min-w-0">
        <p className="text-xs font-semibold leading-tight text-slate-500">{label}</p>
        <p className="truncate font-display text-lg font-bold text-slate-900">{value}</p>
        {hint && <p className="hidden truncate text-[11px] text-slate-400 sm:block">{hint}</p>}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <li className="flex justify-between gap-3"><span className="text-slate-500">{label}</span><span className="font-semibold text-slate-800">{value}</span></li>;
}
