import { useQueryClient } from '@tanstack/react-query';
import {
  Bell, Bike, CheckCircle2, ChevronDown, CircleDollarSign, Clock3, HandCoins, History, LocateFixed, LocateOff, MapPin, Navigation, Package,
  PackageCheck, Phone, Power, RefreshCw, Route, Store, Undo2, Wallet, X, type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { DeliveryMap, directionsUrl, distanceKm, etaMinutes, formatKm, toLatLng, type LatLng } from '../../components/maps';
import { Button, ErrorBanner, Field, Input, Modal, Spinner, cx } from '../../components/ui';
import { api } from '../../lib/api';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';
import { money, qty, type OnlineOrder } from './onlineOrders';
import { RiderHistory } from './RiderHistory';

interface RiderDay {
  data: OnlineOrder[];
  available: OnlineOrder[];
  on_duty: boolean;
  summary: { on_the_way: number; delivered_today: number; delivered_value_today: string; to_hand_in: string; change_to_bring: string };
}
type Tab = 'active' | 'available' | 'today' | 'history';

const SHARE_KEY = 'smartpos.rider.sharing';
const SEND_EVERY_MS = 10000;
const RETURN_REASONS = ['Nobody home', 'Customer not answering', 'Wrong or incomplete address', 'Customer refused the order'];
const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const minutesSince = (iso: string | null | undefined, now: number) => (iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000)) : 0);

/**
 * The rider's phone screen: go on duty, take packed orders from the counter, deliver with a map and directions while
 * sharing location with the customer, and see the cash to hand in at the end.
 */
export function DeliveriesPage() {
  const { can, path, tenantId } = useTenant();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const day = useTenantQuery<RiderDay>('/deliveries', undefined, { refetchInterval: 15000, enabled: can('deliveries.ride') });
  const [tab, setTab] = useState<Tab>('active');
  const [sharing, setSharing] = useState(() => { try { return localStorage.getItem(SHARE_KEY) !== 'off'; } catch { return true; } });
  const [me, setMe] = useState<LatLng | null>(null);
  const [geoError, setGeoError] = useState('');
  const [lastSent, setLastSent] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [delivering, setDelivering] = useState<OnlineOrder | null>(null);
  const [returning, setReturning] = useState<OnlineOrder | null>(null);
  const [claiming, setClaiming] = useState<OnlineOrder | null>(null);
  const [newAlert, setNewAlert] = useState<OnlineOrder[]>([]);
  const lastSentAt = useRef(0);
  const knownActive = useRef<Set<number> | null>(null);

  const orders = day.data?.data ?? [];
  const available = day.data?.available ?? [];
  const onDuty = day.data?.on_duty ?? true;
  const summary = day.data?.summary;
  const active = orders.filter((o) => o.status === 'out_for_delivery' && !o.delivered_at);
  const toHandIn = orders.filter((o) => o.status === 'out_for_delivery' && o.delivered_at);
  const deliveredToday = orders.filter((o) => o.delivered_at);
  const activeIds = active.map((o) => o.id).join(',');

  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(t); }, []);
  useEffect(() => { try { localStorage.setItem(SHARE_KEY, sharing ? 'on' : 'off'); } catch { /* not important */ } }, [sharing]);

  // Alert when the store assigns a new delivery (not on the first load).
  useEffect(() => {
    if (!day.data) return;
    const ids = new Set(active.map((o) => o.id));
    if (knownActive.current) {
      const fresh = active.filter((o) => !knownActive.current!.has(o.id));
      if (fresh.length) {
        setNewAlert(fresh);
        setTab('active');
        try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported */ }
      }
    }
    knownActive.current = ids;
  }, [day.data]); // eslint-disable-line react-hooks/exhaustive-deps -- compare each new answer with the previous one

  // Follow the phone's position while sharing and something is on the way; send it to each active delivery.
  useEffect(() => {
    if (!sharing || !activeIds) return;
    if (!navigator.geolocation) { setGeoError('This phone cannot share its location.'); return; }
    setGeoError('');
    const ids = activeIds.split(',').map(Number);
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMe(point);
        if (Date.now() - lastSentAt.current < SEND_EVERY_MS) return;
        lastSentAt.current = Date.now();
        void Promise.all(ids.map((id) => api(path(`/deliveries/${id}/location`), { method: 'POST', body: { latitude: point.lat, longitude: point.lng } }).catch(() => undefined)))
          .then(() => setLastSent(Date.now()));
      },
      (err) => setGeoError(err.code === err.PERMISSION_DENIED
        ? 'Location is blocked. Allow location for this site in your browser settings so customers can follow you.'
        : 'Waiting for GPS… Move to an open area if this takes long.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [sharing, activeIds, path]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['t', tenantId, '/deliveries'] });
  const delivered = useTenantMutation<{ id: number }>('POST', (b) => `/deliveries/${b.id}/delivered`, { success: 'Marked as delivered. Hand in the cash at the store.', onSuccess: () => { setDelivering(null); void refresh(); } });
  const returned = useTenantMutation<{ id: number; reason: string }>('POST', (b) => `/deliveries/${b.id}/return`, { success: 'Order returned to the store.', onSuccess: () => { setReturning(null); void refresh(); } });
  const claim = useTenantMutation<{ id: number }>('POST', (b) => `/deliveries/${b.id}/claim`, {
    success: 'Delivery is yours. Drive safely!',
    onSuccess: () => { setClaiming(null); setTab('active'); void refresh(); },
  });
  const duty = useTenantMutation<{ on_duty: boolean }>('POST', '/deliveries/duty', {
    success: (r) => ((r as unknown as { on_duty: boolean }).on_duty ? 'You are on duty.' : 'You are off duty.'),
    onSuccess: () => void refresh(),
  });

  if (!can('deliveries.ride')) return <NoAccess what="deliveries" />;
  if (day.isPending) return <Spinner label="Loading your deliveries…" />;
  if (day.isError) return <ErrorBanner error={day.error} />;

  const sentAgo = lastSent ? Math.round((now - lastSent) / 1000) : null;
  const firstName = user?.name.split(' ')[0] ?? 'Rider';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      {/* ───── Duty header ───── */}
      <section className={cx('relative overflow-hidden rounded-3xl p-5 text-white shadow-lg sm:p-6', onDuty ? 'bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900' : 'bg-gradient-to-br from-slate-600 to-slate-800')}>
        <div className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/15 font-display text-xl font-bold">{firstName.charAt(0)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white/75">{greeting},</p>
            <h1 className="truncate font-display text-2xl font-bold leading-tight sm:text-[28px]">{firstName}</h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-white/80">
              <span className={cx('size-2 rounded-full', onDuty ? 'animate-pulse bg-emerald-300' : 'bg-slate-300')} />
              {onDuty ? (active.length ? `On duty · ${active.length} on the way` : 'On duty · waiting for orders') : 'Off duty · you will not be given deliveries'}
            </p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <button
              type="button"
              onClick={() => duty.mutate({ on_duty: !onDuty })}
              disabled={duty.isPending || (onDuty && active.length > 0)}
              title={onDuty && active.length > 0 ? 'Finish or return your deliveries first' : undefined}
              className={cx('inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none', onDuty ? 'bg-white/15 text-white ring-1 ring-white/25 hover:bg-white/25' : 'bg-amber-400 text-emerald-950 hover:bg-amber-300')}
            >
              <Power className="size-4" /> {onDuty ? 'Go off duty' : 'Go on duty'}
            </button>
            <button type="button" onClick={() => void refresh()} aria-label="Refresh" className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/20 transition hover:bg-white/20">
              <RefreshCw className={cx('size-5', day.isFetching && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Location sharing */}
        <button
          type="button"
          onClick={() => setSharing((v) => !v)}
          aria-pressed={sharing}
          className="relative mt-4 flex w-full items-center gap-3 rounded-2xl bg-black/15 px-4 py-3 text-left ring-1 ring-white/10 transition hover:bg-black/20"
        >
          {sharing ? <LocateFixed className="size-5 shrink-0 text-emerald-200" /> : <LocateOff className="size-5 shrink-0 text-white/60" />}
          <span className="min-w-0 flex-1 text-sm">
            <b>{sharing ? 'Location sharing on' : 'Location sharing off'}</b>
            <span className="text-white/75"> · {!sharing ? 'customers cannot follow you on the map' : !active.length ? 'starts when you have a delivery' : sentAgo != null ? `customers see you · updated ${sentAgo < 60 ? `${sentAgo}s` : `${Math.round(sentAgo / 60)} min`} ago` : 'getting your position…'}</span>
          </span>
          <span className={cx('relative h-6 w-11 shrink-0 rounded-full transition', sharing ? 'bg-emerald-400' : 'bg-white/25')}>
            <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', sharing ? 'left-[22px]' : 'left-0.5')} />
          </span>
        </button>
        {geoError && sharing && active.length > 0 && <p className="relative mt-2 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-900">{geoError}</p>}
      </section>

      {/* ───── Today's numbers ───── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Bike} tone="bg-rose-50 text-rose-600" label="On the way" value={String(summary?.on_the_way ?? 0)} />
        <Stat icon={CheckCircle2} tone="bg-brand-50 text-brand-700" label="Delivered today" value={String(summary?.delivered_today ?? 0)} hint={summary ? money(summary.delivered_value_today) : undefined} />
        <Stat icon={Wallet} tone="bg-amber-50 text-amber-700" label="Cash to hand in" value={money(summary?.to_hand_in ?? 0)} highlight={Number(summary?.to_hand_in ?? 0) > 0} />
        <Stat icon={HandCoins} tone="bg-sky-50 text-sky-700" label="Change to bring" value={money(summary?.change_to_bring ?? 0)} hint="For deliveries on the way" />
      </div>

      {/* New assignment alert */}
      {newAlert.length > 0 && (
        <div role="alert" className="auth-fade flex items-center gap-3 rounded-2xl bg-rose-600 p-4 text-white shadow-lg">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/20"><Bell className="size-5 animate-bounce" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">New delivery assigned to you</p>
            <p className="truncate text-sm text-white/85">{newAlert.map((o) => `${o.order_number} · ${o.contact_name}`).join(', ')}</p>
          </div>
          <button type="button" onClick={() => setNewAlert([])} aria-label="Dismiss" className="grid size-9 place-items-center rounded-full hover:bg-white/15"><X className="size-5" /></button>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {/* Tabs */}
          <div className="flex gap-1 rounded-2xl bg-white p-1.5 ring-1 ring-slate-200" role="tablist">
            <TabButton active={tab === 'active'} onClick={() => setTab('active')} icon={Route} label="On the way" count={active.length} tone="rose" />
            <TabButton active={tab === 'available'} onClick={() => setTab('available')} icon={PackageCheck} label="Ready to pick up" count={available.length} tone="amber" />
            <TabButton active={tab === 'today'} onClick={() => setTab('today')} icon={Clock3} label="Today" count={deliveredToday.length} tone="slate" />
            <TabButton active={tab === 'history'} onClick={() => setTab('history')} icon={History} label="History" count={0} tone="slate" />
          </div>

          {tab === 'active' && (active.length ? active.map((order) => (
            <ActiveDelivery key={order.id} order={order} me={me} onDelivered={() => setDelivering(order)} onReturn={() => setReturning(order)} />
          )) : (
            <Empty
              icon={Bike}
              title="Nothing on the way"
              text={available.length ? `${available.length} packed ${available.length === 1 ? 'order is' : 'orders are'} waiting for a rider.` : 'When the store sends an order out with you, it appears here with the map and the cash to collect.'}
              action={available.length > 0 && onDuty ? <Button icon={<PackageCheck className="size-4" />} onClick={() => setTab('available')}>See orders to pick up</Button> : undefined}
            />
          ))}

          {tab === 'available' && (available.length ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {!onDuty && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200 xl:col-span-2">Go on duty to take these orders.</p>}
              {available.map((order) => <AvailableCard key={order.id} order={order} now={now} disabled={!onDuty} onTake={() => setClaiming(order)} />)}
            </div>
          ) : <Empty icon={PackageCheck} title="No orders waiting" text="Packed delivery orders at your branch show here. Take one when you pick it up from the counter." />)}

          {tab === 'history' && <RiderHistory />}

          {tab === 'today' && (deliveredToday.length ? (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200">
              {deliveredToday.map((o) => {
                const handedIn = o.status === 'completed';
                return (
                  <li key={o.id} className="flex items-center gap-3 px-5 py-4">
                    <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', handedIn ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700')}>{handedIn ? <CheckCircle2 className="size-5" /> : <Wallet className="size-5" />}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{o.order_number} · {o.contact_name}</p>
                      <p className="truncate text-xs text-slate-500">Delivered {clock(o.delivered_at)} · {o.delivery_address}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-display font-bold text-slate-900">{money(o.estimated_total)}</p>
                      <p className={cx('text-[11px] font-semibold', handedIn ? 'text-brand-700' : 'text-amber-700')}>{handedIn ? 'Handed in' : 'To hand in'}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <Empty icon={Clock3} title="No deliveries yet today" text="Orders you deliver today are listed here." action={<Button variant="secondary" icon={<History className="size-4" />} onClick={() => setTab('history')}>See past deliveries</Button>} />)}
        </div>

        {/* ───── Side panel ───── */}
        <aside className="space-y-4 lg:sticky lg:top-24">
          <section className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200">
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
              <span className="grid size-10 place-items-center rounded-xl bg-amber-100 text-amber-700"><Wallet className="size-5" /></span>
              <div><h2 className="font-display text-lg font-bold leading-tight">Hand in at the store</h2><p className="text-xs text-slate-500">Give this cash to the cashier</p></div>
            </div>
            {toHandIn.length ? (
              <>
                <ul className="divide-y divide-slate-100 px-5">
                  {toHandIn.map((o) => <li key={o.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span className="min-w-0"><b className="block">{o.order_number}</b><span className="block truncate text-xs text-slate-500">{o.contact_name} · delivered {clock(o.delivered_at)}</span></span><span className="shrink-0 font-display font-bold">{money(o.estimated_total)}</span></li>)}
                </ul>
                <div className="flex items-center justify-between bg-amber-50 px-5 py-4"><span className="text-sm font-semibold text-amber-900">Total to hand in</span><span className="font-display text-xl font-bold text-amber-900">{money(summary?.to_hand_in ?? 0)}</span></div>
              </>
            ) : <p className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500"><CheckCircle2 className="size-4 text-brand-600" /> All cash handed in.</p>}
          </section>

          <section className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
            <h2 className="font-display text-base font-bold">How it works</h2>
            <ol className="mt-3 space-y-3 text-sm text-slate-600">
              <Step n={1} icon={Store}>Pick up the bag and the <b>change</b> at the counter. Take the order here, or the store assigns it to you.</Step>
              <Step n={2} icon={Navigation}>Tap <b>Navigate</b>. Keep location sharing on so the customer can follow you.</Step>
              <Step n={3} icon={CircleDollarSign}>Collect the cash, give the change, then tap <b>Delivered</b>.</Step>
              <Step n={4} icon={Wallet}>Hand the cash to the cashier so they record the payment.</Step>
            </ol>
          </section>
        </aside>
      </div>

      <Modal
        open={delivering !== null}
        onClose={() => setDelivering(null)}
        title="Delivered and paid?"
        description={delivering ? `${delivering.order_number} · ${delivering.contact_name}` : undefined}
        icon={CheckCircle2}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setDelivering(null)}>Not yet</Button><Button loading={delivered.isPending} onClick={() => delivering && delivered.mutate({ id: delivering.id })}>Yes, delivered</Button></>}
      >
        {delivering && <p className="text-sm text-slate-600">You received <b>{money(delivering.cash_amount ?? delivering.estimated_total)}</b> and gave <b>{money(delivering.change_due ?? 0)}</b> change. Location sharing stops for this order.</p>}
      </Modal>
      <Modal
        open={claiming !== null}
        onClose={() => setClaiming(null)}
        title="Take this delivery?"
        description={claiming ? `${claiming.order_number} · ${claiming.contact_name}` : undefined}
        icon={PackageCheck}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setClaiming(null)}>Back</Button><Button loading={claim.isPending} icon={<Bike className="size-4" />} onClick={() => claiming && claim.mutate({ id: claiming.id })}>Take delivery</Button></>}
      >
        {claiming && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>Get the bag ({claiming.items.length} {claiming.items.length === 1 ? 'item' : 'items'}) from the counter at <b>{claiming.branch.name}</b>, and bring:</p>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Collect</p><p className="font-display text-lg font-bold text-slate-900">{money(claiming.cash_amount ?? claiming.estimated_total)}</p></div>
              <div className="rounded-xl bg-amber-100 p-3 ring-1 ring-amber-300"><p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Change</p><p className="font-display text-lg font-bold text-amber-900">{money(claiming.change_due ?? 0)}</p></div>
            </div>
          </div>
        )}
      </Modal>
      <ReturnModal order={returning} busy={returned.isPending} onClose={() => setReturning(null)} onSubmit={(reason) => returning && returned.mutate({ id: returning.id, reason })} />
    </div>
  );
}

function Stat({ icon: Icon, tone, label, value, hint, highlight }: { icon: LucideIcon; tone: string; label: string; value: string; hint?: string; highlight?: boolean }) {
  return (
    <div className={cx('flex items-center gap-2.5 rounded-2xl bg-white p-3 ring-1 sm:gap-3 sm:p-4', highlight ? 'ring-2 ring-amber-400' : 'ring-slate-200')}>
      <span className={cx('grid size-9 shrink-0 place-items-center rounded-xl sm:size-11', tone)}><Icon className="size-4 sm:size-5" /></span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold leading-tight text-slate-500 sm:text-xs">{label}</p>
        <p className="truncate font-display text-lg font-bold text-slate-900 sm:text-xl">{value}</p>
        {hint && <p className="hidden truncate text-[11px] text-slate-400 sm:block">{hint}</p>}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, count, tone }: { active: boolean; onClick: () => void; icon: LucideIcon; label: string; count: number; tone: 'rose' | 'amber' | 'slate' }) {
  const badge = { rose: 'bg-rose-600 text-white', amber: 'bg-amber-400 text-amber-950', slate: 'bg-slate-200 text-slate-700' }[tone];
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} className={cx('inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-2 py-2.5 text-sm font-semibold transition', active ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50')}>
      <Icon className="hidden size-4 sm:block" /> <span className="truncate">{label}</span>
      {count > 0 && <span className={cx('grid min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold', active ? 'bg-white/20 text-white' : badge)}>{count}</span>}
    </button>
  );
}

function ActiveDelivery({ order, me, onDelivered, onReturn }: { order: OnlineOrder; me: LatLng | null; onDelivered: () => void; onReturn: () => void }) {
  const store = toLatLng(order.branch.latitude, order.branch.longitude);
  const home = toLatLng(order.delivery_lat, order.delivery_lng);
  const km = me && home ? distanceKm(me, home) : store && home ? distanceKm(store, home) : null;
  return (
    <article className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold text-rose-600"><span className="size-2 animate-pulse rounded-full bg-rose-500" /> On the way · since {clock(order.dispatched_at)}</p>
          <p className="mt-1 truncate font-display text-xl font-bold text-slate-900">{order.contact_name}</p>
          <p className="text-xs text-slate-500">{order.order_number} · from {order.branch.name}</p>
        </div>
        <a href={`tel:${order.contact_phone}`} className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-bold text-white transition hover:bg-brand-800"><Phone className="size-4" /> Call</a>
      </div>

      <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          {(store || home || me) ? <DeliveryMap store={store} home={home} rider={me} height="min(46vh, 360px)" /> : <p className="rounded-2xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">No map locations for this order.</p>}
          <div className="flex items-start gap-3 rounded-2xl bg-orange-50 p-4 ring-1 ring-orange-200">
            <MapPin className="mt-0.5 size-5 shrink-0 text-orange-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{order.delivery_address}</p>
              <p className="mt-0.5 text-xs text-slate-500">{home ? (km != null ? `${formatKm(km)} ${me ? 'from you' : 'from the store'} · about ${etaMinutes(km)} min` : 'Pinned on the map') : 'No map pin. Use the address and call the customer.'}</p>
            </div>
            {home && <a href={directionsUrl(home)} target="_blank" rel="noreferrer" className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-orange-600 px-3 text-sm font-bold text-white hover:bg-orange-700"><Navigation className="size-4" /> Navigate</a>}
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200"><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Collect</p><p className="font-display text-2xl font-bold text-slate-900">{money(order.cash_amount ?? order.estimated_total)}</p><p className="text-xs text-slate-500">Total {money(order.estimated_total)}</p></div>
            <div className="rounded-2xl bg-amber-100 p-4 ring-1 ring-amber-300"><p className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Give change</p><p className="font-display text-2xl font-bold text-amber-900">{money(order.change_due ?? 0)}</p><p className="text-xs text-amber-800/80">From the store</p></div>
          </div>
          {order.note && <p className="rounded-2xl bg-yellow-50 px-4 py-3 text-sm text-yellow-900 ring-1 ring-yellow-200"><b>Note:</b> {order.note}</p>}
          <details className="group rounded-2xl ring-1 ring-slate-200" open>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-700"><Package className="size-4 text-slate-400" /> {order.items.length} {order.items.length === 1 ? 'item' : 'items'} in the bag <ChevronDown className="ml-auto size-4 text-slate-400 transition group-open:rotate-180" /></summary>
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {order.items.map((item) => <li key={item.id} className="flex justify-between px-4 py-2 text-sm"><span><b className="mr-1.5">{qty(item.quantity)}×</b>{item.name}</span><span className="text-slate-500">{item.unit}</span></li>)}
            </ul>
          </details>
          <Button size="lg" className="w-full" icon={<CheckCircle2 className="size-5" />} onClick={onDelivered}>Delivered &amp; cash collected</Button>
          <Button size="lg" variant="secondary" className="w-full" icon={<Undo2 className="size-5" />} onClick={onReturn}>Couldn’t deliver</Button>
        </div>
      </div>
    </article>
  );
}

function AvailableCard({ order, now, disabled, onTake }: { order: OnlineOrder; now: number; disabled: boolean; onTake: () => void }) {
  const store = toLatLng(order.branch.latitude, order.branch.longitude);
  const home = toLatLng(order.delivery_lat, order.delivery_lng);
  const km = store && home ? distanceKm(store, home) : null;
  const waiting = minutesSince(order.ready_at ?? order.placed_at, now);
  return (
    <article className="flex flex-col rounded-3xl bg-white p-5 ring-1 ring-slate-200 transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-bold text-slate-900">{order.order_number}</p>
          <p className={cx('mt-0.5 flex items-center gap-1 text-xs', waiting >= 15 ? 'font-semibold text-red-600' : 'text-slate-500')}><Clock3 className="size-3.5" /> Packed {waiting < 1 ? 'just now' : `${waiting} min ago`} · {order.branch.name}</p>
        </div>
        {km != null && <span className="shrink-0 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700">{formatKm(km)}</span>}
      </div>
      <p className="mt-3 flex gap-2 text-sm text-slate-700"><MapPin className="mt-0.5 size-4 shrink-0 text-orange-600" /> <span className="line-clamp-2">{order.delivery_address}</span></p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Mini label="Items" value={String(order.items.length)} />
        <Mini label="Collect" value={money(order.cash_amount ?? order.estimated_total)} />
        <Mini label="Change" value={money(order.change_due ?? 0)} tone="amber" />
      </div>
      <Button className="mt-4 w-full" icon={<Bike className="size-4" />} disabled={disabled} onClick={onTake}>Take this delivery</Button>
    </article>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: 'amber' }) {
  return <div className={cx('rounded-xl px-2 py-2 ring-1', tone === 'amber' ? 'bg-amber-50 ring-amber-200' : 'bg-slate-50 ring-slate-200')}><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="truncate text-sm font-bold text-slate-900">{value}</p></div>;
}

function Step({ n, icon: Icon, children }: { n: number; icon: LucideIcon; children: ReactNode }) {
  return <li className="flex gap-3"><span className="relative grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon className="size-4" /><span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-brand-700 text-[9px] font-bold text-white">{n}</span></span><span>{children}</span></li>;
}

function Empty({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="rounded-3xl bg-white px-6 py-14 text-center ring-1 ring-slate-200">
      <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-brand-50 text-brand-600"><Icon className="size-8" /></span>
      <h2 className="mt-4 font-display text-lg font-bold">{title}</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function ReturnModal({ order, busy, onClose, onSubmit }: { order: OnlineOrder | null; busy: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (order) setReason(''); }, [order]);
  return (
    <Modal
      open={order !== null}
      onClose={onClose}
      title="Bring the order back?"
      description="The store sees your reason and can send it again or cancel it."
      icon={Undo2}
      size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Keep delivering</Button><Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => onSubmit(reason.trim())}>Return to store</Button></>}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {RETURN_REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} className={cx('rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition', reason === r ? 'bg-red-50 text-red-700 ring-red-300' : 'text-slate-600 ring-slate-200 hover:bg-slate-50')}>{r}</button>)}
        </div>
        <Field label="Reason">{(id) => <Input id={id} value={reason} maxLength={255} placeholder="What happened?" onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
