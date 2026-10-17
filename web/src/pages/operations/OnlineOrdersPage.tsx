import { useQueryClient } from '@tanstack/react-query';
import {
  Bike, Check, CheckCircle2, ChefHat, ChevronDown, Clock3, ExternalLink, Inbox, MapPin, PackageCheck, Phone, ReceiptText,
  RefreshCw, Search, Store, StickyNote, Wallet, X, XCircle, type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, DateRange, ErrorBanner, Field, Input, Modal, Spinner, cx } from '../../components/ui';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Paginated } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { OrderHistory } from './OnlineOrderHistory';
import { daysAgo, money, qty, type OnlineOrder, type OrderKind as Kind, type OrderStatus as Status, type OrderView as View } from './onlineOrders';

interface StatusChange { id: number; status: string; cancel_reason?: string; rider_name?: string; rider_phone?: string }
type Stage = 'all' | 'pending' | 'confirmed' | 'ready' | 'out_for_delivery';

/** Look of each status, used by the stage cards, card accents and badges. */
const STATUS: Record<Status, { label: string; icon: LucideIcon; badge: string; accent: string; tile: string }> = {
  pending: { label: 'New', icon: Inbox, badge: 'bg-sky-50 text-sky-700 ring-sky-600/20', accent: 'bg-sky-500', tile: 'bg-sky-50 text-sky-600' },
  confirmed: { label: 'Preparing', icon: ChefHat, badge: 'bg-violet-50 text-violet-700 ring-violet-600/20', accent: 'bg-violet-500', tile: 'bg-violet-50 text-violet-600' },
  ready: { label: 'Ready', icon: PackageCheck, badge: 'bg-amber-50 text-amber-800 ring-amber-600/25', accent: 'bg-amber-400', tile: 'bg-amber-50 text-amber-600' },
  out_for_delivery: { label: 'Out for delivery', icon: Bike, badge: 'bg-orange-50 text-orange-700 ring-orange-600/20', accent: 'bg-orange-500', tile: 'bg-orange-50 text-orange-600' },
  completed: { label: 'Completed', icon: CheckCircle2, badge: 'bg-brand-50 text-brand-700 ring-brand-600/20', accent: 'bg-brand-500', tile: 'bg-brand-50 text-brand-600' },
  cancelled: { label: 'Cancelled', icon: XCircle, badge: 'bg-red-50 text-red-700 ring-red-600/20', accent: 'bg-red-400', tile: 'bg-red-50 text-red-600' },
};
const STAGES: Exclude<Stage, 'all'>[] = ['pending', 'confirmed', 'ready', 'out_for_delivery'];
const CANCEL_REASONS = ['Item out of stock', 'Customer asked to cancel', 'Could not reach customer', 'Unable to deliver'];

function ago(iso: string, now: number) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} hr ${minutes % 60} min ago` : new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function OnlineOrdersPage() {
  const { scopeBranchId, can, tenantId, tenant } = useTenant();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('active');
  const [stage, setStage] = useState<Stage>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [search, setSearch] = useState('');
  const [dispatching, setDispatching] = useState<OnlineOrder | null>(null);
  const [cancelling, setCancelling] = useState<OnlineOrder | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(t); }, []);

  const [range, setRange] = useState(() => ({ from: daysAgo(29), to: daysAgo(0) }));
  const list = useTenantQuery<Paginated<OnlineOrder>>(
    '/online-orders',
    { branch_id: scopeBranchId, open: true, per_page: 100 },
    { refetchInterval: 30000, enabled: view === 'active' },
  );
  const status = useTenantMutation<StatusChange, { data: OnlineOrder }>('POST', (body) => `/online-orders/${body.id}/status`, {
    success: (r) => `${r.data.order_number}: ${STATUS[r.data.status].label}.`,
    onSuccess: () => { setDispatching(null); setCancelling(null); void queryClient.invalidateQueries({ queryKey: ['t'] }); },
    toastErrors: true,
  });
  const ringUp = (order: OnlineOrder) => navigate(`/t/${tenantId}/pos?online_order_id=${order.id}`);
  const canAct = can('sales.create');

  const all = list.data?.data ?? [];
  const term = search.trim().toLowerCase();
  const matches = (o: OnlineOrder) => (kind === 'all' || o.fulfilment === kind)
    && (!term || `${o.order_number} ${o.contact_name} ${o.contact_phone} ${o.delivery_address ?? ''}`.toLowerCase().includes(term));
  const counts = Object.fromEntries(STAGES.map((s) => [s, all.filter((o) => o.status === s && (kind === 'all' || o.fulfilment === kind)).length])) as Record<Exclude<Stage, 'all'>, number>;
  const shown = all.filter((o) => matches(o) && (view !== 'active' || stage === 'all' || o.status === stage));
  const changeToPrepare = all.filter((o) => o.fulfilment === 'delivery' && ['ready', 'out_for_delivery'].includes(o.status))
    .reduce((sum, o) => sum + Number(o.change_due ?? 0), 0);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.18em] text-brand-700">Pickup &amp; delivery</p>
          <h1 className="mt-1 font-display text-[28px] font-bold leading-tight text-slate-900">Online orders</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">Confirm and prepare orders, send deliveries out with a rider, then record the payment at the POS.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
            <span className={cx('size-2 rounded-full', list.isFetching ? 'animate-pulse bg-amber-400' : 'bg-brand-500')} />
            {view === 'active' ? 'Live · refreshes every 30 s' : 'History'}
          </span>
          <a href={`/shop/${tenant.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-white hover:text-brand-700"><ExternalLink className="size-4" /> Open shop</a>
          <Button variant="secondary" icon={<RefreshCw className={cx('size-4', list.isFetching && 'animate-spin')} />} onClick={() => queryClient.invalidateQueries({ queryKey: ['t', tenantId, '/online-orders'] })}>Refresh</Button>
        </div>
      </div>

      {/* Stage cards (active view) */}
      {view === 'active' && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StageCard label="All active" count={STAGES.reduce((s, k) => s + counts[k], 0)} icon={ReceiptText} tile="bg-slate-100 text-slate-600" active={stage === 'all'} onClick={() => setStage('all')} />
          {STAGES.map((s) => <StageCard key={s} label={STATUS[s].label} count={counts[s]} icon={STATUS[s].icon} tile={STATUS[s].tile} active={stage === s} onClick={() => setStage(s)} pulse={s === 'pending' && counts[s] > 0} />)}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200 lg:flex-row lg:items-center">
        <div className="flex rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Order list">
          {(['active', 'completed', 'cancelled'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => { setView(v); setStage('all'); }} className={cx('rounded-lg px-3.5 py-1.5 text-sm font-semibold capitalize transition', view === v ? 'bg-white text-brand-800 shadow-sm ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-800')}>{v}</button>
          ))}
        </div>
        <div className="flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Order type">
          {([['all', 'All types', ReceiptText], ['pickup', 'Pickup', Store], ['delivery', 'Delivery', Bike]] as const).map(([value, label, Icon]) => (
            <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)} className={cx('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition', kind === value ? 'bg-white text-brand-800 shadow-sm ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-800')}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        {view !== 'active' && <DateRange from={range.from} to={range.to} onChange={setRange} className="lg:w-[280px]" />}
        <label className="relative flex-1 lg:max-w-sm lg:ml-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order no., customer, phone or address" aria-label="Search orders" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100" />
        </label>
        {view === 'active' && changeToPrepare > 0 && (
          <span className="inline-flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200"><Wallet className="size-4 text-amber-600" /> Change for riders: <b>{money(changeToPrepare)}</b></span>
        )}
      </div>

      {/* Orders */}
      {view !== 'active' ? (
        <OrderHistory
          view={view}
          kind={kind}
          search={search}
          range={range}
          onRange={setRange}
          onClearFilters={() => { setKind('all'); setSearch(''); }}
        />
      ) : list.isPending ? <Spinner label="Loading online orders…" />
        : list.isError ? <ErrorBanner error={list.error} />
          : !shown.length ? <EmptyOrders view={view} filtered={!!term || kind !== 'all' || stage !== 'all'} shopUrl={`/shop/${tenant.slug}`} />
            : (
              <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                {shown.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    now={now}
                    busy={status.isPending && status.variables?.id === order.id}
                    canAct={canAct}
                    onConfirm={() => status.mutate({ id: order.id, status: 'confirmed' })}
                    onReady={() => status.mutate({ id: order.id, status: 'ready' })}
                    onDispatch={() => setDispatching(order)}
                    onRingUp={() => ringUp(order)}
                    onCancel={() => setCancelling(order)}
                  />
                ))}
              </div>
            )}

      <DispatchModal order={dispatching} busy={status.isPending} onClose={() => setDispatching(null)} onSubmit={(rider_name, rider_phone) => dispatching && status.mutate({ id: dispatching.id, status: 'out_for_delivery', rider_name, rider_phone })} />
      <CancelModal order={cancelling} busy={status.isPending} onClose={() => setCancelling(null)} onSubmit={(cancel_reason) => cancelling && status.mutate({ id: cancelling.id, status: 'cancelled', cancel_reason })} />
    </div>
  );
}

function StageCard({ label, count, icon: Icon, tile, active, onClick, pulse }: { label: string; count: number; icon: LucideIcon; tile: string; active: boolean; onClick: () => void; pulse?: boolean }) {
  return (
    <button onClick={onClick} aria-pressed={active} className={cx('group relative flex items-center gap-3 rounded-2xl bg-white p-4 text-left ring-1 transition hover:-translate-y-0.5 hover:shadow-md', active ? 'ring-2 ring-brand-600 shadow-md' : 'ring-slate-200')}>
      <span className={cx('relative grid size-11 shrink-0 place-items-center rounded-xl', tile)}>
        <Icon className="size-5" />
        {pulse && <span className="absolute -right-0.5 -top-0.5 size-3 animate-ping rounded-full bg-sky-400" />}
      </span>
      <span className="min-w-0">
        <span className="block font-display text-2xl font-bold leading-none text-slate-900">{count}</span>
        <span className="mt-1 block truncate text-xs font-semibold text-slate-500">{label}</span>
      </span>
    </button>
  );
}

function OrderCard({ order, now, busy, canAct, onConfirm, onReady, onDispatch, onRingUp, onCancel }: {
  order: OnlineOrder; now: number; busy: boolean; canAct: boolean;
  onConfirm: () => void; onReady: () => void; onDispatch: () => void; onRingUp: () => void; onCancel: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const look = STATUS[order.status];
  const delivery = order.fulfilment === 'delivery';
  const minutes = (now - new Date(order.placed_at).getTime()) / 60000;
  const late = order.status === 'pending' && minutes >= 10;
  const items = expanded ? order.items : order.items.slice(0, 3);
  const flow: Status[] = delivery ? ['pending', 'confirmed', 'ready', 'out_for_delivery', 'completed'] : ['pending', 'confirmed', 'ready', 'completed'];
  const step = flow.indexOf(order.status);
  const open = ['pending', 'confirmed', 'ready', 'out_for_delivery'].includes(order.status);

  return (
    <article className="relative overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(15,23,42,.06)] ring-1 ring-slate-200 transition hover:shadow-lg">
      <span className={cx('absolute inset-y-0 left-0 w-1', look.accent)} aria-hidden />

      {/* Head */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-4 pl-5 pr-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-base font-bold text-slate-900">{order.order_number}</h2>
            <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1', look.badge)}><look.icon className="size-3" /> {look.label}</span>
            <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', delivery ? 'bg-orange-100/70 text-orange-800' : 'bg-slate-100 text-slate-700')}>
              {delivery ? <Bike className="size-3" /> : <Store className="size-3" />} {delivery ? 'Delivery' : 'Pickup'}
            </span>
          </div>
          <p className={cx('mt-1 flex items-center gap-1.5 text-xs', late ? 'font-semibold text-red-600' : 'text-slate-500')}>
            <Clock3 className="size-3.5" /> {ago(order.placed_at, now)}{late && ' · waiting'} <span className="text-slate-300">•</span> <span className="text-slate-500">{order.branch.name}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-lg font-bold text-slate-900">{money(order.estimated_total)}</p>
          <p className="whitespace-nowrap text-[11px] text-slate-400">{order.items.length} {order.items.length === 1 ? 'item' : 'items'} · estimate</p>
        </div>
      </div>

      <div className="space-y-4 py-4 pl-5 pr-4">
        {/* Progress */}
        {order.status !== 'cancelled' && (
          <div className="flex items-center gap-1" aria-label={`Step ${step + 1} of ${flow.length}`}>
            {flow.map((s, i) => <span key={s} title={STATUS[s].label} className={cx('h-1.5 flex-1 rounded-full', i <= step ? STATUS[order.status].accent : 'bg-slate-200')} />)}
          </div>
        )}

        {/* Customer */}
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-50 font-display text-sm font-bold text-brand-700">{order.contact_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-slate-900">{order.contact_name}</p>
            <p className="truncate text-xs text-slate-500">{order.account.email}</p>
          </div>
          <a href={`tel:${order.contact_phone}`} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-200 transition hover:bg-brand-50"><Phone className="size-3.5" /> {order.contact_phone}</a>
        </div>

        {/* Delivery details */}
        {delivery && (
          <div className="rounded-xl bg-orange-50/60 p-3 ring-1 ring-orange-200/70">
            <p className="flex gap-2 text-sm text-slate-800"><MapPin className="mt-0.5 size-4 shrink-0 text-orange-600" /> {order.delivery_address}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-orange-100">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Customer pays</p>
                <p className="font-display text-base font-bold text-slate-900">{money(order.cash_amount ?? order.estimated_total)}</p>
              </div>
              <div className="rounded-lg bg-amber-100 px-3 py-2 ring-1 ring-amber-300">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Bring change</p>
                <p className="font-display text-base font-bold text-amber-900">{money(order.change_due ?? 0)}</p>
              </div>
            </div>
            {order.rider_name && <p className="mt-2.5 flex items-center gap-2 text-xs text-slate-600"><Bike className="size-3.5 text-orange-600" /> Rider: <b className="text-slate-800">{order.rider_name}</b>{order.rider_phone && <> · <a className="text-brand-700 hover:underline" href={`tel:${order.rider_phone}`}>{order.rider_phone}</a></>}</p>}
          </div>
        )}

        {order.note && <p className="flex gap-2 rounded-xl bg-yellow-50 px-3 py-2 text-sm text-yellow-900 ring-1 ring-yellow-200"><StickyNote className="mt-0.5 size-4 shrink-0" /> {order.note}</p>}
        {order.status === 'cancelled' && order.cancel_reason && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">Cancelled: {order.cancel_reason}</p>}

        {/* Items */}
        <div>
          <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-100">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="grid h-6 min-w-6 place-items-center rounded-md bg-slate-100 px-1 text-xs font-bold text-slate-700">{qty(item.quantity)}</span>
                  <span className="truncate text-slate-800">{item.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">{item.unit}</span>
                </span>
                <span className="shrink-0 font-medium tabular-nums text-slate-700">{money(item.line_total)}</span>
              </li>
            ))}
          </ul>
          {order.items.length > 3 && (
            <button onClick={() => setExpanded((v) => !v)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
              <ChevronDown className={cx('size-3.5 transition', expanded && 'rotate-180')} /> {expanded ? 'Show less' : `Show ${order.items.length - 3} more`}
            </button>
          )}
        </div>
      </div>

      {/* Actions */}
      {canAct && open && (
        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 py-3 pl-5 pr-4">
          <button onClick={onCancel} disabled={busy} className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"><X className="size-4" /> Cancel</button>
          <div className="ml-auto">
            {order.status === 'pending' && <Button loading={busy} icon={<Check className="size-4" />} onClick={onConfirm}>Confirm order</Button>}
            {order.status === 'confirmed' && <Button loading={busy} icon={<PackageCheck className="size-4" />} onClick={onReady}>{delivery ? 'Packed, ready to send' : 'Ready for pickup'}</Button>}
            {order.status === 'ready' && delivery && <Button loading={busy} icon={<Bike className="size-4" />} onClick={onDispatch}>Send out for delivery</Button>}
            {order.status === 'ready' && !delivery && <Button icon={<Wallet className="size-4" />} onClick={onRingUp}>Customer is here · ring up</Button>}
            {order.status === 'out_for_delivery' && <Button icon={<Wallet className="size-4" />} onClick={onRingUp}>Delivered · record payment</Button>}
          </div>
        </div>
      )}
    </article>
  );
}

function EmptyOrders({ view, filtered, shopUrl }: { view: View; filtered: boolean; shopUrl: string }) {
  return (
    <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-brand-50 text-brand-600">{filtered ? <Search className="size-7" /> : view === 'active' ? <CheckCircle2 className="size-7" /> : <ReceiptText className="size-7" />}</span>
      <h2 className="mt-4 font-display text-lg font-bold text-slate-900">
        {filtered ? 'No orders match these filters' : view === 'active' ? 'All caught up' : `No ${view} orders yet`}
      </h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
        {filtered ? 'Try another stage, type or search.' : view === 'active' ? 'New pickup and delivery orders from the online shop appear here automatically.' : 'Orders show here once they are finished.'}
      </p>
      {!filtered && view === 'active' && <a href={shopUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-semibold text-white transition hover:bg-brand-800"><ExternalLink className="size-4" /> Open the online shop</a>}
    </div>
  );
}

function DispatchModal({ order, busy, onClose, onSubmit }: { order: OnlineOrder | null; busy: boolean; onClose: () => void; onSubmit: (name: string, phone: string) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  useEffect(() => { if (order) { setName(''); setPhone(''); } }, [order]);
  return (
    <Modal
      open={order !== null}
      onClose={onClose}
      title="Send out for delivery"
      description={order ? `${order.order_number} · ${order.contact_name}` : undefined}
      icon={Bike}
      footer={<><Button variant="secondary" onClick={onClose}>Back</Button><Button loading={busy} disabled={!name.trim()} icon={<Bike className="size-4" />} onClick={() => onSubmit(name.trim(), phone.trim())}>Send out</Button></>}
    >
      {order && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Order total</p><p className="mt-0.5 font-display font-bold">{money(order.estimated_total)}</p></div>
            <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Customer pays</p><p className="mt-0.5 font-display font-bold">{money(order.cash_amount ?? order.estimated_total)}</p></div>
            <div className="rounded-xl bg-amber-100 p-3 ring-1 ring-amber-300"><p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Bring change</p><p className="mt-0.5 font-display font-bold text-amber-900">{money(order.change_due ?? 0)}</p></div>
          </div>
          <p className="flex gap-2 rounded-xl bg-orange-50 px-3 py-2.5 text-sm text-slate-800 ring-1 ring-orange-200"><MapPin className="mt-0.5 size-4 shrink-0 text-orange-600" /> {order.delivery_address}</p>
          <Field label="Rider name">{(id) => <Input id={id} value={name} autoFocus placeholder="Who is delivering?" onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Rider phone" hint="Optional. Shown to the customer so they can reach the rider.">{(id) => <Input id={id} value={phone} inputMode="tel" placeholder="09XX XXX XXXX" onChange={(e) => setPhone(e.target.value)} />}</Field>
        </div>
      )}
    </Modal>
  );
}

function CancelModal({ order, busy, onClose, onSubmit }: { order: OnlineOrder | null; busy: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (order) setReason(''); }, [order]);
  return (
    <Modal
      open={order !== null}
      onClose={onClose}
      title="Cancel this order?"
      description={order ? `${order.order_number} · ${order.contact_name}. The customer will see the reason.` : undefined}
      icon={XCircle}
      size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Keep order</Button><Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => onSubmit(reason.trim())}>Cancel order</Button></>}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {CANCEL_REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} className={cx('rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition', reason === r ? 'bg-red-50 text-red-700 ring-red-300' : 'text-slate-600 ring-slate-200 hover:bg-slate-50')}>{r}</button>)}
        </div>
        <Field label="Reason">{(id) => <Input id={id} value={reason} maxLength={255} placeholder="Why is it cancelled?" onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
