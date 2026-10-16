import { Loader2, Package, PackagePlus, Plus, Search, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useDebounced, useTenantQuery } from '../lib/hooks';
import type { Paginated, Product } from '../lib/types';
import { formatMoney } from '../lib/format';

/** Type-ahead product finder used by stock, transfer and purchasing forms. */
export function ProductSearch({ onPick, placeholder = 'Search product to add…' }: { onPick: (p: Product) => void; placeholder?: string }) {
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim());
  const results = useTenantQuery<Paginated<Product>>('/products', { q, per_page: 8 }, { enabled: q.length >= 1 });
  const show = q.length >= 1 && term.length > 0;

  return (
    <div className="relative">
      <label className="group flex h-11 items-center rounded-xl bg-slate-50 ring-1 ring-slate-200 transition focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-500">
        <Search className="pointer-events-none ml-3 size-4 shrink-0 text-slate-400 transition group-focus-within:text-brand-600" />
        <input className="h-full w-full bg-transparent px-2.5 text-sm outline-none placeholder:text-slate-400" placeholder={placeholder} value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search product" />
        {show && results.isFetching && <Loader2 className="mr-3 size-4 shrink-0 animate-spin text-slate-400" />}
      </label>
      {show && (
        <ul className="absolute z-10 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl bg-white p-1 shadow-xl shadow-slate-900/10 ring-1 ring-slate-900/10">
          {results.data?.data.length === 0 && <li className="px-3 py-3 text-center text-sm text-slate-500">No products match “{term}”</li>}
          {results.data?.data.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-brand-50"
                onClick={() => {
                  onPick(p);
                  setTerm('');
                }}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 transition group-hover:bg-white group-hover:text-brand-600"><Package className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900">{p.name}</span>
                  <span className="block font-mono text-[11px] text-slate-400">{p.sku}</span>
                </span>
                <span className="tabular-nums text-slate-500">{formatMoney(p.price)}</span>
                <Plus className="size-4 text-slate-300 transition group-hover:text-brand-600" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Container for the product lines picked in a stock / transfer / purchase form. */
export function LineList({ count, empty, children, header }: { count: number; empty: string; children: ReactNode; header?: ReactNode }) {
  if (count === 0) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
        <span className="grid size-10 place-items-center rounded-xl bg-white text-brand-600 shadow-sm ring-1 ring-slate-900/5"><PackagePlus className="size-5" /></span>
        <p className="mt-3 text-sm font-medium text-slate-700">No products yet</p>
        <p className="mt-0.5 text-xs text-slate-500">{empty}</p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
      <div className="flex items-center justify-between bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        <span>{count} {count === 1 ? 'product' : 'products'}</span>
        {header}
      </div>
      <ul className="divide-y divide-slate-100">{children}</ul>
    </div>
  );
}

/** One product line: name on the left, inputs on the right, remove button. */
export function LineItem({ name, sku, children, onRemove }: { name: string; sku?: string; children: ReactNode; onRemove?: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Package className="size-4" /></span>
      <span className="min-w-36 flex-1">
        <span className="block truncate font-medium text-slate-900">{name}</span>
        {sku && <span className="block font-mono text-[11px] text-slate-400">{sku}</span>}
      </span>
      {children}
      {onRemove && (
        <button type="button" className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" onClick={onRemove} aria-label={`Remove ${name}`}>
          <Trash2 className="size-4" />
        </button>
      )}
    </li>
  );
}

/** Small numeric input with a trailing label, sized for line items. */
export function QtyInput({ value, onChange, label, suffix, placeholder, prefix }: { value: string; onChange: (v: string) => void; label: string; suffix?: string; placeholder?: string; prefix?: string }) {
  return (
    <label className="flex h-9 w-32 items-center rounded-lg bg-white ring-1 ring-slate-200 transition focus-within:ring-2 focus-within:ring-brand-500">
      {prefix && <span className="pl-2.5 text-xs font-semibold text-slate-400">{prefix}</span>}
      <input className="h-full w-full min-w-0 bg-transparent px-2.5 text-right text-sm tabular-nums outline-none placeholder:text-slate-300" inputMode="decimal" placeholder={placeholder ?? '0'} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      {suffix && <span className="pr-2.5 text-[11px] font-medium text-slate-400">{suffix}</span>}
    </label>
  );
}
