import { useQuery } from '@tanstack/react-query';
import { ArrowRight, RefreshCw, SearchX, Store } from 'lucide-react';
import { Link } from 'react-router';
import { api, errorMessage } from '../../lib/api';

interface DirectoryStore { code: string; name: string; branches: { id: number; name: string }[] }

/**
 * Shown at /shop, and when a shop address does not match any store (a typo or an old link).
 * Lists the stores that exist so the customer can continue instead of hitting a dead end.
 */
export function ShopDirectory({ missing, error, onRetry }: { missing?: string; error?: unknown; onRetry?: () => void }) {
  const failed = error !== undefined && missing === undefined; // network/server problem, not a wrong address
  const stores = useQuery({
    queryKey: ['shop-directory'],
    queryFn: () => api<{ data: DirectoryStore[] }>('/auth/businesses'),
    enabled: !failed,
    retry: false,
  });

  return (
    <div className="grid min-h-screen place-items-center bg-[#f5f7f4] p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <span className={`mx-auto grid size-12 place-items-center rounded-2xl ${missing || failed ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
          {missing ? <SearchX /> : <Store />}
        </span>

        {failed ? <>
          <h1 className="mt-4 font-display text-xl font-bold">Shop unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{errorMessage(error)}</p>
          {onRetry && <button onClick={onRetry} className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-800 px-5 text-sm font-bold text-white hover:bg-emerald-900"><RefreshCw size={15} /> Try again</button>}
        </> : <>
          <h1 className="mt-4 font-display text-xl font-bold">{missing ? 'Store not found' : 'Choose a store'}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {missing
              ? <>There is no online shop at <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-800">/shop/{missing}</span>. Check the address, or pick a store below.</>
              : 'Pick the store you want to shop from.'}
          </p>

          <div className="mt-6 space-y-2 text-left">
            {stores.isPending && <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />}
            {stores.data?.data.map((store) => (
              <Link key={store.code} to={`/shop/${store.code}`} className="group flex items-center gap-3 rounded-2xl border border-slate-200 p-3.5 transition hover:border-emerald-300 hover:bg-emerald-50/50">
                <img src="/brand/minimart-logo.svg" alt="" className="size-11 rounded-xl bg-emerald-50 object-contain p-1 ring-1 ring-emerald-100" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-900">{store.name}</span>
                  <span className="block truncate text-xs text-slate-500">/shop/{store.code} · {store.branches.length} {store.branches.length === 1 ? 'branch' : 'branches'}</span>
                </span>
                <ArrowRight size={17} className="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-emerald-700" />
              </Link>
            ))}
            {(stores.isError || stores.data?.data.length === 0) && <p className="rounded-2xl bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">Ask the store for its online shop link.</p>}
          </div>
        </>}
      </div>
    </div>
  );
}

/** Route element for /shop with no store in the address. */
export function ShopIndexPage() {
  return <ShopDirectory />;
}
