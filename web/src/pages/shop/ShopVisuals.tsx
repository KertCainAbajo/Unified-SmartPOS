import { ArrowRight, Bike, Cookie, CupSoda, Heart, ShoppingBasket, Soup, Sparkles, SprayCan, Store, Wallet, Wheat } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface PhotoItem { name: string; image_url: string | null }

/** Where each product photo sits in the basket: [left %, bottom %, width %, rotation°, layer]. */
const SLOTS: [number, number, number, number, number][] = [
  [4, 42, 30, -13, 1],
  [35, 49, 30, -2, 2],
  [64, 42, 30, 12, 1],
  [17, 34, 27, 7, 3],
  [55, 34, 27, -8, 3],
];

/** A green shop basket filled with real product photos, carrying the store logo. */
export function BasketVisual({ photos, note = true, className = '' }: { photos: PhotoItem[]; note?: boolean; className?: string }) {
  const items = photos.slice(0, SLOTS.length);

  return (
    <div className={`relative aspect-[10/9] w-full select-none ${className}`} aria-hidden>
      {/* Floor shadow */}
      <div className="absolute inset-x-[10%] bottom-[-2%] h-[8%] rounded-[50%] bg-emerald-950/20 blur-xl" />

      {/* Handles sit behind the products */}
      <svg viewBox="0 0 400 260" className="absolute inset-x-[6%] bottom-[37%] z-0 w-[88%]" fill="none">
        <path d="M58 260 C 46 70, 150 16, 200 16 C 250 16, 354 70, 342 260" stroke="#145c39" strokeWidth="20" strokeLinecap="round" />
        <path d="M58 260 C 46 70, 150 16, 200 16 C 250 16, 354 70, 342 260" stroke="#2a9a62" strokeWidth="9" strokeLinecap="round" />
      </svg>

      {items.map((item, i) => {
        const [left, bottom, width, rotate, layer] = SLOTS[i];
        return (
          <div
            key={`${item.name}-${i}`}
            className="absolute aspect-[4/5] overflow-hidden rounded-2xl bg-white p-1.5 shadow-[0_18px_30px_-12px_rgba(6,40,26,.45)] ring-1 ring-black/5 transition-transform duration-700"
            style={{ left: `${left}%`, bottom: `${bottom}%`, width: `${width}%`, transform: `rotate(${rotate}deg)`, zIndex: layer }}
          >
            {item.image_url
              ? <img src={item.image_url} alt="" className="size-full rounded-xl object-cover" />
              : <span className="grid size-full place-items-center rounded-xl bg-emerald-50 font-display text-3xl font-bold text-emerald-700">{item.name.charAt(0)}</span>}
          </div>
        );
      })}

      {/* Basket body in front */}
      <div className="absolute inset-x-[2%] bottom-0 z-10 h-[46%]">
        <BasketBody />
        <div className="absolute left-1/2 top-[24%] flex w-[26%] -translate-x-1/2 items-center justify-center rounded-2xl bg-white/95 p-[1.5%] shadow-lg ring-1 ring-emerald-900/10">
          <img src="/brand/minimart-logo.svg" alt="" className="h-auto w-full" />
        </div>
      </div>

      {note && (
        <p className="absolute -right-1 top-[6%] z-20 rotate-[-8deg] text-right font-hand text-[26px] font-bold leading-[0.95] text-emerald-800 sm:text-[30px]">
          Small store,<br />big care <Heart className="inline size-5 -translate-y-0.5 fill-rose-400 text-rose-400" />
          <svg viewBox="0 0 80 40" className="ml-auto mt-1 h-7 w-14 text-emerald-700/70" fill="none"><path d="M76 4 C 60 30, 30 36, 6 26 M6 26 l10 -9 M6 26 l13 5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </p>
      )}
    </div>
  );
}

function BasketBody() {
  const holes: ReactNode[] = [];
  for (let row = 0; row < 4; row++) {
    const y = 58 + row * 30;
    const inset = 22 + row * 7;
    const columns = 10;
    const span = 400 - inset * 2;
    for (let col = 0; col < columns; col++) {
      const x = inset + (span / columns) * col + 6;
      // Leave the middle clear for the logo plate.
      if (row < 3 && col >= 3 && col <= 6) continue;
      holes.push(<rect key={`${row}-${col}`} x={x} y={y} width={span / columns - 12} height="15" rx="6" fill="#0d4a2d" opacity=".55" />);
    }
  }
  return (
    <svg viewBox="0 0 400 200" preserveAspectRatio="none" className="size-full drop-shadow-[0_12px_18px_rgba(6,40,26,.25)]">
      <defs>
        <linearGradient id="basket-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a9a62" />
          <stop offset="1" stopColor="#13603b" />
        </linearGradient>
      </defs>
      <path d="M8 26 H392 L362 192 Q360 200 352 200 H48 Q40 200 38 192 Z" fill="url(#basket-body)" />
      {holes}
      <rect x="0" y="6" width="400" height="34" rx="14" fill="#1c7a4a" />
      <rect x="10" y="11" width="380" height="5" rx="2.5" fill="#fff" opacity=".22" />
    </svg>
  );
}

/**
 * Storefront hero. Phones: swipeable promo cards. Tablets and computers: a compact welcome banner beside three
 * short cards on the ways to order.
 */
export function ShopHero({ photos, signedIn, onCreateAccount, onStart, branchCount = 0 }: {
  photos: PhotoItem[]; signedIn: boolean; onCreateAccount: () => void;
  /** "Start shopping": signed-in customers go to the products, guests are asked to sign in first. */
  onStart: () => void;
  branchCount?: number;
}) {
  const withPhotos = photos.filter((photo) => photo.image_url);
  const pool = withPhotos.length >= 3 ? withPhotos : photos;

  return (
    <>
      <PhoneBanners photos={pool} signedIn={signedIn} onCreateAccount={onCreateAccount} onStart={onStart} />

      <section aria-label="Store highlights" className="hidden sm:block">
        {/* Store front: awning stripe, headline, aisle signs */}
        <article className="relative overflow-hidden rounded-2xl border border-emerald-900/10 bg-gradient-to-br from-[#eef7ea] via-white to-[#fff5dc] shadow-[0_12px_30px_-24px_rgba(6,60,40,.6)]">
          <Awning />
          <div className="grid items-center gap-6 px-6 py-6 lg:px-8 xl:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[.14em] text-amber-800 ring-1 ring-amber-200">
                <Store className="size-3.5" /> Your neighborhood mini mart
              </p>
              <h2 className="mt-3 max-w-lg font-display text-2xl font-bold leading-tight tracking-tight text-[#0b3b2c] lg:text-[28px]">
                Everyday essentials, <span className="text-emerald-600">ready when you are.</span>
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
                Order online from {branchCount > 1 ? `${branchCount} branches` : 'the store'}. Pick it up or have it delivered, and pay in cash when you get it.
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <button type="button" onClick={onStart} className="group inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm shadow-emerald-900/20 transition hover:bg-emerald-800">
                  Start shopping <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
                </button>
                {!signedIn && <button type="button" onClick={onCreateAccount} className="inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-900/15 transition hover:bg-emerald-50">Create a free account</button>}
              </div>
            </div>

            <ul aria-hidden className="hidden grid-cols-3 gap-2.5 xl:grid">
              {AISLES.map(({ icon: Icon, label, tone }) => (
                <li key={label} className="flex w-[104px] flex-col items-center gap-1.5 rounded-xl bg-white/80 px-2 py-3 text-center shadow-sm ring-1 ring-slate-900/[.06]">
                  <span className={`grid size-10 place-items-center rounded-full ${tone}`}><Icon className="size-5" /></span>
                  <span className="text-[11px] font-semibold leading-tight text-slate-700">{label}</span>
                </li>
              ))}
            </ul>
          </div>
        </article>

        {/* Ways to order: one slim strip */}
        <ul className="mt-3 grid grid-cols-3 divide-x divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {[
            { icon: Bike, title: 'Delivery', text: 'Cash on delivery, live rider map' },
            { icon: Store, title: branchCount > 1 ? `Pickup at ${branchCount} branches` : 'Store pickup', text: 'Collect when it is ready' },
            { icon: Wallet, title: 'Pay when you get it', text: 'No card, no online fees' },
          ].map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex items-center gap-3 px-4 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Icon className="size-[18px]" /></span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-900">{title}</span>
                <span className="block truncate text-xs text-slate-500">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

const BANNERS = [
  { tag: 'Pickup & delivery', title: 'Order ahead,', accent: 'skip the line.', text: 'Fill your basket, pick a branch, collect when ready.', bg: 'from-[#e6f4e4] via-white to-[#fff5dc]', glow: 'bg-emerald-200/50', accentText: 'text-emerald-600' },
  { tag: 'Cash on delivery', title: 'Delivered to', accent: 'your door.', text: 'Pay the rider in cash. Track them live on the map.', bg: 'from-[#fff1dc] via-white to-[#fde8e0]', glow: 'bg-amber-200/60', accentText: 'text-orange-600' },
  { tag: 'No online payment', title: 'Reserve now,', accent: 'pay at pickup.', text: 'Pay at the counter when you collect your order.', bg: 'from-[#e3f1fb] via-white to-[#e8f6ec]', glow: 'bg-sky-200/50', accentText: 'text-sky-700' },
];

/** Phones: compact swipeable promo cards (the next one peeks in), auto-advancing, instead of the tall banner. */
function PhoneBanners({ photos, signedIn, onCreateAccount, onStart }: { photos: PhotoItem[]; signedIn: boolean; onCreateAccount: () => void; onStart: () => void }) {
  const rail = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const go = (i: number) => {
    const el = rail.current?.children[i] as HTMLElement | undefined;
    if (el && rail.current) rail.current.scrollTo({ left: el.offsetLeft - rail.current.offsetLeft, behavior: 'smooth' });
  };
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setTimeout(() => go((index + 1) % BANNERS.length), 6000);
    return () => window.clearTimeout(timer);
  }, [index]);

  return (
    <section aria-label="Store highlights" className="sm:hidden">
      <div ref={rail} onScroll={(e) => { const el = e.currentTarget; setIndex(Math.round(el.scrollLeft / (el.clientWidth * 0.88))); }}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {BANNERS.map((b, i) => (
          <article key={b.tag} className={`relative isolate flex w-[88%] shrink-0 snap-start overflow-hidden rounded-[20px] border border-emerald-900/10 bg-gradient-to-br p-5 pt-7 text-[#0b3b2c] shadow-sm ${b.bg}`}>
            <Awning className="absolute inset-x-0 top-0" />
            <span aria-hidden className={`absolute -right-10 -top-12 -z-10 size-40 rounded-full blur-2xl ${b.glow}`} />
            <div className="relative z-[1] min-w-0 flex-1 pr-2">
              <span className="inline-flex rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200">{b.tag}</span>
              <p className="mt-3 font-display text-[22px] font-extrabold leading-[1.1]">{b.title}<br /><span className={b.accentText}>{b.accent}</span></p>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">{b.text}</p>
              {i === 0 && !signedIn
                ? <button onClick={onCreateAccount} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-700 px-4 text-xs font-bold text-white shadow-sm active:scale-95">Create free account <ArrowRight size={14} /></button>
                : <button type="button" onClick={onStart} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-700 px-4 text-xs font-bold text-white shadow-sm active:scale-95">Shop now <ArrowRight size={14} /></button>}
            </div>
            <div aria-hidden className="relative w-[34%] shrink-0">
              {photos.slice(i * 2, i * 2 + 2).map((p, j) => (
                <span key={p.name} className="absolute grid size-[4.5rem] place-items-center rounded-2xl bg-white p-1.5 shadow-lg ring-1 ring-slate-900/5" style={{ right: j ? 30 : 0, top: j ? 70 : 6, transform: `rotate(${j ? -8 : 7}deg)` }}>
                  {p.image_url ? <img src={p.image_url} alt="" className="size-full object-contain" /> : <ShoppingBasket className="size-7 text-emerald-700" />}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
      <div className="mt-3 flex justify-center gap-1.5">
        {BANNERS.map((b, i) => <button key={b.tag} type="button" aria-label={`Highlight ${i + 1}`} onClick={() => go(i)} className={`h-1.5 rounded-full transition-all duration-300 ${index === i ? 'w-6 bg-emerald-700' : 'w-1.5 bg-slate-300'}`} />)}
      </div>
    </section>
  );
}

/** Store aisles shown as signs in the banner. */
const AISLES = [
  { icon: Wheat, label: 'Rice & grains', tone: 'bg-amber-100 text-amber-700' },
  { icon: Soup, label: 'Canned goods', tone: 'bg-rose-100 text-rose-600' },
  { icon: CupSoda, label: 'Drinks', tone: 'bg-sky-100 text-sky-600' },
  { icon: Cookie, label: 'Snacks', tone: 'bg-orange-100 text-orange-600' },
  { icon: Sparkles, label: 'Personal care', tone: 'bg-violet-100 text-violet-600' },
  { icon: SprayCan, label: 'Household', tone: 'bg-emerald-100 text-emerald-700' },
];

/** Empty shop: a store shelf of faded products, "being stocked". */
export function EmptyAisle() {
  const shelf = ['bg-amber-200', 'bg-rose-200', 'bg-sky-200', 'bg-emerald-200', 'bg-orange-200', 'bg-violet-200', 'bg-amber-200'];
  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center">
      <div aria-hidden className="mx-auto w-full max-w-xs">
        {[0, 1].map((row) => (
          <div key={row} className="mt-2 first:mt-0">
            <div className="flex items-end justify-center gap-2 px-3 opacity-60">
              {shelf.map((tone, i) => (
                <span key={i} className={`${tone} rounded-t-md ${(i + row) % 3 === 0 ? 'h-9 w-6' : (i + row) % 3 === 1 ? 'h-6 w-8' : 'h-7 w-5'}`} />
              ))}
            </div>
            <div className="h-1.5 rounded-full bg-slate-300" />
          </div>
        ))}
      </div>
      <p className="mt-6 font-display text-base font-bold text-slate-900">Shelves are being stocked</p>
      <p className="mt-1 text-sm text-slate-500">This store hasn't listed products online yet. Please check back soon.</p>
    </div>
  );
}

/** The mini-mart awning: a green-and-white stripe along the top of customer screens. */
export function Awning({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`h-2.5 shrink-0 bg-[repeating-linear-gradient(90deg,#0b6b43_0_22px,#ffffff_22px_44px)] shadow-[0_3px_6px_-3px_rgba(6,60,40,.35)] ${className}`} />;
}
