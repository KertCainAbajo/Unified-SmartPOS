import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Barcode,
  Download,
  ImagePlus,
  Layers,
  Package,
  PackageX,
  Pencil,
  Plus,
  Search,
  Tag,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Checkbox, DataTable, ErrorBanner, Field, Input, Modal, Pagination, Select, cx } from '../../components/ui';
import { ApiError, api, errorMessage } from '../../lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../components/Toast';
import { formatDateTime, formatMoney, formatQty, todayManila } from '../../lib/format';
import { useDebounced, useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Category, Paginated, Product, TaxType } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

const TAX: Record<TaxType, { label: string; className: string }> = {
  vatable: { label: 'VATable', className: 'bg-slate-100 text-slate-600 ring-slate-500/15' },
  vat_exempt: { label: 'VAT-exempt', className: 'bg-sky-50 text-sky-700 ring-sky-600/20' },
  zero_rated: { label: 'Zero-rated', className: 'bg-violet-50 text-violet-700 ring-violet-600/20' },
};

/** A stable tile colour per category, so products of one category look alike. */
const TILES = [
  'bg-brand-50 text-brand-600 ring-brand-100',
  'bg-sun-300/25 text-amber-700 ring-amber-200',
  'bg-sky-50 text-sky-600 ring-sky-100',
  'bg-violet-50 text-violet-600 ring-violet-100',
  'bg-rose-50 text-rose-600 ring-rose-100',
  'bg-emerald-50 text-emerald-600 ring-emerald-100',
];
const tileFor = (categoryId: number | null) => (categoryId === null ? 'bg-slate-100 text-slate-500 ring-slate-200' : TILES[categoryId % TILES.length]);

/** Margin on the selling price, or null when there is no usable cost. */
const marginOf = (price: string | number | undefined, cost: string | number | undefined | null) => {
  const p = Number(price);
  const c = Number(cost);
  if (!cost || !Number.isFinite(p) || !Number.isFinite(c) || p <= 0) return null;
  return ((p - c) / p) * 100;
};

type StockLevel = { qty: number; level: 'out' | 'low' | 'ok' | 'untracked'; perBranch?: { branch_id: number; qty: number }[] };

/** Stock at one branch, or (branchId undefined) the total across branches; low if any branch is low. */
function stockOf(product: Product, branchId: number | undefined, branchIds?: number[]): StockLevel {
  if (!product.track_inventory) return { qty: 0, level: 'untracked' };
  const reorder = Number(product.reorder_level);
  if (branchId === undefined) {
    const perBranch = (branchIds ?? []).map((id) => ({ branch_id: id, qty: Number(product.stock?.find((s) => s.branch_id === id)?.quantity ?? 0) }));
    const qty = perBranch.reduce((s, b) => s + b.qty, 0);
    const anyLow = perBranch.some((b) => b.qty <= reorder);
    return { qty, perBranch, level: qty <= 0 ? 'out' : anyLow ? 'low' : 'ok' };
  }
  const qty = Number(product.stock?.find((s) => s.branch_id === branchId)?.quantity ?? 0);
  return { qty, level: qty <= 0 ? 'out' : qty <= reorder ? 'low' : 'ok' };
}

/** Downloads the listed products as a CSV file. */
function exportCsv(rows: Product[], branchId: number | undefined, branchIds: number[], withCost: boolean) {
  const header = ['Name', 'SKU', 'Barcode', 'Category', 'Tax', 'Price', ...(withCost ? ['Cost'] : []), 'Stock', 'Unit', 'Reorder level', 'Status'];
  const lines = rows.map((p) => {
    const stock = stockOf(p, branchId, branchIds);
    return [
      p.name, p.sku, p.barcode ?? '', p.category?.name ?? '', TAX[p.tax_type]?.label ?? p.tax_type, p.price,
      ...(withCost ? [p.cost_price ?? ''] : []),
      stock.level === 'untracked' ? 'n/a' : String(stock.qty), p.unit, formatQty(p.reorder_level), p.status,
    ];
  });
  const csv = [header, ...lines].map((cols) => cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `products-${todayManila()}.csv` });
  link.click();
  URL.revokeObjectURL(url);
}

export function ProductsPage() {
  const { can, branch, branches, viewAll, scopeBranchId } = useTenant();
  const branchIds = branches.map((b) => b.id);
  const scopeName = viewAll ? `all ${branches.length} branches` : branch?.name ?? 'the selected branch';
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('active');
  const [categoryId, setCategoryId] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [pricing, setPricing] = useState<Product | null>(null);
  const q = useDebounced(term);
  const list = useTenantQuery<Paginated<Product>>('/products', { q: q || undefined, status, category_id: categoryId, page, with_stock: 1 });
  const categories = useTenantQuery<{ data: Category[] }>('/categories');
  const archive = useTenantMutation<Product>('POST', (p) => `/products/${p.id}/${p.status === 'active' ? 'archive' : 'restore'}`, {
    success: 'Product updated.',
  });

  if (!can('products.view')) return <NoAccess what="products" />;
  const canManage = can('products.manage');
  const canPrice = can('products.price');

  const rows = list.data?.data ?? [];
  const total = list.data?.meta?.total ?? list.data?.total ?? rows.length;
  const partial = total > rows.length;
  const levels = rows.map((p) => stockOf(p, scopeBranchId, branchIds).level);
  const low = levels.filter((l) => l === 'low').length;
  const out = levels.filter((l) => l === 'out').length;
  const filtered = term.trim() !== '' || categoryId !== '' || status !== 'active';
  const pageNote = partial ? 'On this page' : `Across ${scopeName}`;
  const resetFilters = () => { setTerm(''); setCategoryId(''); setStatus('active'); setPage(1); };

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">Stock</p>
          <h1 className="mt-1 font-display text-[1.75rem] font-bold leading-tight tracking-tight text-brand-900">Products</h1>
          <p className="mt-1 text-sm text-slate-500">One catalog for every branch. Stock levels are for <span className="font-medium text-slate-700">{scopeName}</span>.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={() => exportCsv(rows, scopeBranchId, branchIds, canPrice)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-800 shadow-sm ring-1 ring-slate-900/5 transition hover:bg-brand-50 hover:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="size-4" /> Export CSV
          </button>
          {canManage && <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add product</Button>}
        </div>
      </header>

      {/* Summary */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat Icon={Package} label="Products" value={list.data ? String(total) : null} note={filtered ? 'Matching your filters' : 'Active in the catalog'} tint="brand" />
        <Stat Icon={AlertTriangle} label="Low stock" value={list.data ? String(low) : null} note={low ? `At or below reorder level · ${pageNote.toLowerCase()}` : pageNote} tint={low ? 'amber' : 'slate'} />
        <Stat Icon={PackageX} label="Out of stock" value={list.data ? String(out) : null} note={out ? 'Restock soon' : pageNote} tint={out ? 'rose' : 'slate'} />
        <Stat Icon={Layers} label="Categories" value={categories.data ? String(categories.data.data.length) : null} note="Used to group products" tint="sun" />
      </section>

      {/* Catalog */}
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <label className="group relative flex h-10 flex-1 items-center rounded-xl bg-slate-50 ring-1 ring-slate-200 transition focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-500 lg:max-w-md">
            <Search className="pointer-events-none ml-3 size-4 text-slate-400 transition group-focus-within:text-brand-600" />
            <input
              className="h-full w-full bg-transparent pl-2.5 pr-8 text-sm outline-none placeholder:text-slate-400"
              placeholder="Search name, SKU or scan a barcode"
              value={term}
              onChange={(e) => { setTerm(e.target.value); setPage(1); }}
              aria-label="Search products"
            />
            {term ? (
              <button type="button" aria-label="Clear search" onClick={() => { setTerm(''); setPage(1); }} className="absolute right-2 grid size-6 place-items-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                <X className="size-3.5" />
              </button>
            ) : (
              <Barcode className="pointer-events-none absolute right-3 size-4 text-slate-300" />
            )}
          </label>

          <select
            className="h-10 cursor-pointer rounded-xl bg-slate-50 px-3 text-sm font-medium text-slate-700 outline-none ring-1 ring-slate-200 transition hover:bg-white focus:bg-white focus:ring-2 focus:ring-brand-500 lg:w-56"
            value={categoryId}
            onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}
            aria-label="Category"
          >
            <option value="">All categories</option>
            {categories.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <div role="radiogroup" aria-label="Status" className="inline-flex h-10 items-center gap-0.5 rounded-xl bg-slate-100 p-1 text-xs font-medium lg:ml-auto">
            {[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All' }].map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={status === o.value} onClick={() => { setStatus(o.value); setPage(1); }}
                className={cx('h-full rounded-lg px-3.5 transition', status === o.value ? 'bg-white text-brand-800 shadow-sm ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-800')}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {list.error ? (
          <ErrorBanner error={list.error} className="m-4" />
        ) : list.isPending ? (
          <LoadingRows />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span className="relative grid size-16 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
              {filtered ? <Search className="size-7" /> : <Package className="size-7" />}
              <span aria-hidden className="absolute -right-1.5 -top-1.5 size-4 rounded-full bg-sun-400 ring-4 ring-white" />
            </span>
            <p className="mt-5 font-display text-base font-semibold text-slate-900">{filtered ? 'No products match' : 'No products yet'}</p>
            <p className="mt-1 max-w-md text-sm text-slate-500">{filtered ? 'Try another name, SKU, category or status.' : 'Add the items you sell so cashiers can scan them and stock can be tracked.'}</p>
            <div className="mt-5">
              {filtered ? (
                <button type="button" onClick={resetFilters} className="text-sm font-semibold text-brand-700 hover:underline">Clear filters</button>
              ) : canManage ? (
                <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add your first product</Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="sp-cards w-full text-sm">
              <thead className="bg-slate-50/70">
                <tr className="text-[11px] uppercase tracking-wider text-slate-400">
                  <th scope="col" className="py-3 pl-5 pr-3 text-left font-semibold">Product</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Category</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Tax</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Price</th>
                  {canPrice && <th scope="col" className="px-3 py-3 text-right font-semibold">Cost · Margin</th>}
                  <th scope="col" className="px-3 py-3 text-left font-semibold">{viewAll ? 'Stock (all branches)' : `Stock (${branch?.code ?? '—'})`}</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Status</th>
                  <th scope="col" className="pr-5 text-right font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => {
                  const stock = stockOf(p, scopeBranchId, branchIds);
                  const margin = marginOf(p.price, p.cost_price);
                  const archived = p.status !== 'active';
                  const tax = TAX[p.tax_type];
                  return (
                    <tr key={p.id} className={cx('group transition-colors hover:bg-brand-50/40', archived && 'opacity-60')}>
                      <td className="py-3.5 pl-5 pr-3">
                        <span className="flex items-center gap-3">
                          {p.image_url ? (
                            <img src={p.image_url} alt="" loading="lazy" className="size-10 shrink-0 rounded-xl bg-white object-cover ring-1 ring-slate-200" />
                          ) : (
                            <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl font-display text-sm font-bold ring-1', tileFor(p.category_id))}>
                              {p.name.charAt(0).toUpperCase()}
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-slate-900">{p.name}</span>
                            <span className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-slate-600">{p.sku}</span>
                              {p.barcode && (
                                <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-slate-400"><Barcode className="size-3" />{p.barcode}</span>
                              )}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        {p.category ? <span className="text-slate-700">{p.category.name}</span> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-3.5">
                        <span className={cx('whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', tax?.className)}>{tax?.label ?? p.tax_type}</span>
                      </td>
                      <td className="px-3 py-3.5 text-right">
                        <span className="font-display font-semibold tabular-nums text-slate-900">{formatMoney(p.price)}</span>
                        <span className="block text-[11px] text-slate-400">per {p.unit}</span>
                      </td>
                      {canPrice && (
                        <td className="px-3 py-3.5 text-right">
                          <span className="tabular-nums text-slate-600">{p.cost_price ? formatMoney(p.cost_price) : '—'}</span>
                          {margin !== null && (
                            <span className={cx('block text-[11px] font-semibold tabular-nums', margin < 10 ? 'text-rose-600' : margin < 20 ? 'text-amber-600' : 'text-emerald-600')}>
                              {margin.toFixed(1)}% margin
                            </span>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-3.5">
                        <StockCell product={p} stock={stock} />
                      </td>
                      <td className="px-3 py-3.5">
                        <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
                          archived ? 'bg-slate-100 text-slate-500 ring-slate-500/15' : 'bg-emerald-50 text-emerald-700 ring-emerald-600/15')}>
                          <span className={cx('size-1.5 rounded-full', archived ? 'bg-slate-400' : 'bg-emerald-500')} />
                          {archived ? 'Archived' : 'Active'}
                        </span>
                      </td>
                      <td className="py-3.5 pl-3 pr-5">
                        <div className="flex justify-end gap-1 opacity-70 transition group-hover:opacity-100">
                          {canManage && <IconAction Icon={Pencil} label={`Edit ${p.name}`} onClick={() => setEditing(p)} />}
                          {canPrice && <IconAction Icon={Tag} label={`Change price of ${p.name}`} onClick={() => setPricing(p)} />}
                          {canManage && (
                            <IconAction
                              Icon={archived ? ArchiveRestore : Archive}
                              label={archived ? `Restore ${p.name}` : `Archive ${p.name}`}
                              tone={archived ? 'brand' : 'danger'}
                              onClick={() => archive.mutate(p)}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} data={list.data} onPage={setPage} />
      </section>

      <ProductForm product={editing} categories={categories.data?.data ?? []} onClose={() => setEditing(null)} />
      <PriceModal product={pricing} onClose={() => setPricing(null)} />
    </div>
  );
}

/* --------------------------------------------------------------------------- Pieces */

const TINTS = {
  brand: 'bg-brand-50 text-brand-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  slate: 'bg-slate-100 text-slate-500',
  sun: 'bg-sun-300/30 text-amber-700',
};

function Stat({ Icon, label, value, note, tint }: { Icon: LucideIcon; label: string; value: string | null; note: string; tint: keyof typeof TINTS }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5 transition hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <span className={cx('grid size-9 place-items-center rounded-xl', TINTS[tint])}><Icon className="size-4" /></span>
      </div>
      {value === null ? (
        <span className="mt-3 block h-8 w-16 animate-pulse rounded-lg bg-slate-100" />
      ) : (
        <p className="mt-2 font-display text-[1.65rem] font-bold leading-tight tabular-nums text-slate-900">{value}</p>
      )}
      <p className="mt-1 truncate text-xs text-slate-400">{note}</p>
    </div>
  );
}

/** Quantity with a small bar against twice the reorder level, and a Low / Out badge. */
function StockCell({ product, stock }: { product: Product; stock: StockLevel }) {
  const { branches, branchName } = useTenant();
  const branchCode = (id: number) => branches.find((b) => b.id === id)?.code ?? branchName(id);
  if (stock.level === 'untracked') return <span className="text-xs text-slate-400">Not tracked</span>;
  const reorder = Number(product.reorder_level);
  const scale = Math.max(reorder * 2, stock.qty, 1);
  const fill = Math.max(0, Math.min(100, (stock.qty / scale) * 100));
  const color = stock.level === 'out' ? 'bg-rose-500' : stock.level === 'low' ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="min-w-[8.5rem]">
      <div className="flex items-center gap-2">
        <span className={cx('font-semibold tabular-nums', stock.level === 'out' ? 'text-rose-600' : stock.level === 'low' ? 'text-amber-700' : 'text-slate-800')}>
          {formatQty(String(stock.qty))} <span className="font-normal text-slate-400">{product.unit}</span>
        </span>
        {stock.level !== 'ok' && (
          <span className={cx('rounded-full px-1.5 py-px text-[10px] font-bold uppercase tracking-wide', stock.level === 'out' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-700')}>
            {stock.level === 'out' ? 'Out' : 'Low'}
          </span>
        )}
      </div>
      {stock.perBranch ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {stock.perBranch.map((b) => (
            <span key={b.branch_id} title={branchName(b.branch_id)} className={cx('rounded px-1.5 py-px text-[10px] font-medium tabular-nums ring-1 ring-inset', b.qty <= 0 ? 'bg-rose-50 text-rose-600 ring-rose-200' : b.qty <= reorder ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-slate-50 text-slate-600 ring-slate-200')}>
              {branchCode(b.branch_id)} {formatQty(String(b.qty))}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-1.5 h-1 w-28 overflow-hidden rounded-full bg-slate-100" title={`Reorder level ${formatQty(product.reorder_level)} ${product.unit}`}>
          <div className={cx('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${fill}%` }} />
        </div>
      )}
    </div>
  );
}

function IconAction({ Icon, label, onClick, tone = 'default' }: { Icon: LucideIcon; label: string; onClick: () => void; tone?: 'default' | 'brand' | 'danger' }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cx(
        'grid size-8 place-items-center rounded-lg text-slate-500 ring-1 ring-transparent transition hover:bg-white hover:shadow-sm hover:ring-slate-200',
        tone === 'danger' ? 'hover:text-rose-600' : tone === 'brand' ? 'hover:text-brand-700' : 'hover:text-brand-700',
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

/** Placeholder rows shown while products load. */
function LoadingRows() {
  return (
    <div className="divide-y divide-slate-100" role="status" aria-label="Loading products">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <span className="size-10 animate-pulse rounded-xl bg-slate-100" />
          <span className="space-y-2">
            <span className="block h-3 w-44 animate-pulse rounded bg-slate-100" />
            <span className="block h-2.5 w-28 animate-pulse rounded bg-slate-100" />
          </span>
          <span className="ml-auto hidden h-3 w-24 animate-pulse rounded bg-slate-100 sm:block" />
          <span className="h-3 w-16 animate-pulse rounded bg-slate-100" />
          <span className="h-5 w-16 animate-pulse rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function FormSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="mb-5 last:mb-0">
      <legend className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">{title}</legend>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

const blank = { sku: '', barcode: '', name: '', description: '', category_id: '', unit: 'pc', price: '', cost_price: '', tax_type: 'vatable' as TaxType, track_inventory: true, allow_decimal_quantity: false, reorder_level: '0' };

function ProductForm({ product, categories, onClose }: { product: Product | 'new' | null; categories: Category[]; onClose: () => void }) {
  const isNew = product === 'new';
  const [form, setForm] = useState(blank);
  useEffect(() => {
    if (product && product !== 'new') {
      setForm({
        sku: product.sku, barcode: product.barcode ?? '', name: product.name, description: product.description ?? '', category_id: product.category_id ? String(product.category_id) : '',
        unit: product.unit, price: product.price, cost_price: product.cost_price ?? '', tax_type: product.tax_type, track_inventory: product.track_inventory,
        allow_decimal_quantity: product.allow_decimal_quantity, reorder_level: formatQty(product.reorder_level),
      });
    } else if (isNew) setForm(blank);
  }, [product, isNew]);

  const [photo, setPhoto] = useState<File | null>(null);
  useEffect(() => setPhoto(null), [product]);
  const { path, tenantId } = useTenant();
  const queryClient = useQueryClient();
  const toast = useToast();
  // A photo picked while adding goes up right after the product exists; the product is kept even if the photo fails.
  const uploadPhoto = (id: number, file: File) => {
    const body = new FormData();
    body.append('image', file);
    api(path(`/products/${id}/image`), { method: 'POST', body })
      .then(() => { toast.success('Photo saved.'); void queryClient.invalidateQueries({ queryKey: ['t', tenantId] }); })
      .catch((e) => toast.error(`Product saved, but the photo was not: ${errorMessage(e)} Edit the product to try again.`));
  };
  const save = useTenantMutation<Record<string, unknown>, { data: Product }>(isNew ? 'POST' : 'PATCH', isNew ? '/products' : `/products/${(product as Product | null)?.id}`, {
    success: isNew ? 'Product created.' : 'Product updated.',
    onSuccess: (r) => { if (isNew && photo && r?.data?.id) uploadPhoto(r.data.id, photo); onClose(); },
    toastErrors: false,
  });
  const err = (f: string) => (save.error instanceof ApiError ? save.error.field(f) : undefined);
  const set = (k: keyof typeof form) => (v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const margin = isNew ? marginOf(form.price, form.cost_price) : null;

  function submit() {
    const body: Record<string, unknown> = {
      sku: form.sku, barcode: form.barcode || null, name: form.name, description: form.description || null,
      category_id: form.category_id ? Number(form.category_id) : null, unit: form.unit, tax_type: form.tax_type,
      track_inventory: form.track_inventory, allow_decimal_quantity: form.allow_decimal_quantity, reorder_level: form.reorder_level || '0',
    };
    if (isNew) {
      body.price = form.price;
      if (form.cost_price) body.cost_price = form.cost_price;
    }
    save.mutate(body);
  }

  return (
    <Modal
      open={product !== null}
      onClose={onClose}
      title={isNew ? 'Add product' : 'Edit product'}
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!form.name.trim() || !form.sku.trim()} onClick={submit}>{isNew ? 'Add product' : 'Save changes'}</Button></>}
    >
      {save.error instanceof ApiError && Object.keys(save.error.errors).length === 0 && <ErrorBanner error={save.error} className="mb-4" />}

      <FormSection title="Photo" hint="Shown in the online shop and in this list. A plain background is removed and the product is centred on white automatically.">
        {isNew ? <NewProductPhoto file={photo} onChange={setPhoto} /> : product && <ProductPhoto product={product} />}
      </FormSection>

      <FormSection title="Basics">
        <Field label="Name" error={err('name')} className="sm:col-span-2">{(id) => <Input id={id} value={form.name} autoFocus placeholder="e.g. Coca-Cola 1L" onChange={(e) => set('name')(e.target.value)} />}</Field>
        <Field label="SKU" error={err('sku')} hint="Letters, digits, - _ . / (stored in upper case)">{(id) => <Input id={id} value={form.sku} placeholder="BEV-COKE-1L" onChange={(e) => set('sku')(e.target.value)} />}</Field>
        <Field label="Barcode" error={err('barcode')} hint="EAN/UPC check digit is verified">{(id) => <Input id={id} value={form.barcode} placeholder="Scan or type" onChange={(e) => set('barcode')(e.target.value)} />}</Field>
        <Field label="Category" error={err('category_id')}>
          {(id) => <Select id={id} value={form.category_id} onChange={(e) => set('category_id')(e.target.value)}><option value="">None</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
        </Field>
        <Field label="Unit" error={err('unit')} hint="e.g. pc, kg, pack">{(id) => <Input id={id} value={form.unit} onChange={(e) => set('unit')(e.target.value)} />}</Field>
      </FormSection>

      <FormSection title="Pricing & tax">
        {isNew ? (
          <>
            <Field label="Selling price (₱)" error={err('price')} hint="VAT-inclusive for VAT-registered businesses">{(id) => <Input id={id} inputMode="decimal" value={form.price} placeholder="0.00" onChange={(e) => set('price')(e.target.value)} />}</Field>
            <Field label="Cost (₱)" error={err('cost_price')} hint={margin !== null ? `${margin.toFixed(1)}% margin at this price` : 'Optional, used for margins'}>{(id) => <Input id={id} inputMode="decimal" value={form.cost_price} placeholder="0.00" onChange={(e) => set('cost_price')(e.target.value)} />}</Field>
          </>
        ) : (
          <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200 sm:col-span-2">
            Current price <span className="font-semibold text-slate-900">{formatMoney((product as Product | null)?.price)}</span>. Use the <Tag className="inline size-3.5" /> Price action to change it, so the change is recorded in price history.
          </p>
        )}
        <Field label="Tax type" error={err('tax_type')}>
          {(id) => <Select id={id} value={form.tax_type} onChange={(e) => set('tax_type')(e.target.value)}><option value="vatable">VATable</option><option value="vat_exempt">VAT-exempt</option><option value="zero_rated">Zero-rated</option></Select>}
        </Field>
      </FormSection>

      <FormSection title="Stock">
        <Field label="Reorder level" error={err('reorder_level')} hint="Flagged as low stock at or below this">{(id) => <Input id={id} inputMode="decimal" value={form.reorder_level} onChange={(e) => set('reorder_level')(e.target.value)} />}</Field>
        <div className="flex flex-col justify-center gap-2.5 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
          <Checkbox label="Track stock for this product" checked={form.track_inventory} onChange={set('track_inventory')} />
          <Checkbox label="Sold by weight or length (decimals)" checked={form.allow_decimal_quantity} onChange={set('allow_decimal_quantity')} />
        </div>
      </FormSection>
    </Modal>
  );
}

/** Photo picked while adding a product: previewed here, uploaded (and formatted by the server) once the product is saved. */
function NewProductPhoto({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { setError('Choose a JPG, PNG or WebP image.'); return; }
    if (f.size > 5 * 1024 * 1024) { setError('The photo is larger than 5 MB.'); return; }
    setError(null);
    onChange(f);
  };

  return (
    <div className="flex flex-col gap-4 sm:col-span-2 sm:flex-row sm:items-center">
      <div className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        {preview ? <img src={preview} alt="New product" className="size-full object-contain p-2" /> : <ImagePlus className="size-8 text-slate-300" />}
      </div>
      <div className="min-w-0 flex-1">
        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]); }}
          className={cx('flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-5 text-center transition', dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50')}
        >
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          <span className="text-sm font-semibold text-slate-800">{file ? 'Choose another photo' : 'Add a photo'}</span>
          <span className="mt-0.5 text-xs text-slate-500">Click or drop a JPG, PNG or WebP (up to 5 MB). Saved with the product.</span>
        </label>
        <div className="mt-2 flex items-center justify-between gap-3">
          {error ? <p className="text-xs font-medium text-red-600">{error}</p> : <span className="truncate text-xs text-slate-500">{file?.name}</span>}
          {file && <button type="button" onClick={() => onChange(null)} className="text-xs font-semibold text-red-600 hover:underline">Remove photo</button>}
        </div>
      </div>
    </div>
  );
}

/** Upload, replace or remove a product photo. Saves immediately; the server formats it for the shop. */
function ProductPhoto({ product }: { product: Product }) {
  const [imageUrl, setImageUrl] = useState(product.image_url);
  const [dragging, setDragging] = useState(false);
  useEffect(() => setImageUrl(product.image_url), [product.image_url]);
  const upload = useTenantMutation<FormData, { data: Product }>('POST', `/products/${product.id}/image`, {
    success: 'Photo saved.', toastErrors: false, onSuccess: (r) => setImageUrl(r.data.image_url),
  });
  const remove = useTenantMutation<void, { data: Product }>('DELETE', `/products/${product.id}/image`, {
    success: 'Photo removed.', onSuccess: () => setImageUrl(null),
  });
  const send = (file: File | undefined) => {
    if (!file) return;
    const body = new FormData();
    body.append('image', file);
    upload.mutate(body);
  };
  const error = upload.error instanceof ApiError ? upload.error.field('image') ?? upload.error.message : undefined;

  return (
    <div className="flex flex-col gap-4 sm:col-span-2 sm:flex-row sm:items-center">
      <div className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-slate-200">
        {imageUrl ? <img src={imageUrl} alt={product.name} className="size-full bg-white object-contain" /> : <ImagePlus className="size-8 text-slate-300" />}
      </div>
      <div className="min-w-0 flex-1">
        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); send(e.dataTransfer.files[0]); }}
          className={cx('flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-5 text-center transition', dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50')}
        >
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={upload.isPending} onChange={(e) => { send(e.target.files?.[0]); e.target.value = ''; }} />
          <span className="text-sm font-semibold text-slate-800">{upload.isPending ? 'Uploading…' : imageUrl ? 'Replace photo' : 'Upload a photo'}</span>
          <span className="mt-0.5 text-xs text-slate-500">Click or drop a JPG, PNG or WebP (up to 5 MB)</span>
        </label>
        <div className="mt-2 flex items-center justify-between gap-3">
          {error ? <p className="text-xs font-medium text-red-600">{error}</p> : <span />}
          {imageUrl && <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending} className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50">Remove photo</button>}
        </div>
      </div>
    </div>
  );
}

function PriceModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('');
  const history = useTenantQuery<Paginated<{ id: number; old_price: string | null; new_price: string; old_cost: string | null; new_cost: string | null; reason: string | null; changed_by: { name: string } | null; created_at: string }>>(
    `/products/${product?.id}/price-history`, { per_page: 8 }, { enabled: !!product },
  );
  useEffect(() => {
    setPrice(product?.price ?? '');
    setCost(product?.cost_price ?? '');
    setReason('');
  }, [product]);
  const save = useTenantMutation<{ price: string; cost_price: string; reason: string }>('PATCH', `/products/${product?.id}/price`, { success: 'Price updated.', onSuccess: onClose, toastErrors: false });
  const margin = marginOf(price, cost);
  const change = product && Number(product.price) > 0 && Number.isFinite(Number(price)) ? ((Number(price) - Number(product.price)) / Number(product.price)) * 100 : 0;

  return (
    <Modal
      open={!!product}
      onClose={onClose}
      title={`Price — ${product?.name ?? ''}`}
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate({ price, cost_price: cost, reason })}>Save price</Button></>}
    >
      <ErrorBanner error={save.error} className="mb-4" />

      {/* Live summary of the new price */}
      <div className="mb-5 grid grid-cols-3 divide-x divide-brand-100 rounded-2xl bg-gradient-to-r from-brand-50 to-cream/60 ring-1 ring-brand-100">
        <Summary label="New price" value={formatMoney(price || '0')} />
        <Summary label="Change" value={change === 0 ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`} tone={change > 0 ? 'up' : change < 0 ? 'down' : undefined} />
        <Summary label="Margin" value={margin === null ? '—' : `${margin.toFixed(1)}%`} tone={margin === null ? undefined : margin < 10 ? 'down' : 'up'} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Selling price (₱)">{(id) => <Input id={id} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />}</Field>
        <Field label="Cost (₱)">{(id) => <Input id={id} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
        <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Supplier increase" />}</Field>
      </div>
      <h3 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-brand-700">Price history</h3>
      <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
        <DataTable
          rows={history.data?.data}
          loading={history.isPending}
          rowKey={(h) => h.id}
          empty="No changes yet."
          columns={[
            { header: 'When', cell: (h) => formatDateTime(h.created_at) },
            { header: 'Price', cell: (h) => `${h.old_price ? formatMoney(h.old_price) + ' → ' : ''}${formatMoney(h.new_price)}` },
            { header: 'Cost', cell: (h) => (h.new_cost ? `${h.old_cost ? formatMoney(h.old_cost) + ' → ' : ''}${formatMoney(h.new_cost)}` : '—') },
            { header: 'By', cell: (h) => h.changed_by?.name ?? '—' },
            { header: 'Reason', cell: (h) => h.reason ?? '' },
          ]}
        />
      </div>
    </Modal>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="px-4 py-3 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cx('mt-0.5 font-display text-lg font-bold tabular-nums', tone === 'up' ? 'text-emerald-700' : tone === 'down' ? 'text-rose-600' : 'text-slate-900')}>{value}</p>
    </div>
  );
}
