import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useRouteError } from 'react-router';

/** Shown instead of a blank or technical screen when a page fails unexpectedly. */
export function ErrorPage() {
  const error = useRouteError();
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (detail) console.error(error);
  const home = window.location.pathname.startsWith('/shop/') ? window.location.pathname.split('/').slice(0, 3).join('/') : '/';

  return (
    <div className="grid min-h-full place-items-center bg-gradient-to-br from-[#f3f9ef] to-[#dcefdd] p-6">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-[0_30px_60px_-30px_rgba(2,44,34,0.45)]">
        <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-amber-100 text-amber-600 ring-8 ring-amber-50"><TriangleAlert className="size-8" /></span>
        <h1 className="mt-5 font-display text-xl font-bold text-slate-900">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">This page could not load. It is usually a connection hiccup. Please try again.</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-emerald-700 to-emerald-900 font-semibold text-white shadow-lg shadow-emerald-900/20 transition active:scale-[.98]">
          <RefreshCw className="size-4" /> Try again
        </button>
        <a href={home} className="mt-3 inline-block text-sm font-semibold text-emerald-700 hover:underline">Go to the start page</a>
      </div>
    </div>
  );
}
