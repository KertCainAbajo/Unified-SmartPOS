import { Cookie, FileText, ReceiptText, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router';

export const LEGAL_POLICIES: { slug: string; label: string; icon: LucideIcon }[] = [
  { slug: 'privacy', label: 'Privacy', icon: ShieldCheck },
  { slug: 'terms', label: 'Terms', icon: FileText },
  { slug: 'cookies', label: 'Cookies', icon: Cookie },
  { slug: 'refunds', label: 'Refunds', icon: ReceiptText },
];

/** Link to a policy that remembers the page it was opened from, so the policy page can send the reader back. */
export function useLegalHref() {
  const location = useLocation();
  const [params] = useSearchParams();
  // On a policy page keep the original "from"; elsewhere the current page is where to return.
  const from = location.pathname.startsWith('/legal/') ? params.get('from') ?? '' : `${location.pathname}${location.search}`;
  return (slug: string) => `/legal/${slug}${from ? `?from=${encodeURIComponent(from)}` : ''}`;
}

/** The four policy links as small pill buttons. `tone="dark"` for dark backgrounds such as the shop footer. */
export function LegalLinks({ className = '', tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  const href = useLegalHref();
  const { pathname } = useLocation();
  return (
    <nav aria-label="Legal information" className={`flex flex-wrap items-center justify-center gap-1.5 ${className}`}>
      {LEGAL_POLICIES.map(({ slug, label, icon: Icon }) => {
        const active = pathname === `/legal/${slug}`;
        return (
          <Link key={slug} to={href(slug)} aria-current={active ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition duration-200 ${tone === 'dark'
              ? active ? 'bg-white text-emerald-900 ring-white' : 'bg-white/[.06] text-emerald-50/80 ring-white/15 hover:bg-white/15 hover:text-white'
              : active ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white/80 text-slate-600 ring-slate-200 hover:bg-white hover:text-brand-800 hover:ring-brand-300'}`}>
            <Icon className="size-3.5" /> {label}
          </Link>
        );
      })}
    </nav>
  );
}
