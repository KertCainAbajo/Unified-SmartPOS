import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bike, CheckCircle2, ChefHat, Clock3, History, House, MapPin, PackageCheck, Phone, Receipt, RotateCcw, ShoppingBag, Store, Wallet, X, XCircle, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { DeliveryMap, distanceKm, etaMinutes, formatKm, toLatLng } from '../../components/maps';
import { Awning } from './ShopVisuals';
import { api } from '../../lib/api';

export interface ShopOrder {
  id: number;
  order_number: string;
  status: string;
  fulfilment?: 'pickup' | 'delivery';
  delivery_address?: string | null;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  cash_amount?: string | null;
  change_due?: string | null;
  rider_name?: string | null;
  rider_phone?: string | null;
  rider_lat?: number | null;
  rider_lng?: number | null;
  rider_location_at?: string | null;
  estimated_total: string;
  placed_at: string;
  confirmed_at?: string | null;
  ready_at?: string | null;
  dispatched_at?: string | null;
  delivered_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  branch: { name: string; address?: string | null; latitude?: number | null; longitude?: number | null };
  items: { id: number; name: string; sku?: string; quantity: string; unit: string; line_total: string }[];
}

interface Purchase {
  id: number;
  receipt_number: string;
  total: string;
  created_at: string;
  branch: { name: string | null };
  online_order_number: string | null;
  items: { id: number; name: string; unit: string; quantity: string; line_total: string }[];
}

const peso = (value: string | number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value));
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const OPEN = ['pending', 'confirmed', 'ready', 'out_for_delivery'];

/** Customer-facing words for where an order is. */
export function orderHeadline(order: ShopOrder): { title: string; detail: string; tone: 'green' | 'amber' | 'red' | 'slate'; icon: LucideIcon } {
  const delivery = order.fulfilment === 'delivery';
  if (order.status === 'cancelled') return { title: 'Order cancelled', detail: order.cancel_reason ?? 'This order will not be prepared.', tone: 'red', icon: XCircle };
  if (order.status === 'completed') return { title: delivery ? 'Delivered' : 'Picked up', detail: 'Thank you for shopping with us!', tone: 'slate', icon: CheckCircle2 };
  if (order.delivered_at) return { title: 'Delivered', detail: 'The rider handed over your order.', tone: 'green', icon: CheckCircle2 };
  if (order.status === 'out_for_delivery') return { title: 'Your rider is on the way', detail: order.rider_name ? `${order.rider_name} is bringing your order.` : 'Your order left the store.', tone: 'amber', icon: Bike };
  if (order.status === 'ready') return { title: delivery ? 'Packed and waiting for a rider' : 'Ready for pickup', detail: delivery ? 'A rider will pick it up shortly.' : `Collect it at ${order.branch.name} and pay at the counter.`, tone: 'amber', icon: PackageCheck };
  if (order.status === 'confirmed') return { title: 'Preparing your order', detail: 'The store is getting your items ready.', tone: 'green', icon: ChefHat };
  return { title: 'Waiting for the store', detail: 'The store will confirm your order soon.', tone: 'green', icon: Clock3 };
}

function Modal({ onClose, label, children, wide }: { onClose: () => void; label: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-[#062a1d]/55 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative flex min-h-full items-end justify-center sm:items-center sm:p-6">
        <div role="dialog" aria-modal="true" aria-label={label} className={`auth-fade relative w-full overflow-hidden bg-white shadow-2xl sm:rounded-2xl ${wide ? 'max-w-4xl' : 'max-w-2xl'} rounded-t-2xl`}>
          <Awning />
          <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-6 z-[600] grid size-10 place-items-center rounded-full bg-white/90 text-slate-500 shadow ring-1 ring-slate-200 transition hover:text-slate-800"><X className="size-5" /></button>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Foodpanda-style tracking: a full-screen live map for deliveries, with the arrival estimate, rider, timeline and order. */
export function TrackOrderDialog({ order, onClose }: { order: ShopOrder; onClose: () => void }) {
  const head = orderHeadline(order);
  const delivery = order.fulfilment === 'delivery';
  const cancelled = order.status === 'cancelled';
  const store = toLatLng(order.branch.latitude, order.branch.longitude);
  const home = toLatLng(order.delivery_lat, order.delivery_lng);
  const rider = toLatLng(order.rider_lat, order.rider_lng);
  const onTheWay = order.status === 'out_for_delivery' && !order.delivered_at;
  const km = onTheWay && rider && home ? distanceKm(rider, home) : null;
  const toneBg = { green: 'from-emerald-700 to-emerald-900', amber: 'from-amber-500 to-orange-600', red: 'from-red-600 to-red-800', slate: 'from-slate-600 to-slate-800' }[head.tone];
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(t); }, []);
  const seenAgo = order.rider_location_at ? Math.max(0, Math.round((now - new Date(order.rider_location_at).getTime()) / 1000)) : null;
  const showMap = delivery && !cancelled && !!(store || home || rider);

  const steps: [string, string | null | undefined, LucideIcon][] = [
    ['Order placed', order.placed_at, Receipt],
    ['Confirmed by store', order.confirmed_at, CheckCircle2],
    [delivery ? 'Packed' : 'Ready for pickup', order.ready_at, PackageCheck],
    ...(delivery ? [['Rider on the way', order.dispatched_at, Bike] as [string, string | null | undefined, LucideIcon], ['Delivered', order.delivered_at, House] as [string, string | null | undefined, LucideIcon]] : []),
    [delivery ? 'Paid and completed' : 'Picked up and paid', order.completed_at, Wallet],
  ];

  const riderCard = delivery && order.rider_name && !cancelled && (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-slate-200">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-rose-100 font-display text-lg font-bold text-rose-700">{order.rider_name.charAt(0)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Your rider</p>
        <p className="truncate font-semibold text-slate-900">{order.rider_name}</p>
        {onTheWay && seenAgo != null && <p className="text-xs text-slate-500">Location updated {seenAgo < 60 ? `${seenAgo}s` : `${Math.round(seenAgo / 60)} min`} ago</p>}
      </div>
      {order.rider_phone && onTheWay && <a href={`tel:${order.rider_phone}`} className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white transition hover:bg-emerald-800"><Phone className="size-4" /> Call</a>}
    </div>
  );

  const details = (
    <>
      <ol className="relative ml-2 space-y-4 border-l-2 border-slate-200 pl-6">
        {steps.map(([label, at, Icon], i) => {
          const done = !!at;
          const current = !cancelled && done && !steps[i + 1]?.[1];
          return (
            <li key={label} className="relative">
              <span className={`absolute -left-[35px] top-0 grid size-7 place-items-center rounded-full ring-4 ring-white ${done ? (current ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-700') : 'bg-slate-100 text-slate-300'}`}><Icon className="size-3.5" /></span>
              <p className={`text-sm font-semibold ${done ? 'text-slate-900' : 'text-slate-400'}`}>{label}</p>
              {at && <p className="text-xs text-slate-500">{when(at)}</p>}
            </li>
          );
        })}
        {cancelled && order.cancelled_at && (
          <li className="relative">
            <span className="absolute -left-[35px] top-0 grid size-7 place-items-center rounded-full bg-red-600 text-white ring-4 ring-white"><XCircle className="size-3.5" /></span>
            <p className="text-sm font-semibold text-red-700">Cancelled</p>
            <p className="text-xs text-slate-500">{when(order.cancelled_at)}</p>
          </li>
        )}
      </ol>
      <div className="space-y-3">
        {delivery ? (
          <div className="rounded-2xl bg-orange-50/70 p-4 ring-1 ring-orange-200">
            <p className="flex gap-2 text-sm text-slate-800"><MapPin className="mt-0.5 size-4 shrink-0 text-orange-600" /> {order.delivery_address}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-white px-2 py-2 ring-1 ring-orange-100"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">You pay with</p><p className="font-display font-bold">{peso(order.cash_amount ?? order.estimated_total)}</p></div>
              <div className="rounded-xl bg-amber-100 px-2 py-2 ring-1 ring-amber-300"><p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Your change</p><p className="font-display font-bold text-amber-900">{peso(order.change_due ?? 0)}</p></div>
            </div>
          </div>
        ) : (
          <p className="flex gap-2 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700 ring-1 ring-slate-200"><Store className="mt-0.5 size-4 shrink-0 text-emerald-700" /> Pick up at <b className="mx-1">{order.branch.name}</b>{order.branch.address && <span className="text-slate-500">· {order.branch.address}</span>}</p>
        )}
        <ul className="divide-y divide-slate-100 rounded-2xl ring-1 ring-slate-200">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 truncate"><b className="mr-1.5">{Number(item.quantity)}×</b>{item.name}</span>
              <span className="shrink-0 tabular-nums text-slate-700">{peso(item.line_total)}</span>
            </li>
          ))}
          <li className="flex justify-between px-4 py-2.5 text-sm font-bold"><span>Estimated total</span><span>{peso(order.estimated_total)}</span></li>
        </ul>
      </div>
    </>
  );

  const headline = (
    <div className={`bg-gradient-to-br ${toneBg} px-6 py-5 text-white`}>
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-white/70">Order {order.order_number}</p>
      <div className="mt-2 flex items-center gap-3 pr-10">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/15"><head.icon className="size-6" /></span>
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold leading-tight">{head.title}</h2>
          <p className="text-sm text-white/80">{head.detail}</p>
        </div>
      </div>
    </div>
  );

  if (!showMap) {
    return (
      <Modal onClose={onClose} label={`Order ${order.order_number}`}>
        {headline}
        <div className="grid max-h-[70vh] gap-5 overflow-y-auto p-6 sm:max-h-none sm:grid-cols-2">{riderCard && <div className="sm:col-span-2">{riderCard}</div>}{details}</div>
      </Modal>
    );
  }

  return <FullScreen onClose={onClose} label={`Order ${order.order_number}`}>
    {/* Map fills the screen */}
    <div className="relative h-[55vh] shrink-0 lg:h-full lg:flex-1">
      <DeliveryMap store={store} home={home} rider={onTheWay ? rider : null} height="100%" bare interactive />
      <button type="button" onClick={onClose} aria-label="Back to shop" className="absolute left-4 top-4 z-[600] inline-flex h-11 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-slate-700 shadow-lg ring-1 ring-slate-200 hover:text-slate-900"><ArrowLeft className="size-4" /> <span className="hidden sm:inline">Back to shop</span></button>
      {km != null && (
        <div className="absolute left-[72px] right-16 top-4 z-[600] flex items-center justify-center gap-3 rounded-2xl bg-white/95 px-4 py-2.5 shadow-xl ring-1 ring-slate-200 backdrop-blur sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:gap-4 sm:px-5 sm:py-3">
          <Clock3 className="size-6 text-rose-600" />
          <span><span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Arriving in about</span><span className="whitespace-nowrap font-display text-xl font-bold text-slate-900 sm:text-2xl">{etaMinutes(km)} min</span></span>
          <span className="h-10 w-px bg-slate-200" />
          <span><span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Distance</span><span className="whitespace-nowrap font-display text-xl font-bold text-slate-900 sm:text-2xl">{formatKm(km)}</span></span>
        </div>
      )}
      <div className="absolute bottom-4 left-4 z-[600] flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-white/95 px-3.5 py-2 text-xs text-slate-600 shadow ring-1 ring-slate-200">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-emerald-800" /> Store</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-orange-600" /> {home ? 'Your location' : 'No pin (rider uses your address)'}</span>
        {onTheWay && <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-rose-600" /> {rider ? 'Rider' : 'Waiting for the rider’s location…'}</span>}
      </div>
      {riderCard && <div className="absolute bottom-4 right-4 z-[600] hidden w-[360px] lg:block">{riderCard}</div>}
    </div>

    {/* Order details */}
    <aside className="flex min-h-0 flex-1 flex-col lg:w-[440px] lg:flex-none lg:border-l lg:border-slate-200">
      {headline}
      <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
        {riderCard && <div className="lg:hidden">{riderCard}</div>}
        {details}
      </div>
    </aside>
  </FullScreen>;
}

function FullScreen({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return <div role="dialog" aria-modal="true" aria-label={label} className="auth-fade fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-white lg:flex-row lg:overflow-hidden"><Awning className="absolute inset-x-0 top-0 z-[700]" />{children}</div>;
}

/** Every order and in-store purchase the customer has made, with "Buy again". */
export function OrderHistoryDialog({ base, orders, onClose, onTrack, onReorder }: {
  base: string;
  orders: ShopOrder[];
  onClose: () => void;
  onTrack: (order: ShopOrder) => void;
  onReorder: (order: ShopOrder) => number;
}) {
  const [tab, setTab] = useState<'active' | 'past' | 'store'>(() => (orders.some((o) => OPEN.includes(o.status)) ? 'active' : 'past'));
  const [reordered, setReordered] = useState<{ id: number; added: number } | null>(null);
  const purchases = useQuery({ queryKey: ['shop-purchases', base], queryFn: () => api<{ data: Purchase[]; total?: number }>(`${base}/purchases`), enabled: tab === 'store' });
  const active = orders.filter((o) => OPEN.includes(o.status));
  const past = orders.filter((o) => !OPEN.includes(o.status));
  const completed = orders.filter((o) => o.status === 'completed');
  const spent = completed.reduce((sum, o) => sum + Number(o.estimated_total), 0);
  const shown = tab === 'active' ? active : past;

  return (
    <Modal onClose={onClose} label="My orders" wide>
      <div className="border-b border-emerald-900/10 bg-gradient-to-br from-[#eef7ea] via-white to-[#fff5dc] px-6 pb-4 pt-5">
        <p className="text-[11px] font-bold uppercase tracking-[.18em] text-amber-700">Purchase history</p>
        <h2 className="mt-1 font-display text-2xl font-bold text-slate-900">My orders</h2>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:max-w-md">
          <Stat label="Orders" value={String(orders.length)} />
          <Stat label="Completed" value={String(completed.length)} />
          <Stat label="Spent online" value={peso(spent)} />
        </div>
        <div className="mt-5 flex gap-1 rounded-xl bg-slate-100 p-1 sm:inline-flex" role="tablist">
          {([['active', `Active (${active.length})`, Clock3], ['past', `Past orders (${past.length})`, History], ['store', 'In-store purchases', Store]] as const).map(([value, label, Icon]) => (
            <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition sm:flex-none sm:text-sm ${tab === value ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[62vh] overflow-y-auto p-6">
        {tab !== 'store' ? (
          shown.length ? (
            <ul className="space-y-3">
              {shown.map((order) => {
                const head = orderHeadline(order);
                const names = order.items.map((i) => i.name);
                const finished = !OPEN.includes(order.status);
                return (
                  <li key={order.id} className="rounded-2xl p-4 ring-1 ring-slate-200 transition hover:ring-emerald-300">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-display text-sm font-bold text-slate-900">
                          {order.order_number}
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{order.fulfilment === 'delivery' ? <Bike className="size-3" /> : <Store className="size-3" />}{order.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">{when(order.placed_at)} · {order.branch.name}</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-display text-lg font-bold ${order.status === 'cancelled' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{peso(order.estimated_total)}</p>
                        <p className={`text-xs font-semibold ${order.status === 'cancelled' ? 'text-red-600' : head.tone === 'amber' ? 'text-amber-700' : 'text-emerald-700'}`}>{head.title}</p>
                      </div>
                    </div>
                    <p className="mt-2 truncate text-sm text-slate-600" title={names.join(', ')}>{order.items.length} {order.items.length === 1 ? 'item' : 'items'} · {names.slice(0, 3).join(', ')}{names.length > 3 && ` +${names.length - 3}`}</p>
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                      {reordered?.id === order.id && <span className="mr-auto text-xs font-semibold text-emerald-700">{reordered.added ? `Added ${reordered.added} ${reordered.added === 1 ? 'item' : 'items'} to your basket` : 'These items are not sold online right now'}</span>}
                      {finished && <button onClick={() => setReordered({ id: order.id, added: onReorder(order) })} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200 transition hover:bg-emerald-50"><RotateCcw className="size-4" /> Buy again</button>}
                      <button onClick={() => onTrack(order)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-800 px-3 text-sm font-semibold text-white transition hover:bg-emerald-900">
                        {order.status === 'out_for_delivery' && !order.delivered_at ? <><MapPin className="size-4" /> Track</> : <>View details</>}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <Empty icon={tab === 'active' ? ShoppingBag : History} text={tab === 'active' ? 'No orders in progress.' : 'No past orders yet.'} />
        ) : purchases.isPending ? <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}</div>
          : purchases.data?.data.length ? (
            <ul className="divide-y divide-slate-100 rounded-2xl ring-1 ring-slate-200">
              {purchases.data.data.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Receipt className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{p.receipt_number}{p.online_order_number && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Online {p.online_order_number}</span>}</p>
                    <p className="truncate text-xs text-slate-500">{when(p.created_at)} · {p.branch.name} · {p.items.map((i) => i.name).join(', ')}</p>
                  </div>
                  <span className="font-display font-bold text-slate-900">{peso(p.total)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty icon={Store} text="No in-store purchases linked to your account yet. Give the cashier your name or number at the counter to see them here." />}
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="truncate font-display text-base font-bold text-slate-900">{value}</p></div>;
}

function Empty({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return <div className="rounded-2xl bg-slate-50 px-6 py-12 text-center"><Icon className="mx-auto size-8 text-slate-300" /><p className="mx-auto mt-3 max-w-sm text-sm text-slate-500">{text}</p></div>;
}
