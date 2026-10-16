import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Loader2, PackagePlus, Plus, Search, X } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatMoney, formatQty } from '../lib/format';
import { useDebounced, useTenantQuery } from '../lib/hooks';
import type { Category, Paginated, Product } from '../lib/types';
import { useTenant } from '../tenant/TenantProvider';
import { Button, ErrorBanner, Field, Input, Select, cx } from './ui';

const TILES = ['from-brand-400 to-brand-600', 'from-sky-400 to-sky-600', 'from-amber-400 to-orange-500', 'from-violet-400 to-violet-600', 'from-rose-400 to-rose-600', 'from-teal-400 to-emerald-600'];
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');

/** SKU suggestion from the name, e.g. "Bear Brand 320g" → "BEAR-BRAND-320G-4821". */
const skuFrom = (name: string) =>
  `${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'ITEM'}-${Math.floor(1000 + Math.random() * 9000)}`;

/**
 * Drop-down product picker for order and stock forms: browse by category without typing, search optionally, and
 * create a product on the spot when it is not in the catalog yet.
 */
export function ProductBrowser({ onPick, picked, branchId }: { onPick: (p: Product) => void; picked: Record<number, string>; branchId?: number }) {
  const { can } = useTenant();
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim());
  const [creating, setCreating] = useState(false);
  const categories = useTenantQuery<{ data: Category[] }>('/categories');
  const products = useTenantQuery<Paginated<Product>>('/products', { category_id: categoryId ?? undefined, q: q || undefined, with_stock: 1, per_page: 100 }, { enabled: open });
  const rows = products.data?.data ?? [];
  const activeCategories = (categories.data?.data ?? []).filter((c) => c.is_active);
  const pickedCount = Object.keys(picked).length;

  return (
    <div className={cx('overflow-hidden rounded-xl bg-white ring-1 transition', open ? 'ring-2 ring-brand-500 shadow-lg shadow-slate-900/5' : 'ring-slate-200')}>
      {/* The "dropdown" field */}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex h-12 w-full items-center gap-3 px-4 text-left transition hover:bg-slate-50">
        <PackagePlus className="size-5 shrink-0 text-brand-600" />
        <span className="flex-1 text-sm font-medium text-slate-700">{open ? 'Tap products to add them' : 'Choose products to add…'}</span>
        {pickedCount > 0 && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-bold text-white">{pickedCount} added</span>}
        <ChevronDown className={cx('size-5 text-slate-400 transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="auth-fade border-t border-slate-100">
          <div className="flex flex-wrap gap-2 bg-slate-50/70 p-3">
            <select value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)} aria-label="Category"
              className="h-9 cursor-pointer rounded-lg bg-white px-3 text-sm font-medium text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-brand-500">
              <option value="">All categories</option>
              {activeCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className="flex h-9 min-w-40 flex-1 items-center gap-2 rounded-lg bg-white px-3 ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-brand-500">
              <Search className="size-4 text-slate-400" />
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Filter (optional)" aria-label="Filter products" className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none" />
              {products.isFetching && <Loader2 className="size-4 animate-spin text-slate-400" />}
              {term && <button type="button" onClick={() => setTerm('')} aria-label="Clear"><X className="size-4 text-slate-400" /></button>}
            </label>
          </div>

          {creating ? (
            <QuickProduct
              defaultName={term}
              defaultCategory={categoryId}
              categories={activeCategories}
              onCancel={() => setCreating(false)}
              onCreated={(p) => { setCreating(false); setTerm(''); onPick(p); }}
            />
          ) : (
            <ul role="listbox" aria-label="Products" className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
              {can('products.manage') && (
                <li>
                  <button type="button" onClick={() => setCreating(true)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-brand-700 transition hover:bg-brand-50">
                    <span className="grid size-8 place-items-center rounded-lg border border-dashed border-brand-300"><Plus className="size-4" /></span>
                    New product (not in the list yet)
                  </button>
                </li>
              )}
              {products.isPending && Array.from({ length: 5 }, (_, i) => <li key={i} className="px-4 py-2.5"><span className="block h-8 animate-pulse rounded-lg bg-slate-100" /></li>)}
              {rows.map((p) => {
                const qty = picked[p.id];
                const stock = branchId ? p.stock?.find((s) => s.branch_id === branchId)?.quantity : undefined;
                const low = p.track_inventory && Number(stock ?? 0) <= Number(p.reorder_level);
                return (
                  <li key={p.id}>
                    <button type="button" role="option" aria-selected={!!qty} onClick={() => onPick(p)}
                      className={cx('group flex w-full items-center gap-3 px-4 py-2 text-left transition', qty ? 'bg-brand-50/70' : 'hover:bg-slate-50')}>
                      <span className={cx('grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-[10px] font-bold text-white', TILES[p.id % TILES.length])}>{initials(p.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{p.name}</span>
                        <span className="block text-[11px] text-slate-400">{p.cost_price ? `cost ${formatMoney(p.cost_price)}` : `price ${formatMoney(p.price)}`}{stock !== undefined && <> · <span className={cx(low && 'font-semibold text-amber-700')}>{formatQty(stock)} {p.unit} left</span></>}</span>
                      </span>
                      {qty ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-bold text-white"><Check className="size-3" />{qty}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 transition group-hover:bg-brand-600 group-hover:text-white"><Plus className="size-3" />Add</span>
                      )}
                    </button>
                  </li>
                );
              })}
              {!products.isPending && rows.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-slate-500">
                  No products {q ? `match “${q}”` : 'in this category'}.{can('products.manage') && <> <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => setCreating(true)}>Create it</button></>}
                </li>
              )}
            </ul>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-4 py-2">
            <span className="text-[11px] text-slate-500">Tap a product to add it; tap again for one more.</span>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg bg-brand-700 px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand-800">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function QuickProduct({ defaultName, defaultCategory, categories, onCancel, onCreated }: { defaultName: string; defaultCategory: number | null; categories: Category[]; onCancel: () => void; onCreated: (p: Product) => void }) {
  const { path, tenantId } = useTenant();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: defaultName, category_id: defaultCategory ? String(defaultCategory) : '', unit: 'pc', price: '', cost_price: '', reorder_level: '10' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const err = (f: string) => (error instanceof ApiError ? error.field(f) : undefined);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ data: Product }>(path('/products'), {
        method: 'POST',
        body: {
          name: form.name.trim(),
          sku: skuFrom(form.name),
          category_id: form.category_id ? Number(form.category_id) : null,
          unit: form.unit || 'pc',
          price: form.price,
          ...(form.cost_price ? { cost_price: form.cost_price } : {}),
          reorder_level: form.reorder_level || '0',
          track_inventory: true,
        },
      });
      void queryClient.invalidateQueries({ queryKey: ['t', tenantId] });
      onCreated(r.data);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); if (form.name.trim() && form.price) void save(); }}>
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800"><PackagePlus className="size-4 text-brand-600" />New product</p>
      {error instanceof ApiError && !err('name') && !err('price') && <ErrorBanner error={error} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Product name" error={err('name') ?? err('sku')} className="sm:col-span-2">{(id) => <Input id={id} autoFocus placeholder="e.g. Bear Brand Milk 320g" value={form.name} onChange={(e) => set('name')(e.target.value)} />}</Field>
        <Field label="Category">{(id) => <Select id={id} value={form.category_id} onChange={(e) => set('category_id')(e.target.value)}><option value="">No category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Unit">{(id) => <Select id={id} value={form.unit} onChange={(e) => set('unit')(e.target.value)}>{['pc', 'pack', 'box', 'bottle', 'can', 'kg', 'g', 'L', 'ml', 'sack', 'dozen'].map((u) => <option key={u} value={u}>{u}</option>)}</Select>}</Field>
        <Field label="Selling price (₱)" error={err('price')}>{(id) => <Input id={id} inputMode="decimal" placeholder="0.00" value={form.price} onChange={(e) => set('price')(e.target.value.replace(/[^\d.]/g, ''))} />}</Field>
        <Field label="Cost from supplier (₱)" error={err('cost_price')}>{(id) => <Input id={id} inputMode="decimal" placeholder="0.00" value={form.cost_price} onChange={(e) => set('cost_price')(e.target.value.replace(/[^\d.]/g, ''))} />}</Field>
      </div>
      <p className="text-[11px] text-slate-500">An SKU is generated for you. You can add a barcode and change details later in Products.</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Back to list</Button>
        <Button type="submit" size="sm" loading={busy} disabled={!form.name.trim() || !form.price} icon={<Plus className="size-4" />}>Create &amp; add</Button>
      </div>
    </form>
  );
}
