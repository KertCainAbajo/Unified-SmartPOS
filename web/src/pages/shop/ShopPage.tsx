import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Apple, ArrowRight, ArrowUpDown, Beef, Check, CheckCircle2, Cookie, CupSoda, Droplets, Heart, LayoutGrid, Lock, LogOut,
  MapPin, Milk, Minus, PackageCheck, Plus, Receipt, Search, ShoppingBasket, Soup, SprayCan, Trash2, Wheat, X,
  type LucideIcon,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router';
import { ApiError, api, errorMessage } from '../../lib/api';
import { DeliveryMap, toLatLng } from '../../components/maps';
import { CustomerAccountDialog } from './CustomerAccountDialog';
import { CustomerAuthDialog } from './CustomerAuthDialog';
import { OrderHistoryDialog, TrackOrderDialog, type ShopOrder } from './CustomerOrders';
import { DeliveryLocationDialog, composeAddress, emptyLocation, loadLocation, type DeliveryLocation } from './DeliveryLocationDialog';
import { ShopDirectory } from './ShopDirectory';
import { ShopHero } from './ShopVisuals';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';

interface Branch { id: number; code: string; name: string; address: string | null; latitude?: number | null; longitude?: number | null }
interface ShopProduct { id: number; sku: string; name: string; description: string | null; unit: string; price: string; category: string | null; image_url: string | null; track_inventory: boolean; reorder_level: string; stock_by_branch: Record<number, { quantity: string; reorder_level: string | null }> }
interface Catalog { business: { name: string; code: string }; branches: Branch[]; data: ShopProduct[] }
interface Account { id: number; name: string; email: string; phone: string }
type Order = ShopOrder;
interface CartLine { product: ShopProduct; quantity: number }
type Sort = 'featured' | 'price-asc' | 'price-desc' | 'name';

const peso = (value: string | number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value));
const statusNames: Record<string, string> = { pending: 'Waiting for store confirmation', confirmed: 'Being prepared', ready: 'Ready', out_for_delivery: 'On the way', completed: 'Completed', cancelled: 'Cancelled' };
const statusFlow = ['pending', 'confirmed', 'ready', 'completed'];
const ALL = 'All products';
const SAVED = 'Saved';

/** Category look: an icon picked from the category name, and a colour that stays the same for that category. */
const tones = [
  { bg: 'bg-gradient-to-br from-emerald-100 via-emerald-50 to-white', fg: 'text-emerald-700', label: 'text-emerald-700' },
  { bg: 'bg-gradient-to-br from-amber-100 via-amber-50 to-white', fg: 'text-amber-700', label: 'text-amber-700' },
  { bg: 'bg-gradient-to-br from-sky-100 via-sky-50 to-white', fg: 'text-sky-700', label: 'text-sky-700' },
  { bg: 'bg-gradient-to-br from-rose-100 via-rose-50 to-white', fg: 'text-rose-700', label: 'text-rose-700' },
  { bg: 'bg-gradient-to-br from-violet-100 via-violet-50 to-white', fg: 'text-violet-700', label: 'text-violet-700' },
  { bg: 'bg-gradient-to-br from-orange-100 via-orange-50 to-white', fg: 'text-orange-700', label: 'text-orange-700' },
  { bg: 'bg-gradient-to-br from-lime-100 via-lime-50 to-white', fg: 'text-lime-700', label: 'text-lime-700' },
];
/** Category colours (soft tile + strong icon), assigned in catalogue order. */
const CAT_COLORS = [
  { bg: 'bg-sky-100', fg: 'text-sky-700' }, { bg: 'bg-amber-100', fg: 'text-amber-700' }, { bg: 'bg-orange-100', fg: 'text-orange-700' },
  { bg: 'bg-rose-100', fg: 'text-rose-600' }, { bg: 'bg-lime-100', fg: 'text-lime-700' }, { bg: 'bg-violet-100', fg: 'text-violet-700' },
  { bg: 'bg-teal-100', fg: 'text-teal-700' }, { bg: 'bg-fuchsia-100', fg: 'text-fuchsia-700' },
];
const iconRules: [RegExp, LucideIcon][] = [
  [/bever|drink|juice|soda|water|coffee/i, CupSoda], [/snack|chip|biscuit|candy|sweet/i, Cookie], [/rice|grain|flour|bread/i, Wheat],
  [/can|soup|noodle/i, Soup], [/house|clean|laundry|detergent/i, SprayCan], [/personal|care|bath|soap|hygiene|beauty/i, Droplets],
  [/dairy|milk/i, Milk], [/meat|frozen|poultry|fish/i, Beef], [/fruit|vegetable|produce|fresh/i, Apple],
];
const iconFor = (category: string | null): LucideIcon => iconRules.find(([rule]) => rule.test(category ?? ''))?.[1] ?? ShoppingBasket;
const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');

export function ShopPage() {
  const { business = '' } = useParams();
  const base = `/shop/${encodeURIComponent(business)}`;
  const queryClient = useQueryClient();
  const [cart, setCart] = useState<Record<number, CartLine>>({});
  const [branchId, setBranchId] = useState<number | ''>('');
  const [fulfilment, setFulfilment] = useState<'pickup' | 'delivery'>('pickup');
  const [cashAmount, setCashAmount] = useState('');
  // The delivery address is remembered per customer account, so the next person to sign in on this device never
  // sees someone else's address. (The old per-shop copy, shared by everyone on the device, is removed.)
  const [locationOwner, setLocationOwner] = useState<number | null>(null);
  const locationKey = (owner: number) => `shop-delivery:${business}:${owner}`;
  const [deliveryLocation, setDeliveryLocation] = useState<DeliveryLocation>(emptyLocation);
  const [pickingLocation, setPickingLocation] = useState(false);
  const saveLocation = (location: DeliveryLocation) => {
    setDeliveryLocation(location);
    setPickingLocation(false);
    if (locationOwner) { try { localStorage.setItem(locationKey(locationOwner), JSON.stringify(location)); } catch { /* remembered for this visit only */ } }
  };
  const deliveryAddress = composeAddress(deliveryLocation);
  const deliveryPin = deliveryLocation.pin;
  const [trackingId, setTrackingId] = useState<number | null>(null);
  const toast = useToast();
  const ask = useConfirm();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [authOpen, setAuthOpen] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(ALL);
  const [sort, setSort] = useState<Sort>('featured');
  const savedKey = `shop-saved:${business}`;
  const [saved, setSaved] = useState<number[]>(() => { try { return JSON.parse(localStorage.getItem(savedKey) ?? '[]') as number[]; } catch { return []; } });
  const toggleSaved = (id: number) => setSaved((old) => {
    const next = old.includes(id) ? old.filter((x) => x !== id) : [...old, id];
    try { localStorage.setItem(savedKey, JSON.stringify(next)); } catch { /* storage unavailable: keep it for this visit */ }
    return next;
  });
  const catalog = useQuery({ queryKey: ['shop-catalog', business], queryFn: () => api<Catalog>(base) });
  const account = useQuery({
    queryKey: ['shop-account', business],
    queryFn: async () => {
      try { return (await api<{ data: Account }>(`${base}/me`)).data; }
      catch (e) {
        // An email that became a platform admin no longer shops: explain why they were signed out.
        if (e instanceof ApiError && e.code === 'MOVED_TO_ADMIN') { toast.info(e.message); return null; }
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
  });
  const accountId = account.data?.id ?? null;
  useEffect(() => {
    try { localStorage.removeItem(`shop-delivery:${business}`); } catch { /* nothing to clean */ }
    setLocationOwner(accountId);
    let saved = emptyLocation;
    if (accountId) { try { saved = loadLocation(localStorage.getItem(locationKey(accountId))); } catch { /* start empty */ } }
    setDeliveryLocation(saved);
  }, [accountId, business]); // eslint-disable-line react-hooks/exhaustive-deps -- reload only when the customer changes
  // Poll faster while a rider is on the way so the map follows them.
  const orders = useQuery({
    queryKey: ['shop-orders', business],
    queryFn: () => api<{ data: Order[] }>(`${base}/orders`),
    enabled: !!account.data,
    refetchInterval: (q) => (q.state.data?.data.some((o) => o.status === 'out_for_delivery' && !o.delivered_at) ? 10000 : 30000),
  });
  /** Sign-up waiting for the 6-digit code emailed to the customer. */
  const [verifying, setVerifying] = useState<{ email: string; resendIn: number; remember: boolean } | null>(null);
  const authMutation = useMutation({
    mutationFn: (payload: Record<string, string>) => api<{ verification_required?: boolean; email?: string; resend_after_seconds?: number }>(`${base}/${mode}`, { method: 'POST', body: payload }),
    onSuccess: async (result, payload) => {
      setError('');
      if (result?.verification_required) {
        setVerifying({ email: result.email ?? payload.email, resendIn: result.resend_after_seconds ?? 60, remember: payload.remember !== '0' });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['shop-account', business] });
      setAuthOpen(false);
      toast.success(mode === 'register' ? 'Welcome! Your account is ready.' : 'Welcome back! You are signed in.');
    },
    onError: (e, payload) => {
      // Signed up earlier but never entered the code: go straight to the code step (a new code was emailed).
      if (e instanceof ApiError && e.code === 'EMAIL_NOT_VERIFIED') { setError(''); setVerifying({ email: payload.email, resendIn: 60, remember: payload.remember !== '0' }); return; }
      setError(errorMessage(e));
    },
  });
  const logoutMutation = useMutation({ mutationFn: () => api(`${base}/logout`, { method: 'POST' }), onSuccess: async () => { setCart({}); await queryClient.invalidateQueries({ queryKey: ['shop-account', business] }); toast.info('You are signed out. See you again!'); } });
  const placeOrder = useMutation({
    mutationFn: () => api<{ data: Order }>(`${base}/orders`, { method: 'POST', body: {
      branch_id: branchId, fulfilment,
      ...(fulfilment === 'delivery' ? { delivery_address: deliveryAddress, cash_amount: cashAmount, note: deliveryLocation.note || null, ...(deliveryPin ? { delivery_lat: deliveryPin.lat, delivery_lng: deliveryPin.lng } : {}) } : {}),
      contact_name: account.data?.name,
      contact_phone: account.data?.phone,
      items: Object.values(cart).map(({ product, quantity }) => ({ product_id: product.id, quantity })),
    } }),
    onSuccess: async (result) => { setCart({}); setError(''); toast.success(`Order ${result.data.order_number} placed. We will let you know when the store confirms it.`); await queryClient.invalidateQueries({ queryKey: ['shop-orders', business] }); if (result.data.fulfilment === 'delivery') setTrackingId(result.data.id); },
    onError: (e) => setError(errorMessage(e)),
  });
  const cancelOrder = useMutation({
    mutationFn: (id: number) => api(`${base}/orders/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => { toast.info('Your order was cancelled.'); return queryClient.invalidateQueries({ queryKey: ['shop-orders', business] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const total = useMemo(() => Object.values(cart).reduce((sum, line) => sum + Number(line.product.price) * line.quantity, 0), [cart]);

  function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
    authMutation.mutate(payload);
  }
  function openAuth(next: 'login' | 'register' = 'login') { setMode(next); setError(''); setVerifying(null); setAuthOpen(true); }
  const closeAuth = useCallback(() => { setAuthOpen(false); setError(''); setVerifying(null); }, []);
  const onEmailVerified = async () => {
    setVerifying(null);
    await queryClient.invalidateQueries({ queryKey: ['shop-account', business] });
    setAuthOpen(false);
    toast.success('Email confirmed. Welcome! Your account is ready.');
  };

  // Forgive a pasted link that picked up a trailing full stop, comma or space: /shop/aling-nena-mini-mart. → /shop/aling-nena-mini-mart
  const cleanBusiness = business.trim().toLowerCase().replace(/[^a-z0-9]+$/, '');
  if (cleanBusiness && cleanBusiness !== business) return <Navigate to={`/shop/${cleanBusiness}`} replace />;
  if (catalog.isPending) return <ShopLoading />;
  if (catalog.isError || !catalog.data) return <ShopDirectory missing={catalog.error instanceof ApiError && catalog.error.status === 404 ? business : undefined} error={catalog.error} onRetry={() => catalog.refetch()} />;

  const shop = catalog.data;
  const categories = [ALL, ...new Set(shop.data.map((product) => product.category).filter((value): value is string => !!value))];
  const toneFor = (category: string | null) => tones[Math.max(0, categories.indexOf(category ?? '') - 1) % tones.length];
  const countFor = (category: string) => category === ALL ? shop.data.length : shop.data.filter((product) => product.category === category).length;
  const savedCount = shop.data.filter((product) => saved.includes(product.id)).length;
  const term = search.trim().toLowerCase();
  const visibleProducts = shop.data
    .filter((product) =>
      (selectedCategory === ALL || (selectedCategory === SAVED ? saved.includes(product.id) : product.category === selectedCategory)) &&
      `${product.name} ${product.description ?? ''} ${product.category ?? ''}`.toLowerCase().includes(term))
    .sort((a, b) => sort === 'price-asc' ? Number(a.price) - Number(b.price) : sort === 'price-desc' ? Number(b.price) - Number(a.price) : sort === 'name' ? a.name.localeCompare(b.name) : 0);
  const setQuantity = (product: ShopProduct, quantity: number) => setCart((old) => {
    const next = { ...old };
    if (quantity <= 0) delete next[product.id]; else next[product.id] = { product, quantity };
    return next;
  });
  const lines = cartLines(cart);
  const basketCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const signedIn = !!account.data;
  const firstName = account.data?.name.split(' ')[0] ?? '';
  const orderBlocker = !lines.length ? 'Add products to your basket' : !branchId ? 'Choose a branch' : fulfilment === 'delivery' && !deliveryAddress.trim() ? 'Enter a delivery address' : fulfilment === 'delivery' && (!cashAmount || Number(cashAmount) < total) ? 'Enter enough cash to cover the total' : '';
  const justPlaced = placeOrder.isSuccess && !lines.length ? placeOrder.data.data : null;
  const openOrders = orders.data?.data.filter((order) => !['completed', 'cancelled'].includes(order.status)).length ?? 0;
  const selectedBranch = shop.branches.find((b) => b.id === branchId);
  const trackedOrder = trackingId != null ? orders.data?.data.find((o) => o.id === trackingId) ?? null : null;
  /** "Buy again": put a past order's items back in the basket (matched by SKU), returns how many products were added. */
  const reorder = (order: Order) => {
    let added = 0;
    for (const item of order.items) {
      const product = shop.data.find((p) => p.sku === item.sku);
      if (!product) continue;
      setQuantity(product, (cart[product.id]?.quantity ?? 0) + Math.max(1, Math.round(Number(item.quantity))));
      added++;
    }
    return added;
  };

  return <div className={`min-h-screen bg-[#f5f7f4] text-slate-900 ${lines.length ? 'pb-24 lg:pb-0' : ''}`}>
    {/* ───────── Header ───────── */}
    <header className="relative z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1920px] items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6 lg:gap-8 lg:px-8">
        <a href="#top" className="flex min-w-0 items-center gap-2.5 sm:gap-3 md:shrink-0">
          <img src="/brand/minimart-logo.svg" className="size-10 shrink-0 rounded-xl bg-emerald-50 object-contain p-1 ring-1 ring-emerald-100 sm:size-11" alt="" />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-emerald-700">Pickup and delivery</p>
            <h1 className="truncate font-display text-[15px] font-bold leading-tight tracking-tight sm:text-lg">{shop.business.name}</h1>
          </div>
        </a>

        <label className="relative hidden max-w-xl flex-1 md:block">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${shop.data.length} products…`} aria-label="Search products" className="h-11 w-full rounded-full border border-slate-200 bg-slate-50 pl-11 pr-10 text-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-600/10" />
          {search && <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"><X size={14} /></button>}
        </label>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <a href="#basket" className="relative hidden size-11 place-items-center sm:grid rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-emerald-300 hover:text-emerald-800 lg:hidden" aria-label={`Basket, ${basketCount} items`}>
            <ShoppingBasket size={19} />
            {basketCount > 0 && <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-emerald-950 ring-2 ring-white">{basketCount}</span>}
          </a>
          {signedIn ? <>
            <button onClick={() => setHistoryOpen(true)} aria-label="My orders" className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-800"><Receipt size={17} /> <span className="hidden md:inline">My orders</span>{openOrders > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-emerald-950">{openOrders}</span>}</button>
            <button type="button" onClick={() => setAccountOpen(true)} title="My account" aria-label="My account" className="flex items-center gap-2.5 rounded-full border border-slate-200 bg-white p-1 text-left transition hover:border-emerald-300 sm:pr-3.5">
              <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-emerald-600 to-emerald-900 text-xs font-bold text-white">{initials(account.data!.name)}</span>
              <span className="hidden leading-tight sm:block"><span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">My account</span><span className="block text-sm font-semibold">{firstName}</span></span>
            </button>
            <button onClick={() => logoutMutation.mutate()} aria-label="Sign out" title="Sign out" className="hidden size-11 place-items-center sm:grid rounded-full border border-slate-200 text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"><LogOut size={17} /></button>
          </> : <>
            <button onClick={() => openAuth('register')} className="hidden h-11 items-center rounded-full px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 sm:inline-flex">Create account</button>
            <button onClick={() => openAuth('login')} className="inline-flex h-11 items-center gap-2 rounded-full bg-emerald-800 px-4 text-sm font-bold text-white shadow-sm shadow-emerald-900/20 transition hover:bg-emerald-900 sm:px-5">Sign in <ArrowRight size={15} className="hidden sm:block" /></button>
          </>}
        </div>
      </div>

      {/* Categories: one row of pills; on smaller screens it slides sideways (fades and arrows show there are more). */}
      <nav aria-label="Categories" className="border-t border-slate-100 bg-gradient-to-b from-white to-slate-50/60">
        <div className="mx-auto max-w-[1920px] py-2.5 lg:px-8">
          <CategoryRail>
            {categories.map((category, i) => {
              const Icon = category === ALL ? LayoutGrid : iconFor(category);
              const color = category === ALL ? null : CAT_COLORS[(i - 1) % CAT_COLORS.length];
              const active = selectedCategory === category;
              return <button key={category} onClick={() => setSelectedCategory(category)} aria-pressed={active} className={`group inline-flex shrink-0 snap-start items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-[13px] font-semibold transition duration-200 ${active ? 'bg-emerald-900 text-white shadow-md shadow-emerald-900/20' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:-translate-y-px hover:shadow-sm hover:ring-slate-300'}`}>
                <span className={`grid size-7 place-items-center rounded-full ${active ? 'bg-white/15 text-amber-300' : color ? `${color.bg} ${color.fg}` : 'bg-emerald-900 text-amber-300'}`}><Icon size={15} /></span>
                {category}
                <span className={`rounded-full px-1.5 text-[10px] font-bold ${active ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'}`}>{countFor(category)}</span>
              </button>;
            })}
            {(savedCount > 0 || selectedCategory === SAVED) && <button onClick={() => setSelectedCategory(SAVED)} aria-pressed={selectedCategory === SAVED} className={`inline-flex shrink-0 snap-start items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 lg:ml-auto text-[13px] font-semibold transition ${selectedCategory === SAVED ? 'bg-rose-500 text-white shadow-md' : 'bg-white text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50'}`}>
              <span className={`grid size-7 place-items-center rounded-full ${selectedCategory === SAVED ? 'bg-white/20' : 'bg-rose-100'}`}><Heart size={14} className="fill-current" /></span> Saved
              <span className={`rounded-full px-1.5 text-[10px] font-bold ${selectedCategory === SAVED ? 'bg-white/20 text-white' : 'bg-rose-50 text-rose-600'}`}>{savedCount}</span>
            </button>}
          </CategoryRail>
        </div>
      </nav>
    </header>

    <div id="top" className="mx-auto max-w-[1920px] px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      {signedIn && (
        <div className="mb-4 flex items-center gap-3 sm:hidden">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 font-display text-lg font-extrabold text-emerald-950 shadow-sm">{firstName.charAt(0).toUpperCase()}</span>
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-bold text-slate-900">Hi, {firstName}!</p>
            <p className="text-xs text-slate-500">{openOrders ? `You have ${openOrders} ${openOrders === 1 ? 'order' : 'orders'} in progress.` : 'What would you like today?'}</p>
          </div>
        </div>
      )}
      <ShopHero photos={shop.data} products={[...shop.data].sort((x, y) => totalStock(y) - totalStock(x))} branchCount={shop.branches.length} signedIn={signedIn} onCreateAccount={() => openAuth('register')} onAdd={(id) => { const p = shop.data.find((x) => x.id === id); if (p) setQuantity(p, (cart[id]?.quantity ?? 0) + 1); }} />

      {/* ───────── Shop + basket ───────── */}
      <main className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 pb-12 lg:grid-cols-[minmax(0,1fr)_380px] xl:gap-10 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <section id="products" className="min-w-0 scroll-mt-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.18em] text-emerald-700">{selectedCategory === ALL ? 'The store collection' : 'Category'}</p>
              <h2 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-[28px]">{selectedCategory}</h2>
              <p className="mt-1 text-sm text-slate-500">{visibleProducts.length} of {shop.data.length} items{term && <> matching “<span className="font-semibold text-slate-700">{search.trim()}</span>”</>}</p>
            </div>
            <div className="flex gap-2">
              <label className="relative min-w-0 flex-1 md:hidden">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products" aria-label="Search products" className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10" />
              </label>
              <label className="relative">
                <span className="sr-only">Sort products</span>
                <ArrowUpDown className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-11 appearance-none rounded-xl border border-slate-200 bg-white pl-10 pr-9 text-sm font-semibold text-slate-700 outline-none transition hover:border-slate-300 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10">
                  <option value="featured">Featured</option>
                  <option value="price-asc">Price: low to high</option>
                  <option value="price-desc">Price: high to low</option>
                  <option value="name">Name: A to Z</option>
                </select>
                <svg className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </label>
            </div>
          </div>

          {shop.data.length === 0
            ? <EmptyState title="No products yet" text="This store hasn't listed anything online yet. Please check back soon." />
            : !visibleProducts.length
              ? <EmptyState title="Nothing matches that search" text="Try a different word or browse another category." action={<button onClick={() => { setSearch(''); setSelectedCategory(ALL); }} className="mt-4 rounded-full bg-emerald-800 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-900">Show all products</button>} />
              : <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 min-[1700px]:grid-cols-5">
                {visibleProducts.map((product) => <ProductCard key={product.id} product={product} stock={productStock(product, branchId, shop.branches)} quantity={cart[product.id]?.quantity ?? 0} saved={saved.includes(product.id)} tone={toneFor(product.category)} Icon={iconFor(product.category)} onChange={(quantity) => setQuantity(product, quantity)} onToggleSaved={() => toggleSaved(product.id)} />)}
              </div>}
        </section>

        {/* ───────── Basket ───────── */}
        <aside className="min-w-0 space-y-5 lg:self-start">
          <section id="basket" className="scroll-mt-4 overflow-hidden rounded-3xl bg-white shadow-[0_20px_50px_-28px_rgba(6,50,35,.45)] ring-1 ring-slate-200/80">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-emerald-900 text-amber-300"><ShoppingBasket size={19} /></span>
              <div><h2 className="font-display text-lg font-bold leading-tight">Your basket</h2><p className="text-xs text-slate-500">{basketCount ? `${basketCount} ${basketCount === 1 ? 'item' : 'items'}` : `${fulfilment === 'pickup' ? 'Pickup' : 'Delivery'} order`}</p></div>
              </div>
              {lines.length > 0 && <button onClick={() => setCart({})} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-400 transition hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /> Clear</button>}
            </div>

            <div className="p-5">
              {justPlaced && <div className="mb-4 flex gap-3 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700" />
                <div className="text-sm"><p className="font-bold text-emerald-900">Order {justPlaced.order_number} placed</p><p className="mt-0.5 text-emerald-800/80">We'll prepare it at {justPlaced.branch.name}. Follow its status below.</p></div>
              </div>}

              {lines.length ? <ul className="-mx-1 max-h-[216px] overflow-y-auto px-1">
                {lines.map(({ product, quantity }) => {
                  const Icon = iconFor(product.category);
                  const tone = toneFor(product.category);
                  return <li key={product.id} className="flex items-center gap-3 rounded-xl py-2">
                    {product.image_url
                      ? <img src={product.image_url} alt="" className="size-11 shrink-0 rounded-xl bg-white object-cover ring-1 ring-slate-200" />
                      : <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${tone.bg} ${tone.fg}`}><Icon size={18} /></span>}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{product.name}</p>
                      <p className="text-xs text-slate-500">{peso(product.price)} / {product.unit}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-sm font-bold">{peso(Number(product.price) * quantity)}</span>
                      <Stepper size="sm" name={product.name} quantity={quantity} onChange={(q) => setQuantity(product, q)} />
                    </div>
                  </li>;
                })}
              </ul> : !justPlaced && <div className="rounded-2xl border-2 border-dashed border-slate-200 px-5 py-8 text-center">
                <span className="mx-auto grid size-12 place-items-center rounded-full bg-slate-50 text-slate-300"><ShoppingBasket size={22} /></span>
                <p className="mt-3 text-sm font-semibold text-slate-700">Your basket is empty</p>
                <p className="mt-1 text-xs text-slate-400">Tap <b className="text-slate-500">Add</b> on a product to start your order.</p>
              </div>}

              <fieldset className="mt-4">
                <legend className="mb-2 text-xs font-bold uppercase tracking-[.14em] text-slate-500">How would you like your order?</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(['pickup', 'delivery'] as const).map((value) => <button key={value} type="button" aria-pressed={fulfilment === value} onClick={() => setFulfilment(value)} className={`rounded-xl border px-3 py-2.5 text-sm font-semibold capitalize ${fulfilment === value ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-600/10' : 'border-slate-200 text-slate-600'}`}>{value}</button>)}
                </div>
              </fieldset>
              <fieldset className="mt-4">
                <legend className="mb-2 flex w-full items-center justify-between text-xs font-bold uppercase tracking-[.14em] text-slate-500">{fulfilment === 'pickup' ? 'Pickup branch' : 'Delivery branch'} {branchId && <span className="inline-flex items-center gap-1 normal-case tracking-normal text-emerald-700"><Check size={13} /> Selected</span>}</legend>
                <div className="space-y-2">
                  {shop.branches.map((branch) => {
                    const active = branchId === branch.id;
                    return <label key={branch.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${active ? 'border-emerald-600 bg-emerald-50/70 ring-4 ring-emerald-600/10' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
                      <input type="radio" name="pickup-branch" className="sr-only" checked={active} onChange={() => setBranchId(branch.id)} />
                      <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition ${active ? 'border-emerald-700 bg-emerald-700' : 'border-slate-300 bg-white'}`}>{active && <span className="size-1.5 rounded-full bg-white" />}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-900">{branch.name}</span>
                        {branch.address && <span className="mt-0.5 flex items-start gap-1 text-xs text-slate-500"><MapPin size={12} className="mt-0.5 shrink-0" />{branch.address}</span>}
                      </span>
                    </label>;
                  })}
                </div>
              </fieldset>
              {fulfilment === 'delivery' && <div className="mt-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-[.14em] text-slate-500">Deliver to</p>
                {deliveryAddress ? (
                  <div className="overflow-hidden rounded-2xl ring-1 ring-orange-200">
                    {deliveryPin && <button type="button" onClick={() => setPickingLocation(true)} className="block w-full" aria-label="Change delivery location on the map"><DeliveryMap home={deliveryPin} height={150} bare preview /></button>}
                    <div className="flex items-start gap-3 bg-orange-50/60 p-3.5">
                      <MapPin size={18} className="mt-0.5 shrink-0 text-orange-600" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-snug text-slate-900">{deliveryAddress}</p>
                        {deliveryLocation.note && <p className="mt-1 text-xs text-slate-500">Note: {deliveryLocation.note}</p>}
                        {!deliveryPin && <p className="mt-1 text-xs font-medium text-amber-700">No map pin yet. Add one so the rider finds you.</p>}
                      </div>
                      <button type="button" onClick={() => setPickingLocation(true)} className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-orange-700 ring-1 ring-orange-200 hover:bg-orange-50">Change</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setPickingLocation(true)} className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50/50 p-4 text-left transition hover:border-orange-400 hover:bg-orange-50">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-orange-500 text-white"><MapPin size={20} /></span>
                    <span className="min-w-0 flex-1"><span className="block font-bold text-slate-900">Set delivery address</span><span className="block text-xs text-slate-500">Search or pin your exact location on the map</span></span>
                    <ArrowRight size={18} className="shrink-0 text-orange-600" />
                  </button>
                )}
                <label className="block text-sm font-bold text-slate-800">Cash to pay rider with
                  <span className="mt-2 flex h-14 items-center overflow-hidden rounded-xl border-2 border-emerald-300 bg-emerald-50 shadow-sm transition focus-within:border-emerald-700 focus-within:ring-4 focus-within:ring-emerald-600/15">
                    <span aria-hidden="true" className="grid h-full min-w-14 place-items-center border-r border-emerald-200 bg-emerald-100 font-display text-2xl font-bold text-emerald-900">₱</span>
                    <input type="number" min={total} step="0.01" value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} placeholder={total.toFixed(2)} aria-label="Cash amount in Philippine pesos" className="h-full min-w-0 flex-1 bg-transparent px-4 font-display text-xl font-bold text-emerald-950 outline-none placeholder:font-medium placeholder:text-emerald-800/45" />
                  </span>
                </label>
                {Number(cashAmount) >= total && total > 0 && <p className="text-xs text-slate-600">Rider should bring <b>{peso(Number(cashAmount) - total)}</b> change.</p>}
              </div>}

              <dl className="mt-4 space-y-1.5 rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                <div className="flex justify-between text-slate-600"><dt>Items</dt><dd className="font-semibold text-slate-800">{basketCount}</dd></div>
                <div className="flex justify-between text-slate-600"><dt>Payment</dt><dd className="font-semibold text-slate-800">{fulfilment === 'pickup' ? 'In store at pickup' : 'Cash on delivery'}</dd></div>
                <div className="flex items-end justify-between border-t border-slate-200 pt-2.5"><dt className="font-semibold">Estimated total</dt><dd className="font-display text-2xl font-bold tracking-tight">{peso(total)}</dd></div>
              </dl>

              {signedIn
                ? <button disabled={!!orderBlocker || placeOrder.isPending} onClick={() => { setError(''); placeOrder.mutate(); }} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 font-bold text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none">
                  {placeOrder.isPending ? 'Placing order…' : orderBlocker || <>Place {fulfilment} order <ArrowRight size={16} /></>}
                </button>
                : <>
                  <button onClick={() => openAuth('login')} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 font-bold text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-900"><Lock size={16} /> Sign in to place order</button>
                  <p className="mt-2.5 text-center text-xs text-slate-500">New customer? <button onClick={() => openAuth('register')} className="font-semibold text-emerald-800 hover:underline">Create an account</button></p>
                </>}
              {error && !authOpen && <p key={error} role="alert" className="sp-alert-in sp-alert-error mt-3 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200">{error}</p>}
              <p className="mt-3 text-center text-[11px] leading-5 text-slate-400">Prices are estimates and are confirmed at the {fulfilment === 'pickup' ? 'store' : 'store before dispatch'}.</p>
            </div>
          </section>

          {signedIn && <section className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200/80">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-amber-100 text-amber-700"><Receipt size={18} /></span>
                <div><h2 className="font-display text-lg font-bold leading-tight">Your orders</h2><p className="text-xs text-slate-500">{openOrders ? `${openOrders} in progress` : 'Order history'}</p></div>
              </div>
            </div>
            <div className="p-5">
              {orders.isPending ? <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />)}</div>
                : orders.data?.data.length ? <>
                  <ul className="space-y-3">{orders.data.data.slice(0, 3).map((order) => <OrderCard key={order.id} order={order} cancelling={cancelOrder.isPending && cancelOrder.variables === order.id} onCancel={async () => { if (await ask({ title: `Cancel order ${order.order_number}?`, message: 'The store stops preparing it. You can order again any time.', confirmLabel: 'Cancel order', cancelLabel: 'Keep order' })) cancelOrder.mutate(order.id); }} onTrack={() => setTrackingId(order.id)} />)}</ul>
                  <button onClick={() => setHistoryOpen(true)} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200 transition hover:bg-emerald-50"><Receipt size={15} /> All orders &amp; purchase history</button>
                </>
                  : <p className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No orders yet. Your pickups and deliveries will appear here.</p>}
            </div>
          </section>}
        </aside>
      </main>
    </div>

    {/* ───────── Footer ───────── */}
    <footer className="bg-[#0a3d2c] text-emerald-50/80">
      <div className="mx-auto grid max-w-[1920px] gap-5 px-4 pb-6 pt-7 sm:gap-10 sm:px-6 sm:py-12 md:grid-cols-[1.2fr_1fr_1fr] lg:px-8">
        <div>
          <div className="flex items-center gap-3"><img src="/brand/minimart-logo.svg" alt="" className="size-9 rounded-xl bg-white object-contain p-1 sm:size-11" /><p className="font-display text-base font-bold text-white sm:text-lg">{shop.business.name}</p></div>
          <p className="mt-2.5 max-w-sm text-xs leading-5 sm:mt-4 sm:text-sm sm:leading-6">Order online and pick up at the branch of your choice. Payment is made in store when you collect.</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-amber-300 sm:text-[11px]">Pickup locations</p>
          <ul className="mt-2.5 flex flex-wrap gap-1.5 text-sm sm:mt-4 sm:block sm:space-y-3">{shop.branches.map((branch) => <li key={branch.id} className="flex items-center gap-1.5 rounded-full bg-white/[.07] px-2.5 py-1 ring-1 ring-white/10 sm:items-start sm:gap-2 sm:rounded-none sm:bg-transparent sm:p-0 sm:ring-0"><MapPin size={14} className="shrink-0 text-emerald-300 sm:mt-0.5" /><span><span className="text-xs font-semibold text-white sm:text-sm">{branch.name}</span>{branch.address && <span className="hidden text-xs text-emerald-50/60 sm:block">{branch.address}</span>}</span></li>)}</ul>
        </div>
        <div className="hidden sm:block">
          <p className="text-[11px] font-bold uppercase tracking-[.18em] text-amber-300">Order status</p>
          <ul className="mt-4 space-y-2.5 text-sm">{statusFlow.map((status) => <li key={status} className="flex items-center gap-2"><PackageCheck size={15} className="text-emerald-300" />{statusNames[status]}</li>)}</ul>
        </div>
      </div>
      <div className={`border-t border-white/10 px-4 pt-4 text-center text-[11px] text-emerald-50/50 sm:py-5 sm:text-xs lg:pb-5 ${lines.length ? 'pb-24' : 'pb-5'}`}>
        {shop.business.name} · Online orders powered by SmartPOS
        <span className="mt-1 block text-[10px] text-emerald-50/35 sm:text-[11px]">Some product photos: Open Food Facts, Open Beauty Facts &amp; Open Products Facts contributors (CC BY-SA 3.0) and Wikimedia Commons.</span>
      </div>
    </footer>

    {/* Mobile basket bar */}
    {lines.length > 0 && <a href="#basket" key={basketCount} className="sp-toast-in fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-full bg-gradient-to-r from-emerald-800 to-emerald-950 p-1.5 pl-2 text-white shadow-2xl shadow-emerald-950/40 ring-1 ring-white/10 lg:hidden">
      <span className="relative grid size-11 place-items-center rounded-full bg-white/12"><ShoppingBasket size={20} /><span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-emerald-950 ring-2 ring-emerald-900">{basketCount}</span></span>
      <span className="min-w-0 flex-1"><span className="block text-[11px] text-emerald-100/75">{basketCount} {basketCount === 1 ? 'item' : 'items'} · estimated</span><span className="font-display text-lg font-extrabold leading-tight">{peso(total)}</span></span>
      <span className="inline-flex h-11 items-center gap-1.5 rounded-full bg-amber-400 px-5 text-sm font-extrabold text-emerald-950 shadow-sm">Checkout <ArrowRight size={16} /></span>
    </a>}

    {accountOpen && account.data && <CustomerAccountDialog base={base} business={business} account={account.data} onClose={() => setAccountOpen(false)} onSignOut={() => { setAccountOpen(false); logoutMutation.mutate(); }} />}
    {pickingLocation && (
      <DeliveryLocationDialog
        initial={deliveryLocation}
        store={toLatLng(selectedBranch?.latitude, selectedBranch?.longitude) ?? toLatLng(shop.branches.find((b) => b.latitude != null)?.latitude, shop.branches.find((b) => b.latitude != null)?.longitude)}
        storeName={selectedBranch?.name}
        onClose={() => setPickingLocation(false)}
        onSave={saveLocation}
      />
    )}
    {trackedOrder && <TrackOrderDialog order={trackedOrder} onClose={() => setTrackingId(null)} />}
    {historyOpen && signedIn && (
      <OrderHistoryDialog
        base={base}
        orders={orders.data?.data ?? []}
        onClose={() => setHistoryOpen(false)}
        onTrack={(order) => { setHistoryOpen(false); setTrackingId(order.id); }}
        onReorder={reorder}
      />
    )}

    <CustomerAuthDialog
      open={authOpen && !account.data}
      onClose={closeAuth}
      storeName={shop.business.name}
      mode={mode}
      onModeChange={(m) => {setMode(m);setError('');}}
      onSubmit={submitAuth}
      busy={authMutation.isPending}
      error={error}
      basketCount={basketCount}
      basketTotal={peso(total)}
      apiBase={base}
      verifying={verifying}
      onVerified={() => void onEmailVerified()}
      onCancelVerify={() => setVerifying(null)}
      photos={[...lines.map(({ product }) => product), ...shop.data.filter((product) => !cart[product.id])]}
    />
  </div>;
}

function cartLines(cart: Record<number, CartLine>): CartLine[] { return Object.values(cart); }

type ProductStock = { label: string; level: 'available' | 'low' | 'none' | 'untracked' };

/** All stock of a product across branches (used to rank best sellers by availability). */
function totalStock(product: ShopProduct): number {
  return Object.values(product.stock_by_branch ?? {}).reduce((sum, s) => sum + Number(s.quantity), 0);
}

function productStock(product: ShopProduct, selectedBranch: number | '', branches: Branch[]): ProductStock {
  if (!product.track_inventory) return { label: 'Stock not tracked', level: 'untracked' };
  const entries = selectedBranch ? [product.stock_by_branch[selectedBranch] ?? { quantity: '0', reorder_level: null }] : Object.values(product.stock_by_branch);
  const quantity = entries.reduce((sum, stock) => sum + Number(stock.quantity), 0);
  const defaultLowAt = Number(product.reorder_level) > 0 ? Number(product.reorder_level) : 5;
  const lowAt = entries.reduce((sum, stock) => sum + Number(stock.reorder_level ?? defaultLowAt), 0);
  const amount = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 }).format(quantity);
  const branch = branches.find((item) => item.id === selectedBranch);
  const label = quantity <= 0 ? `Out of stock${branch ? ` at ${branch.name}` : ''}` : `${amount} in stock${branch ? ` · ${branch.name}` : ''}`;
  return { label, level: quantity <= 0 ? 'none' : quantity <= lowAt ? 'low' : 'available' };
}

/**
 * One sliding row of category pills. Edge fades and arrow buttons appear only while there is more to see in that
 * direction, so customers know to swipe; on wide screens everything fits and they disappear.
 */
function CategoryRail({ children }: { children: ReactNode }) {
  const rail = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const update = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [update]);
  const slide = (dir: 1 | -1) => rail.current?.scrollBy({ left: dir * rail.current.clientWidth * 0.7, behavior: 'smooth' });

  return (
    <div className="relative">
      <div ref={rail} onScroll={update} className="flex snap-x scroll-px-4 items-center gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:px-6 lg:px-0 [&::-webkit-scrollbar]:hidden">
        {children}
        <span aria-hidden className="w-1 shrink-0" />
      </div>
      {edges.left && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-white to-transparent" />
          <button type="button" onClick={() => slide(-1)} aria-label="Previous categories" className="absolute left-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-white text-slate-600 shadow-md ring-1 ring-slate-200"><ChevronLeft size={16} /></button>
        </>
      )}
      {edges.right && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-white via-white/80 to-transparent" />
          <button type="button" onClick={() => slide(1)} aria-label="More categories" className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-white text-emerald-700 shadow-md ring-1 ring-slate-200"><ChevronRight size={16} /></button>
        </>
      )}
    </div>
  );
}

function ProductCard({ product, stock, quantity, saved, tone, Icon, onChange, onToggleSaved }: { product: ShopProduct; stock: ProductStock; quantity: number; saved: boolean; tone: (typeof tones)[number]; Icon: LucideIcon; onChange: (quantity: number) => void; onToggleSaved: () => void }) {
  const out = stock.level === 'none';
  return <article className={`group relative flex flex-col overflow-hidden rounded-[22px] bg-white transition duration-300 hover:-translate-y-1 hover:shadow-[0_22px_45px_-24px_rgba(6,60,40,.45)] ${quantity ? 'ring-2 ring-emerald-600 shadow-[0_14px_30px_-18px_rgba(5,150,105,.55)]' : 'shadow-[0_1px_3px_rgba(15,23,42,.06)] ring-1 ring-slate-200/80'}`}>
    {/* Photo on a soft tinted square, with the save heart, badges and the quick-add button floating on it. */}
    <div className={`relative m-1.5 aspect-square overflow-hidden rounded-[18px] sm:m-2 ${tone.bg}`}>
      <span aria-hidden className="pointer-events-none absolute -bottom-10 left-1/2 h-20 w-[85%] -translate-x-1/2 rounded-full bg-white/70 blur-2xl" />
      {product.image_url
        ? <img src={product.image_url} alt={product.name} loading="lazy" className={`absolute inset-0 size-full object-contain p-4 mix-blend-multiply transition duration-500 group-hover:scale-[1.07] sm:p-5 ${out ? 'opacity-50 grayscale' : ''}`} />
        : <span className={`absolute inset-0 grid place-items-center ${tone.fg}`}><Icon className="size-14" strokeWidth={1.4} /></span>}

      <span className={`absolute left-2 top-2 max-w-[70%] truncate rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-bold backdrop-blur ${tone.label}`}>{product.category ?? 'Essentials'}</span>
      <button onClick={onToggleSaved} aria-pressed={saved} aria-label={saved ? `Remove ${product.name} from saved` : `Save ${product.name}`}
        className={`absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-white/90 shadow-sm backdrop-blur transition active:scale-90 ${saved ? 'text-rose-500' : 'text-slate-400 hover:text-rose-500'}`}>
        <Heart size={16} className={saved ? 'fill-rose-500' : ''} />
      </button>
      {stock.level === 'low' && <span className="absolute bottom-2 left-2 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950 shadow-sm">Few left</span>}
      {out && <span className="absolute bottom-2 left-2 rounded-full bg-slate-900/85 px-2 py-0.5 text-[10px] font-bold text-white">Out of stock</span>}

      <div className="absolute bottom-2 right-2">
        {quantity
          ? <div className="flex items-center gap-1 rounded-full bg-white p-1 shadow-lg shadow-emerald-950/15 ring-1 ring-emerald-600/20">
            <button aria-label={`Remove one ${product.name}`} onClick={() => onChange(quantity - 1)} className="grid size-8 place-items-center rounded-full bg-slate-100 text-slate-700 transition active:scale-90"><Minus size={14} strokeWidth={2.8} /></button>
            <span className="min-w-6 text-center font-display text-sm font-extrabold tabular-nums text-emerald-900" aria-label={`${quantity} in basket`}>{quantity}</span>
            <button aria-label={`Add one ${product.name}`} onClick={() => onChange(quantity + 1)} className="grid size-8 place-items-center rounded-full bg-emerald-700 text-white transition active:scale-90"><Plus size={14} strokeWidth={2.8} /></button>
          </div>
          : <button onClick={() => onChange(1)} aria-label={`Add ${product.name}`} className="grid size-10 place-items-center rounded-full bg-emerald-700 text-white shadow-lg shadow-emerald-900/30 ring-4 ring-white/70 transition hover:bg-emerald-800 active:scale-90"><Plus size={20} strokeWidth={2.6} /></button>}
      </div>
    </div>

    <div className="flex flex-1 flex-col px-3 pb-3 pt-1 sm:px-4 sm:pb-4">
      <h3 className="line-clamp-2 min-h-[2.5rem] text-[14px] font-bold leading-5 text-slate-900 sm:text-[15px]" title={product.name}>{product.name}</h3>
      <p className="mt-0.5 hidden truncate text-xs text-slate-500 sm:block" title={product.description ?? undefined}>{product.description || `Sold per ${product.unit}`}</p>
      <div className="mt-auto pt-2">
        <p className="font-display text-lg font-extrabold leading-none tracking-tight text-slate-900 sm:text-xl">{peso(product.price)}<span className="ml-1 text-[11px] font-semibold text-slate-400">/ {product.unit}</span></p>
        <p className={`mt-1.5 flex items-center gap-1.5 truncate text-[11px] font-semibold ${stock.level === 'available' ? 'text-emerald-700' : stock.level === 'low' ? 'text-amber-700' : out ? 'text-red-600' : 'text-slate-500'}`}>
          <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${stock.level === 'available' ? 'bg-emerald-500' : stock.level === 'low' ? 'bg-amber-500' : out ? 'bg-red-500' : 'bg-slate-400'}`} />
          <span className="truncate">{stock.label}</span>
        </p>
      </div>
    </div>
  </article>;
}

function Stepper({ name, quantity, onChange, size = 'md' }: { name: string; quantity: number; onChange: (quantity: number) => void; size?: 'sm' | 'md' }) {
  const button = size === 'sm' ? 'size-6' : 'size-8';
  return <div className={`inline-flex items-center rounded-full bg-slate-100 ring-1 ring-slate-200/70 ${size === 'sm' ? 'gap-1 p-0.5' : 'gap-1.5 p-0.5'}`}>
    <button aria-label={`Remove one ${name}`} onClick={() => onChange(quantity - 1)} className={`grid ${button} place-items-center rounded-full bg-white text-slate-600 shadow-sm transition hover:bg-red-50 hover:text-red-600`}><Minus size={size === 'sm' ? 12 : 14} strokeWidth={2.6} /></button>
    <span className={`min-w-5 text-center font-bold tabular-nums ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>{quantity}</span>
    <button aria-label={`Add one ${name}`} onClick={() => onChange(quantity + 1)} className={`grid ${button} place-items-center rounded-full bg-emerald-800 text-white shadow-sm transition hover:bg-emerald-900`}><Plus size={size === 'sm' ? 12 : 14} strokeWidth={2.6} /></button>
  </div>;
}

function OrderCard({ order, cancelling, onCancel, onTrack }: { order: Order; cancelling: boolean; onCancel: () => void; onTrack: () => void }) {
  const onTheWay = order.status === 'out_for_delivery' && !order.delivered_at;
  const cancelled = order.status === 'cancelled';
  const flow = order.fulfilment === 'delivery' ? ['pending', 'confirmed', 'ready', 'out_for_delivery', 'completed'] : ['pending', 'confirmed', 'ready', 'completed'];
  const step = flow.indexOf(order.status);
  const tone = cancelled ? 'bg-red-50 text-red-700 ring-red-200' : ['ready', 'out_for_delivery'].includes(order.status) ? 'bg-amber-50 text-amber-800 ring-amber-200' : order.status === 'completed' ? 'bg-slate-100 text-slate-600 ring-slate-200' : 'bg-emerald-50 text-emerald-800 ring-emerald-200';
  return <li className="rounded-2xl border border-slate-200 p-4">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0"><p className="font-display text-sm font-bold">{order.order_number}</p><p className="mt-0.5 truncate text-xs text-slate-500">{order.branch.name} · {new Date(order.placed_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p></div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${tone}`}>{statusNames[order.status] ?? order.status}</span>
    </div>
    {!cancelled && <div className="mt-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${flow.length}, minmax(0, 1fr))` }} aria-hidden>{flow.map((status, i) => <span key={status} className={`h-1.5 rounded-full ${i <= step ? (['ready', 'out_for_delivery'].includes(order.status) ? 'bg-amber-400' : 'bg-emerald-600') : 'bg-slate-200'}`} />)}</div>}
    {order.fulfilment === 'delivery' && <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><p><b>Delivery</b> · {order.delivery_address}</p><p className="mt-1">Cash: {peso(order.cash_amount ?? '0')} · Change: {peso(order.change_due ?? '0')}</p>{order.rider_name && <p className="mt-1">Rider: {order.rider_name}</p>}</div>}
    <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-600">{order.items.map((item) => `${Number(item.quantity)} ${item.unit} ${item.name}`).join(' · ')}</p>
    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
      <span className="font-display text-base font-bold">{peso(order.estimated_total)}</span>
      <span className="flex items-center gap-1">
        {['pending', 'confirmed'].includes(order.status) && <button aria-label="Cancel order" disabled={cancelling} onClick={onCancel} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"><X size={13} /> {cancelling ? 'Cancelling…' : 'Cancel'}</button>}
        <button onClick={onTrack} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${onTheWay ? 'bg-rose-600 text-white hover:bg-rose-700' : 'text-emerald-800 hover:bg-emerald-50'}`}>
          {onTheWay ? <><MapPin size={13} /> Track rider</> : order.fulfilment === 'delivery' && !['completed', 'cancelled'].includes(order.status) ? <><MapPin size={13} /> Track</> : 'Details'}
        </button>
      </span>
    </div>
  </li>;
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="mt-6 rounded-3xl border-2 border-dashed border-slate-200 bg-white px-6 py-14 text-center">
    <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-slate-50 text-slate-300"><Search size={24} /></span>
    <p className="mt-4 font-display text-lg font-bold">{title}</p>
    <p className="mt-1 text-sm text-slate-500">{text}</p>
    {action}
  </div>;
}

function ShopLoading() {
  return <div className="min-h-screen bg-[#f5f7f4]">
    <div className="h-[118px] border-b border-slate-200 bg-white" />
    <div className="mx-auto max-w-[1920px] px-4 pt-8 sm:px-6 lg:px-8">
      <div className="h-72 animate-pulse rounded-[32px] bg-emerald-900/10" />
      <div className="mt-8 grid grid-cols-2 gap-5 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-72 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />)}</div>
    </div>
  </div>;
}
