import { useState } from 'react';
import { useDebounced, useTenantQuery } from '../lib/hooks';
import type { Paginated, Product } from '../lib/types';
import { formatMoney } from '../lib/format';
import { Input } from './ui';

/** Type-ahead product finder used by stock, transfer and purchasing forms. */
export function ProductSearch({ onPick, placeholder = 'Search product to add…' }: { onPick: (p: Product) => void; placeholder?: string }) {
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim());
  const results = useTenantQuery<Paginated<Product>>('/products', { q, per_page: 8 }, { enabled: q.length >= 1 });
  const show = q.length >= 1 && term.length > 0;

  return (
    <div className="relative">
      <Input placeholder={placeholder} value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search product" />
      {show && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {results.data?.data.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No matches</li>}
          {results.data?.data.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  onPick(p);
                  setTerm('');
                }}
              >
                <span>
                  <span className="font-medium text-slate-900">{p.name}</span> <span className="text-slate-500">{p.sku}</span>
                </span>
                <span className="tabular-nums text-slate-500">{formatMoney(p.price)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
