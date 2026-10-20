import { ArrowRight, Banknote, Bike, Heart, ShoppingBasket, Store } from 'lucide-react';
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

      <section aria-label="Store highlights" className="hidden gap-4 sm:grid xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:items-start">
        {/* Storefront: striped awning, wooden sign, shelves */}
        <article className="sari-card relative overflow-hidden rounded-2xl">
          <div aria-hidden className="sari-awning h-6" />
          <div aria-hidden className="sari-awning-edge" />
          <div className="flex items-end gap-4 px-5 pb-5 pt-2">
            <div className="min-w-0 flex-1">
              <div className="sari-wood inline-block max-w-full rounded-lg px-4 py-2.5 shadow-lg ring-1 ring-black/25">
                <h2 className="font-display text-lg font-bold leading-snug text-[#fdf3e1] lg:text-[22px]">
                  Your neighborhood store, <span className="text-amber-300">now online.</span>
                </h2>
              </div>
              <p className="mt-3 max-w-md text-sm leading-6 text-[#6b4a2b]">Fill your basket, choose pickup or delivery, and pay in cash when you get your order.</p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <button type="button" onClick={onStart} className="sari-btn group inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition">
                  Start shopping <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
                </button>
                {!signedIn && <button type="button" onClick={onCreateAccount} className="sari-btn inline-flex h-10 items-center rounded-lg px-4 text-sm font-semibold transition">Create a free account</button>}
              </div>
            </div>
            <StoreShelf />
          </div>
        </article>

        {/* Hanging price tags: the ways to order */}
        <ul className="grid grid-cols-3 items-start gap-3 pt-5">
          {[
            { icon: Bike, title: 'Delivery to your door', text: 'Cash on delivery', tone: 'text-emerald-700', tilt: '-rotate-2' },
            { icon: Store, title: `Pickup at ${branchCount > 1 ? `${branchCount} branches` : 'the store'}`, text: 'Collect when ready', tone: 'text-[#9a5a2a]', tilt: 'rotate-1' },
            { icon: Banknote, title: 'Pay when you get it', text: 'No online fees', tone: 'text-amber-700', tilt: '-rotate-1' },
          ].map(({ icon: Icon, title, text, tone, tilt }) => (
            <li key={title} className={`relative origin-top ${tilt} transition hover:rotate-0`}>
              <span aria-hidden className="absolute -top-5 left-1/2 h-7 w-px -translate-x-1/2 bg-[#7a5a35]" />
              <div className="sari-tag sari-kraft flex flex-col items-center rounded-b-xl px-2 pb-5 pt-7 text-center shadow-[0_12px_20px_-12px_rgba(70,40,10,.6)]">
                <span aria-hidden className="sari-tag-hole absolute left-1/2 top-2.5 size-3 -translate-x-1/2 rounded-full" />
                <span className={`grid size-12 place-items-center rounded-full bg-[#fff7e6] shadow-inner ring-1 ring-[#b08550]/40 ${tone}`}><Icon className="size-6" /></span>
                <p className="mt-2 font-hand text-[22px] font-bold leading-6 text-[#4a2f17]">{title}</p>
                <p className="mt-1 text-[11px] font-medium text-[#6b4a2b]/80">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

const BANNERS = [
  { tag: 'Pickup & delivery', title: 'Order ahead,', accent: 'skip the line.', text: 'Fill your basket, pick a branch, collect when ready.', bg: 'from-emerald-700 via-emerald-800 to-[#063626]', glow: 'bg-amber-300/30', accentText: 'text-amber-300' },
  { tag: 'Cash on delivery', title: 'Delivered to', accent: 'your door.', text: 'Pay the rider in cash. Track them live on the map.', bg: 'from-amber-500 via-orange-500 to-rose-500', glow: 'bg-yellow-200/40', accentText: 'text-yellow-100' },
  { tag: 'No online payment', title: 'Reserve now,', accent: 'pay at pickup.', text: 'Pay at the counter when you collect your order.', bg: 'from-sky-600 via-cyan-700 to-emerald-700', glow: 'bg-white/25', accentText: 'text-cyan-100' },
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
          <article key={b.tag} className={`relative isolate flex w-[88%] shrink-0 snap-start overflow-hidden rounded-[24px] bg-gradient-to-br p-5 text-white shadow-lg shadow-emerald-950/20 ${b.bg}`}>
            <span aria-hidden className={`absolute -right-10 -top-12 -z-10 size-40 rounded-full blur-2xl ${b.glow}`} />
            <div className="relative z-[1] min-w-0 flex-1 pr-2">
              <span className="inline-flex rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ring-1 ring-white/25 backdrop-blur">{b.tag}</span>
              <p className="mt-3 font-display text-[22px] font-extrabold leading-[1.1]">{b.title}<br /><span className={b.accentText}>{b.accent}</span></p>
              <p className="mt-2 text-xs leading-relaxed text-white/85">{b.text}</p>
              {i === 0 && !signedIn
                ? <button onClick={onCreateAccount} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-xs font-bold text-emerald-900 shadow-sm active:scale-95">Create free account <ArrowRight size={14} /></button>
                : <button type="button" onClick={onStart} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-xs font-bold text-slate-900 shadow-sm active:scale-95">Shop now <ArrowRight size={14} /></button>}
            </div>
            <div aria-hidden className="relative w-[34%] shrink-0">
              {photos.slice(i * 2, i * 2 + 2).map((p, j) => (
                <span key={p.name} className="absolute grid size-[4.5rem] place-items-center rounded-2xl bg-white p-1.5 shadow-xl shadow-black/25" style={{ right: j ? 30 : 0, top: j ? 70 : 6, transform: `rotate(${j ? -8 : 7}deg)` }}>
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

/** A little wooden shelf of goods for the storefront banner (drawn, no photos needed). */
function StoreShelf() {
  const rows = [
    ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad'],
    ['#d35400', '#16a085', '#c0392b', '#f39c12', '#2c3e50', '#e74c3c'],
  ];
  return (
    <svg aria-hidden viewBox="0 0 200 132" className="hidden w-44 shrink-0 drop-shadow-md md:block xl:hidden">
      <rect x="2" y="2" width="196" height="128" rx="6" fill="#7b4b27" />
      <rect x="10" y="10" width="180" height="112" rx="3" fill="#f0dfbf" />
      {rows.map((colors, r) => (
        <g key={r} transform={`translate(0 ${r * 52})`}>
          {colors.map((c, i) => (i % 2
            ? <g key={i}><rect x={16 + i * 29} y={22} width="20" height="30" rx="4" fill={c} /><rect x={16 + i * 29} y={28} width="20" height="9" fill="#fff" opacity=".75" /></g>
            : <g key={i}><rect x={18 + i * 29} y={30} width="17" height="22" rx="2" fill={c} /><rect x={18 + i * 29} y={34} width="17" height="6" fill="#fff" opacity=".7" /></g>))}
          <rect x="10" y="52" width="180" height="7" fill="#a26c3d" />
          <rect x="10" y="58" width="180" height="2" fill="#5a321a" opacity=".5" />
        </g>
      ))}
    </svg>
  );
}

/** Empty shop: a chalkboard on an easel in front of empty wooden shelves with baskets. */
export function EmptyShelves() {
  return (
    <div className="sari-card relative mt-5 overflow-hidden rounded-2xl px-4 pb-8 pt-10">
      <div aria-hidden className="absolute inset-x-6 top-[38%] h-2.5 rounded-sm sari-plank shadow-[0_6px_8px_-4px_rgba(70,40,10,.5)]" />
      <div aria-hidden className="absolute inset-x-6 top-[78%] h-2.5 rounded-sm sari-plank shadow-[0_6px_8px_-4px_rgba(70,40,10,.5)]" />
      <div aria-hidden className="absolute inset-x-10 top-[78%] flex -translate-y-full justify-between">
        {[0, 1, 2, 3].map((i) => <span key={i} className={`h-4 w-14 rounded-b-[40%] bg-[#b98a52] shadow-inner ring-1 ring-[#7b4b27]/40 ${i === 1 || i === 2 ? 'hidden sm:block' : ''}`} />)}
      </div>
      <div className="relative mx-auto w-fit">
        <div className="sari-wood rounded-lg p-2 shadow-xl">
          <div className="sari-chalk rounded px-8 py-6 text-center sm:px-14">
            <p className="font-hand text-3xl font-bold leading-9 text-white/90 sm:text-4xl">No products yet…<br />but coming soon!</p>
          </div>
        </div>
        <div aria-hidden className="mx-auto flex w-40 justify-between">
          <span className="h-10 w-2 -rotate-12 rounded-b sari-wood-v" />
          <span className="h-10 w-2 rotate-12 rounded-b sari-wood-v" />
        </div>
      </div>
    </div>
  );
}
