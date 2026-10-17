import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Apple, ArrowRight, ArrowUpDown, Beef, Check, CheckCircle2, Clock3, Cookie, CupSoda, Droplets, LayoutGrid, Lock, LogOut,
  MapPin, Milk, Minus, PackageCheck, Plus, Receipt, Search, ShoppingBasket, Soup, SprayCan, Store, Trash2, Wallet, Wheat, X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { ApiError, api, errorMessage } from '../../lib/api';
import { CustomerAuthDialog } from './CustomerAuthDialog';

interface Branch { id: number; code: string; name: string; address: string | null }
interface ShopProduct { id: number; sku: string; name: string; description: string | null; unit: string; price: string; category: string | null }
interface Catalog { business: { name: string; code: string }; branches: Branch[]; data: ShopProduct[] }
interface Account { id: number; name: string; email: string; phone: string }
interface Order { id: number; order_number: string; status: string; estimated_total: string; placed_at: string; branch: { name: string }; items: { id: number; name: string; quantity: string; unit: string; line_total: string }[] }
interface CartLine { product: ShopProduct; quantity: number }
type Sort = 'featured' | 'price-asc' | 'price-desc' | 'name';

const peso = (value: string | number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value));
const statusNames: Record<string, string> = { pending: 'Waiting for store confirmation', confirmed: 'Being prepared', ready: 'Ready for pickup', completed: 'Picked up', cancelled: 'Cancelled' };
const statusFlow = ['pending', 'confirmed', 'ready', 'completed'];
const ALL = 'All products';

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
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [authOpen, setAuthOpen] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(ALL);
  const [sort, setSort] = useState<Sort>('featured');
  const catalog = useQuery({ queryKey: ['shop-catalog', business], queryFn: () => api<Catalog>(base) });
  const account = useQuery({
    queryKey: ['shop-account', business],
    queryFn: async () => {
      try { return (await api<{ data: Account }>(`${base}/me`)).data; }
      catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null; throw e; }
    },
  });
  const orders = useQuery({ queryKey: ['shop-orders', business], queryFn: () => api<{ data: Order[] }>(`${base}/orders`), enabled: !!account.data });
  const authMutation = useMutation({
    mutationFn: (payload: Record<string, string>) => api(`${base}/${mode}`, { method: 'POST', body: payload }),
    onSuccess: async () => { setError(''); await queryClient.invalidateQueries({ queryKey: ['shop-account', business] }); setAuthOpen(false); },
    onError: (e) => setError(errorMessage(e)),
  });
  const logoutMutation = useMutation({ mutationFn: () => api(`${base}/logout`, { method: 'POST' }), onSuccess: async () => { setCart({}); await queryClient.invalidateQueries({ queryKey: ['shop-account', business] }); } });
  const placeOrder = useMutation({
    mutationFn: () => api<{ data: Order }>(`${base}/orders`, { method: 'POST', body: {
      branch_id: branchId,
      contact_name: account.data?.name,
      contact_phone: account.data?.phone,
      items: Object.values(cart).map(({ product, quantity }) => ({ product_id: product.id, quantity })),
    } }),
    onSuccess: async () => { setCart({}); setError(''); await queryClient.invalidateQueries({ queryKey: ['shop-orders', business] }); },
    onError: (e) => setError(errorMessage(e)),
  });
  const cancelOrder = useMutation({
    mutationFn: (id: number) => api(`${base}/orders/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shop-orders', business] }),
  });
  const total = useMemo(() => Object.values(cart).reduce((sum, line) => sum + Number(line.product.price) * line.quantity, 0), [cart]);

  function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)]));
    authMutation.mutate(payload);
  }
  function openAuth(next: 'login' | 'register' = 'login') { setMode(next); setError(''); setAuthOpen(true); }
  const closeAuth = useCallback(() => { setAuthOpen(false); setError(''); }, []);

  if (catalog.isPending) return <ShopLoading />;
  if (catalog.isError) return <div className="grid min-h-screen place-items-center bg-[#f5f7f4] p-4"><div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-red-50 text-red-600"><Store /></span><h1 className="mt-4 font-display text-xl font-bold">Shop unavailable</h1><p className="mt-2 text-sm text-slate-600">{errorMessage(catalog.error)}</p></div></div>;

  const shop = catalog.data;
  const categories = [ALL, ...new Set(shop.data.map((product) => product.category).filter((value): value is string => !!value))];
  const toneFor = (category: string | null) => tones[Math.max(0, categories.indexOf(category ?? '') - 1) % tones.length];
  const countFor = (category: string) => category === ALL ? shop.data.length : shop.data.filter((product) => product.category === category).length;
  const term = search.trim().toLowerCase();
  const visibleProducts = shop.data
    .filter((product) =>
      (selectedCategory === ALL || product.category === selectedCategory) &&
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
  const orderBlocker = !lines.length ? 'Add products to your basket' : !branchId ? 'Choose a pickup branch' : '';
  const justPlaced = placeOrder.isSuccess && !lines.length ? placeOrder.data.data : null;
  const openOrders = orders.data?.data.filter((order) => !['completed', 'cancelled'].includes(order.status)).length ?? 0;

  return <div className={`min-h-screen bg-[#f5f7f4] text-slate-900 ${lines.length ? 'pb-24 lg:pb-0' : ''}`}>
    {/* ───────── Header ───────── */}
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1560px] items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6 lg:gap-8 lg:px-8">
        <a href="#top" className="flex min-w-0 items-center gap-3 md:shrink-0">
          <img src="/brand/minimart-logo.svg" className="size-10 shrink-0 rounded-xl bg-emerald-50 object-contain p-1 ring-1 ring-emerald-100 sm:size-11" alt="" />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-emerald-700">Online pickup</p>
            <h1 className="truncate font-display text-base font-bold leading-tight sm:text-lg">{shop.business.name}</h1>
          </div>
        </a>

        <label className="relative hidden max-w-xl flex-1 md:block">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${shop.data.length} products…`} aria-label="Search products" className="h-11 w-full rounded-full border border-slate-200 bg-slate-50 pl-11 pr-10 text-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-600/10" />
          {search && <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"><X size={14} /></button>}
        </label>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <a href="#basket" className="relative grid size-11 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-emerald-300 hover:text-emerald-800 lg:hidden" aria-label={`Basket, ${basketCount} items`}>
            <ShoppingBasket size={19} />
            {basketCount > 0 && <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-emerald-950 ring-2 ring-white">{basketCount}</span>}
          </a>
          {signedIn ? <>
            <div className="hidden items-center gap-2.5 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3.5 sm:flex">
              <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-emerald-600 to-emerald-900 text-xs font-bold text-white">{initials(account.data!.name)}</span>
              <div className="leading-tight"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Signed in</p><p className="text-sm font-semibold">{firstName}</p></div>
            </div>
            <button onClick={() => logoutMutation.mutate()} aria-label="Sign out" title="Sign out" className="grid size-11 place-items-center rounded-full border border-slate-200 text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"><LogOut size={17} /></button>
          </> : <>
            <button onClick={() => openAuth('register')} className="hidden h-11 items-center rounded-full px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 sm:inline-flex">Create account</button>
            <button onClick={() => openAuth('login')} className="inline-flex h-11 items-center gap-2 rounded-full bg-emerald-800 px-4 text-sm font-bold text-white shadow-sm shadow-emerald-900/20 transition hover:bg-emerald-900 sm:px-5">Sign in <ArrowRight size={15} className="hidden sm:block" /></button>
          </>}
        </div>
      </div>

      {/* Category rail */}
      <nav aria-label="Categories" className="border-t border-slate-100">
        <div className="mx-auto flex max-w-[1560px] gap-1.5 overflow-x-auto px-4 py-2 [scrollbar-width:none] sm:px-6 lg:px-8">
          {categories.map((category) => {
            const Icon = category === ALL ? LayoutGrid : iconFor(category);
            const active = selectedCategory === category;
            return <button key={category} onClick={() => setSelectedCategory(category)} aria-pressed={active} className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold transition ${active ? 'bg-emerald-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
              <Icon size={15} className={active ? 'text-amber-300' : 'text-slate-400'} />
              {category}
              <span className={`rounded-full px-1.5 text-[10px] font-bold ${active ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'}`}>{countFor(category)}</span>
            </button>;
          })}
        </div>
      </nav>
    </header>

    <div id="top" className="mx-auto max-w-[1560px] px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      {/* ───────── Hero ───────── */}
      <section className="relative isolate overflow-hidden rounded-[32px] bg-[#0a3d2c] text-white shadow-xl shadow-emerald-950/10">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_left,#13724f_0%,transparent_55%),radial-gradient(ellipse_at_bottom_right,#0f5a40_0%,transparent_60%)]" />
        <div className="absolute -right-24 -top-32 -z-10 size-[420px] rounded-full bg-amber-400/15 blur-3xl" />
        <div className="absolute inset-0 -z-10 opacity-[0.07] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.25fr_1fr] lg:items-center lg:gap-12 lg:p-12">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.18em] text-emerald-100 ring-1 ring-white/15"><Store size={13} className="text-amber-300" /> Your neighborhood store, online</span>
            <h2 className="mt-5 max-w-2xl font-display text-[34px] font-bold leading-[1.06] tracking-tight sm:text-5xl lg:text-[56px]">
              Shop online.<br /><span className="bg-gradient-to-r from-amber-200 via-amber-300 to-amber-400 bg-clip-text text-transparent">Pick up in minutes.</span>
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-6 text-emerald-50/80 sm:text-base sm:leading-7">Fill your basket with everyday essentials, choose the branch nearest you, and collect your order when the store has it ready.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#products" className="inline-flex h-12 items-center gap-2 rounded-full bg-amber-400 px-6 text-sm font-bold text-emerald-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-300">Start shopping <ArrowRight size={16} /></a>
              {!signedIn && <button onClick={() => openAuth('register')} className="inline-flex h-12 items-center rounded-full px-6 text-sm font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/10">Create a free account</button>}
            </div>
            <dl className="mt-9 grid max-w-lg grid-cols-3 divide-x divide-white/10 rounded-2xl bg-white/[.06] ring-1 ring-white/10">
              <HeroStat value={String(shop.data.length)} label="Products" />
              <HeroStat value={String(shop.branches.length)} label={shop.branches.length === 1 ? 'Pickup branch' : 'Pickup branches'} />
              <HeroStat value="₱0" label="Paid online" />
            </dl>
          </div>

          <div className="hidden rounded-3xl bg-white/[.07] p-5 ring-1 ring-white/15 backdrop-blur sm:block sm:p-6">
            <p className="text-[11px] font-bold uppercase tracking-[.18em] text-amber-300">How pickup works</p>
            <ol className="mt-4 space-y-3">
              <HowStep n={1} icon={ShoppingBasket} title="Fill your basket" text="Browse by category or search for what you need." />
              <HowStep n={2} icon={Clock3} title="The store prepares it" text="Track your order from Waiting to Ready for pickup." />
              <HowStep n={3} icon={Wallet} title="Collect and pay in store" text="Prices are confirmed and paid at the counter." />
            </ol>
          </div>
        </div>
      </section>

      {/* ───────── Shop + basket ───────── */}
      <main className="mt-8 grid gap-8 pb-12 lg:grid-cols-[minmax(0,1fr)_380px] xl:gap-10">
        <section id="products" className="min-w-0 scroll-mt-36">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.18em] text-emerald-700">{selectedCategory === ALL ? 'The store collection' : 'Category'}</p>
              <h2 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-[28px]">{selectedCategory}</h2>
              <p className="mt-1 text-sm text-slate-500">{visibleProducts.length} of {shop.data.length} items{term && <> matching “<span className="font-semibold text-slate-700">{search.trim()}</span>”</>}</p>
            </div>
            <div className="flex gap-2">
              <label className="relative flex-1 md:hidden">
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
              : <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 xl:grid-cols-3 2xl:grid-cols-4">
                {visibleProducts.map((product) => <ProductCard key={product.id} product={product} quantity={cart[product.id]?.quantity ?? 0} tone={toneFor(product.category)} Icon={iconFor(product.category)} onChange={(quantity) => setQuantity(product, quantity)} />)}
              </div>}
        </section>

        {/* ───────── Basket ───────── */}
        <aside className="space-y-5 lg:sticky lg:top-[136px] lg:max-h-[calc(100vh-152px)] lg:self-start lg:overflow-y-auto lg:pb-2 [scrollbar-width:thin]">
          <section id="basket" className="scroll-mt-36 overflow-hidden rounded-3xl bg-white shadow-[0_20px_50px_-28px_rgba(6,50,35,.45)] ring-1 ring-slate-200/80">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-emerald-900 text-amber-300"><ShoppingBasket size={19} /></span>
                <div><h2 className="font-display text-lg font-bold leading-tight">Your basket</h2><p className="text-xs text-slate-500">{basketCount ? `${basketCount} ${basketCount === 1 ? 'item' : 'items'}` : 'Pickup order'}</p></div>
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
                    <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${tone.bg} ${tone.fg}`}><Icon size={18} /></span>
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
                <legend className="mb-2 flex w-full items-center justify-between text-xs font-bold uppercase tracking-[.14em] text-slate-500">Pickup branch {branchId && <span className="inline-flex items-center gap-1 normal-case tracking-normal text-emerald-700"><Check size={13} /> Selected</span>}</legend>
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

              <dl className="mt-4 space-y-1.5 rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                <div className="flex justify-between text-slate-600"><dt>Items</dt><dd className="font-semibold text-slate-800">{basketCount}</dd></div>
                <div className="flex justify-between text-slate-600"><dt>Payment</dt><dd className="font-semibold text-slate-800">In store at pickup</dd></div>
                <div className="flex items-end justify-between border-t border-slate-200 pt-2.5"><dt className="font-semibold">Estimated total</dt><dd className="font-display text-2xl font-bold tracking-tight">{peso(total)}</dd></div>
              </dl>

              {signedIn
                ? <button disabled={!!orderBlocker || placeOrder.isPending} onClick={() => { setError(''); placeOrder.mutate(); }} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 font-bold text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none">
                  {placeOrder.isPending ? 'Placing order…' : orderBlocker || <>Place pickup order <ArrowRight size={16} /></>}
                </button>
                : <>
                  <button onClick={() => openAuth('login')} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 font-bold text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-900"><Lock size={16} /> Sign in to place order</button>
                  <p className="mt-2.5 text-center text-xs text-slate-500">New customer? <button onClick={() => openAuth('register')} className="font-semibold text-emerald-800 hover:underline">Create an account</button></p>
                </>}
              {error && !authOpen && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200">{error}</p>}
              <p className="mt-3 text-center text-[11px] leading-5 text-slate-400">Prices are estimates and are confirmed at the counter.</p>
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
                : orders.data?.data.length ? <ul className="space-y-3">{orders.data.data.map((order) => <OrderCard key={order.id} order={order} cancelling={cancelOrder.isPending && cancelOrder.variables === order.id} onCancel={() => cancelOrder.mutate(order.id)} />)}</ul>
                  : <p className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No orders yet. Your pickups will appear here.</p>}
            </div>
          </section>}
        </aside>
      </main>
    </div>

    {/* ───────── Footer ───────── */}
    <footer className="bg-[#0a3d2c] text-emerald-50/80">
      <div className="mx-auto grid max-w-[1560px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.2fr_1fr_1fr] lg:px-8">
        <div>
          <div className="flex items-center gap-3"><img src="/brand/minimart-logo.svg" alt="" className="size-11 rounded-xl bg-white object-contain p-1" /><p className="font-display text-lg font-bold text-white">{shop.business.name}</p></div>
          <p className="mt-4 max-w-sm text-sm leading-6">Order online and pick up at the branch of your choice. Payment is made in store when you collect.</p>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.18em] text-amber-300">Pickup locations</p>
          <ul className="mt-4 space-y-3 text-sm">{shop.branches.map((branch) => <li key={branch.id} className="flex gap-2"><MapPin size={15} className="mt-0.5 shrink-0 text-emerald-300" /><span><span className="font-semibold text-white">{branch.name}</span>{branch.address && <span className="block text-xs text-emerald-50/60">{branch.address}</span>}</span></li>)}</ul>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.18em] text-amber-300">Order status</p>
          <ul className="mt-4 space-y-2.5 text-sm">{statusFlow.map((status) => <li key={status} className="flex items-center gap-2"><PackageCheck size={15} className="text-emerald-300" />{statusNames[status]}</li>)}</ul>
        </div>
      </div>
      <div className="border-t border-white/10 px-4 py-5 text-center text-xs text-emerald-50/50">{shop.business.name} · Online pickup powered by SmartPOS</div>
    </footer>

    {/* Mobile basket bar */}
    {lines.length > 0 && <a href="#basket" className="fixed inset-x-3 bottom-3 z-30 flex items-center gap-3 rounded-2xl bg-emerald-950 p-2 pl-3 text-white shadow-2xl shadow-emerald-950/40 lg:hidden">
      <span className="relative grid size-10 place-items-center rounded-xl bg-white/10"><ShoppingBasket size={19} /><span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-emerald-950">{basketCount}</span></span>
      <span className="flex-1"><span className="block text-xs text-emerald-100/70">Estimated total</span><span className="font-display font-bold">{peso(total)}</span></span>
      <span className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-amber-400 px-4 text-sm font-bold text-emerald-950">View basket <ArrowRight size={15} /></span>
    </a>}

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
    />
  </div>;
}

function cartLines(cart: Record<number, CartLine>): CartLine[] { return Object.values(cart); }

function ProductCard({ product, quantity, tone, Icon, onChange }: { product: ShopProduct; quantity: number; tone: (typeof tones)[number]; Icon: LucideIcon; onChange: (quantity: number) => void }) {
  return <article className={`group relative flex flex-col overflow-hidden rounded-2xl bg-white transition duration-300 hover:-translate-y-1 hover:shadow-[0_22px_44px_-22px_rgba(6,60,40,.4)] ${quantity ? 'ring-2 ring-emerald-600' : 'shadow-[0_1px_3px_rgba(15,23,42,.05)] ring-1 ring-slate-200/80'}`}>
    <div className={`relative grid h-32 place-items-center overflow-hidden sm:h-40 ${tone.bg}`}>
      <div className="absolute inset-0 opacity-50 [background-image:radial-gradient(rgba(255,255,255,.9)_1.2px,transparent_1.2px)] [background-size:14px_14px]" />
      <div className={`absolute -bottom-10 -right-10 size-32 rounded-full bg-white/50 transition duration-500 group-hover:scale-125`} />
      <span className={`relative grid size-16 place-items-center rounded-2xl bg-white shadow-[0_8px_20px_-8px_rgba(15,23,42,.25)] transition duration-300 group-hover:-rotate-6 group-hover:scale-110 sm:size-20 ${tone.fg}`}><Icon className="size-8 sm:size-9" strokeWidth={1.6} /></span>
      {quantity > 0 && <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-emerald-700 px-2 py-1 text-[10px] font-bold text-white shadow-sm"><Check size={11} strokeWidth={3} /> {quantity} in basket</span>}
    </div>
    <div className="flex flex-1 flex-col p-3.5 sm:p-4">
      <p className={`text-[10px] font-bold uppercase tracking-[.14em] ${tone.label}`}>{product.category ?? 'Essentials'}</p>
      <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-slate-900 sm:text-[15px]">{product.name}</h3>
      {product.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{product.description}</p>}
      <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-4">
        <p className="leading-none"><span className="font-display text-lg font-bold tracking-tight sm:text-xl">{peso(product.price)}</span><span className="ml-1 text-[11px] font-medium text-slate-400">/ {product.unit}</span></p>
        {quantity
          ? <Stepper name={product.name} quantity={quantity} onChange={onChange} />
          : <button onClick={() => onChange(1)} aria-label={`Add ${product.name}`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-800 pl-3 pr-3.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-900 active:scale-95"><Plus size={14} strokeWidth={2.6} /> Add</button>}
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

function OrderCard({ order, cancelling, onCancel }: { order: Order; cancelling: boolean; onCancel: () => void }) {
  const cancelled = order.status === 'cancelled';
  const step = statusFlow.indexOf(order.status);
  const tone = cancelled ? 'bg-red-50 text-red-700 ring-red-200' : order.status === 'ready' ? 'bg-amber-50 text-amber-800 ring-amber-200' : order.status === 'completed' ? 'bg-slate-100 text-slate-600 ring-slate-200' : 'bg-emerald-50 text-emerald-800 ring-emerald-200';
  return <li className="rounded-2xl border border-slate-200 p-4">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0"><p className="font-display text-sm font-bold">{order.order_number}</p><p className="mt-0.5 truncate text-xs text-slate-500">{order.branch.name} · {new Date(order.placed_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p></div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${tone}`}>{statusNames[order.status] ?? order.status}</span>
    </div>
    {!cancelled && <div className="mt-3 grid grid-cols-4 gap-1" aria-hidden>{statusFlow.map((status, i) => <span key={status} className={`h-1.5 rounded-full ${i <= step ? (order.status === 'ready' ? 'bg-amber-400' : 'bg-emerald-600') : 'bg-slate-200'}`} />)}</div>}
    <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-600">{order.items.map((item) => `${Number(item.quantity)} ${item.unit} ${item.name}`).join(' · ')}</p>
    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
      <span className="font-display text-base font-bold">{peso(order.estimated_total)}</span>
      {['pending', 'confirmed'].includes(order.status) && <button disabled={cancelling} onClick={onCancel} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"><X size={13} /> {cancelling ? 'Cancelling…' : 'Cancel order'}</button>}
    </div>
  </li>;
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return <div className="px-4 py-3.5"><dt className="sr-only">{label}</dt><dd className="font-display text-2xl font-bold text-white">{value}</dd><dd className="mt-0.5 text-[11px] font-medium text-emerald-100/70">{label}</dd></div>;
}

function HowStep({ n, icon: Icon, title, text }: { n: number; icon: LucideIcon; title: string; text: string }) {
  return <li className="flex items-start gap-4 rounded-2xl bg-white/[.06] p-4 ring-1 ring-white/10">
    <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-amber-400 text-emerald-950"><Icon size={19} /><span className="absolute -left-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-emerald-950 text-[10px] font-bold text-amber-300 ring-2 ring-[#0d4532]">{n}</span></span>
    <div><p className="text-sm font-semibold text-white">{title}</p><p className="mt-0.5 text-xs leading-5 text-emerald-100/70">{text}</p></div>
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
    <div className="mx-auto max-w-[1560px] px-4 pt-8 sm:px-6 lg:px-8">
      <div className="h-72 animate-pulse rounded-[32px] bg-emerald-900/10" />
      <div className="mt-8 grid grid-cols-2 gap-5 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-72 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />)}</div>
    </div>
  </div>;
}
