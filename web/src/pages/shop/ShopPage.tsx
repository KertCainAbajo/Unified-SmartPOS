import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, LogOut, PackageCheck, ShoppingBag, Store, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, api, errorMessage } from '../../lib/api';

interface Branch { id: number; code: string; name: string; address: string | null }
interface ShopProduct { id: number; sku: string; name: string; description: string | null; unit: string; price: string; category: string | null }
interface Catalog { business: { name: string; code: string }; branches: Branch[]; data: ShopProduct[] }
interface Account { id: number; name: string; email: string; phone: string }
interface Order { id: number; order_number: string; status: string; estimated_total: string; placed_at: string; branch: { name: string }; items: { id: number; name: string; quantity: string; unit: string; line_total: string }[] }
interface CartLine { product: ShopProduct; quantity: number }

const peso = (value: string | number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value));
const statusNames: Record<string, string> = { pending: 'Waiting for store confirmation', confirmed: 'Being prepared', ready: 'Ready for pickup', completed: 'Picked up', cancelled: 'Cancelled' };

export function ShopPage() {
  const { business = '' } = useParams();
  const base = `/shop/${encodeURIComponent(business)}`;
  const queryClient = useQueryClient();
  const [cart, setCart] = useState<Record<number, CartLine>>({});
  const [branchId, setBranchId] = useState<number | ''>('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
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
    onSuccess: async () => { setError(''); await queryClient.invalidateQueries({ queryKey: ['shop-account', business] }); },
    onError: (e) => setError(errorMessage(e)),
  });
  const logoutMutation = useMutation({ mutationFn: () => api(`${base}/logout`, { method: 'POST' }), onSuccess: async () => { setCart({}); await queryClient.invalidateQueries({ queryKey: ['shop-account', business] }); } });
  const placeOrder = useMutation({
    mutationFn: () => api(`${base}/orders`, { method: 'POST', body: {
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

  if (catalog.isPending) return <div className="grid min-h-screen place-items-center text-slate-500">Loading shop…</div>;
  if (catalog.isError) return <div className="mx-auto mt-20 max-w-lg rounded-2xl bg-white p-8 text-center shadow"><h1 className="text-xl font-bold">Shop unavailable</h1><p className="mt-2 text-slate-600">{errorMessage(catalog.error)}</p><Link className="mt-5 inline-block text-brand-700 underline" to="/login">Staff sign in</Link></div>;

  const shop = catalog.data;
  const setQuantity = (product: ShopProduct, quantity: number) => setCart((old) => {
    const next = { ...old };
    if (quantity <= 0) delete next[product.id]; else next[product.id] = { product, quantity };
    return next;
  });

  return <div className="min-h-screen bg-[#f8f7f3] text-slate-900">
    <header className="border-b border-emerald-950/10 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3"><img src="/brand/minimart-logo.svg" className="size-11 rounded-xl object-contain" alt=""/><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald-700">Online pickup</p><h1 className="font-display text-xl font-extrabold">{shop.business.name}</h1></div></div>
        <div className="flex items-center gap-3">{account.data ? <><span className="hidden text-sm text-slate-600 sm:block">Hi, {account.data.name}</span><button onClick={() => logoutMutation.mutate()} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-slate-50"><LogOut size={16}/> Sign out</button></> : <a href="#account" className="rounded-xl bg-emerald-800 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-900">Sign in</a>}<Link to="/login" className="hidden text-xs text-slate-400 hover:text-slate-700 sm:block">Staff</Link></div>
      </div>
    </header>
    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section>
        <div className="mb-7 rounded-3xl bg-emerald-900 px-6 py-8 text-white sm:px-9"><div className="flex items-center gap-2 text-sm font-semibold text-emerald-200"><Store size={17}/> Shop online, pick up in store</div><h2 className="mt-3 max-w-xl font-display text-3xl font-extrabold sm:text-4xl">Your neighborhood favorites, ready when you are.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-emerald-100">Choose a branch and add items to your pickup order. Pay when you collect your order at the store.</p></div>
        <div className="mb-4 flex items-end justify-between"><div><h2 className="font-display text-2xl font-extrabold">Shop products</h2><p className="mt-1 text-sm text-slate-500">Prices are confirmed at pickup.</p></div><span className="text-sm text-slate-500">{shop.data.length} items</span></div>
        {shop.data.length === 0 ? <div className="rounded-2xl border border-dashed p-10 text-center text-slate-500">No products are listed in this shop yet.</div> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{shop.data.map((product) => {
          const quantity = cart[product.id]?.quantity ?? 0;
          return <article key={product.id} className="flex min-h-52 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 grid size-11 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><ShoppingBag size={21}/></div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{product.category ?? product.unit}</p><h3 className="mt-1 font-bold">{product.name}</h3><p className="mt-1 line-clamp-2 flex-1 text-sm text-slate-500">{product.description || `Sold by ${product.unit}`}</p><div className="mt-4 flex items-center justify-between"><span className="font-display text-lg font-extrabold">{peso(product.price)}</span>{quantity ? <div className="flex items-center gap-3 rounded-xl bg-slate-100 p-1"><button onClick={() => setQuantity(product, quantity - 1)} className="grid size-8 place-items-center rounded-lg bg-white font-bold">−</button><span className="min-w-4 text-center text-sm font-bold">{quantity}</span><button onClick={() => setQuantity(product, quantity + 1)} className="grid size-8 place-items-center rounded-lg bg-white font-bold">+</button></div> : <button onClick={() => setQuantity(product, 1)} className="rounded-xl bg-emerald-800 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-900">Add</button>}</div></article>;
        })}</div>}
      </section>

      <aside className="space-y-5">
        {!account.data ? <section id="account" className="scroll-mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-display text-xl font-extrabold">Your account</h2><p className="mt-1 text-sm text-slate-500">Sign in or create an account to place and track pickup orders.</p><div className="mt-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1"><button onClick={() => {setMode('login');setError('');}} className={`rounded-lg py-2 text-sm font-bold ${mode === 'login' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>Sign in</button><button onClick={() => {setMode('register');setError('');}} className={`rounded-lg py-2 text-sm font-bold ${mode === 'register' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>Create account</button></div><form className="mt-4 space-y-3" onSubmit={submitAuth}>{mode === 'register' && <><input name="name" required maxLength={255} placeholder="Full name" className="w-full rounded-xl border px-3 py-2.5 text-sm"/><input name="phone" required maxLength={30} placeholder="Mobile number" className="w-full rounded-xl border px-3 py-2.5 text-sm"/> </>}<input name="email" type="email" required placeholder="Email address" className="w-full rounded-xl border px-3 py-2.5 text-sm"/><input name="password" type="password" required minLength={mode === 'register' ? 10 : 1} placeholder="Password" className="w-full rounded-xl border px-3 py-2.5 text-sm"/>{mode === 'register' && <input name="password_confirmation" type="password" required minLength={10} placeholder="Confirm password" className="w-full rounded-xl border px-3 py-2.5 text-sm"/>}<button disabled={authMutation.isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{authMutation.isPending ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}<ArrowRight size={16}/></button>{error && <p className="text-sm text-red-700">{error}</p>}</form></section> : <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="font-display text-xl font-extrabold">Pickup details</h2><PackageCheck className="text-emerald-700"/></div><label className="mt-4 block text-sm font-semibold">Pickup branch<select value={branchId} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')} className="mt-1.5 w-full rounded-xl border bg-white px-3 py-2.5 text-sm"><option value="">Choose a branch</option>{shop.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>{cartLines(cart).map(({ product, quantity }) => <div className="mt-3 flex items-center justify-between gap-3 text-sm" key={product.id}><span className="min-w-0 truncate">{quantity} × {product.name}</span><span className="font-semibold">{peso(Number(product.price) * quantity)}</span></div>)}<div className="mt-4 flex justify-between border-t pt-4 font-bold"><span>Estimated total</span><span>{peso(total)}</span></div><p className="mt-2 text-xs leading-5 text-slate-500">You’ll pay at the branch when you pick up your order.</p><button disabled={!Object.keys(cart).length || !branchId || placeOrder.isPending} onClick={() => {setError('');placeOrder.mutate();}} className="mt-4 w-full rounded-xl bg-emerald-800 px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{placeOrder.isPending ? 'Placing order…' : 'Place pickup order'}</button>{error && <p className="mt-2 text-sm text-red-700">{error}</p>}</section>}
        {account.data && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-display text-xl font-extrabold">Your orders</h2>{orders.isPending ? <p className="mt-4 text-sm text-slate-500">Loading orders…</p> : orders.data?.data.length ? <div className="mt-3 divide-y">{orders.data.data.map((order) => <div key={order.id} className="py-4 first:pt-2"><div className="flex items-start justify-between gap-2"><div><p className="font-bold">{order.order_number}</p><p className="mt-1 text-xs text-slate-500">{order.branch.name} · {new Date(order.placed_at).toLocaleString()}</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">{statusNames[order.status] ?? order.status}</span></div><p className="mt-2 text-sm text-slate-600">{order.items.map((item) => `${item.quantity} ${item.unit} ${item.name}`).join(', ')}</p><div className="mt-2 flex items-center justify-between"><span className="text-sm font-bold">{peso(order.estimated_total)}</span>{['pending', 'confirmed'].includes(order.status) && <button onClick={() => cancelOrder.mutate(order.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-red-700"><X size={14}/> Cancel</button>}</div></div>)}</div> : <p className="mt-3 text-sm text-slate-500">No orders yet. Add products to get started.</p>}</section>}
      </aside>
    </main>
    <footer className="border-t bg-white px-4 py-5 text-center text-xs text-slate-500">Online pickup · Powered by SmartPOS</footer>
  </div>;
}

function cartLines(cart: Record<number, CartLine>): CartLine[] { return Object.values(cart); }
