import { ArrowRight, Bike, Flame, Heart, Plus, ShoppingBasket, Wallet } from 'lucide-react';
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

export interface HeroProduct extends PhotoItem { id: number; price: string; unit: string }

const peso = (value: string | number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value));

/**
 * Storefront hero. Phones: swipeable promo cards. Tablets and computers: a "bento" grid — a large feature tile with
 * live store facts and floating product photos, a delivery tile, best sellers you can add straight away, and pay-at-pickup.
 */
export function ShopHero({ photos, signedIn, onCreateAccount, onStart, products = [], branchCount = 0, onAdd }: {
  photos: PhotoItem[]; signedIn: boolean; onCreateAccount: () => void;
  /** "Start shopping": signed-in customers go to the products, guests are asked to sign in first. */
  onStart: () => void;
  products?: HeroProduct[]; branchCount?: number; onAdd?: (id: number) => void;
}) {
  const withPhotos = photos.filter((photo) => photo.image_url);
  const pool = withPhotos.length >= 3 ? withPhotos : photos;
  const best = products.filter((p) => p.image_url).slice(0, 3);
  const floating = pool.slice(3, 6);

  return (
    <>
      <PhoneBanners photos={pool} signedIn={signedIn} onCreateAccount={onCreateAccount} onStart={onStart} />

      <section aria-label="Store highlights" className="hidden gap-4 sm:grid lg:grid-cols-12 lg:grid-rows-[auto_auto]">
        {/* Feature tile */}
        <article className="relative isolate overflow-hidden rounded-[32px] bg-[#062a1d] p-8 text-white shadow-[0_40px_80px_-40px_rgba(2,44,34,.8)] lg:col-span-7 lg:row-span-2 lg:p-10">
          <span aria-hidden className="absolute -left-24 -top-32 -z-10 size-[26rem] rounded-full bg-emerald-500/35 blur-[90px]" />
          <span aria-hidden className="absolute -bottom-40 right-0 -z-10 size-[28rem] rounded-full bg-amber-400/25 blur-[100px]" />
          <span aria-hidden className="absolute inset-0 -z-10 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_30%_30%,#000_20%,transparent_70%)]" />

          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold ring-1 ring-white/15 backdrop-blur">
            <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="relative inline-flex size-2 rounded-full bg-emerald-400" /></span>
            Order online{branchCount ? ` · ${branchCount} ${branchCount === 1 ? 'branch' : 'branches'}` : ''}
          </span>
          <h2 className="mt-6 max-w-xl font-display text-[40px] font-extrabold leading-[1.02] tracking-[-0.03em] xl:text-[60px]">
            Your neighborhood store,{' '}
            <span className="bg-gradient-to-r from-amber-300 via-yellow-200 to-lime-300 bg-clip-text text-transparent">now on your phone.</span>
          </h2>
          <p className="mt-5 max-w-md text-[15px] leading-7 text-emerald-50/75">Fill your basket, choose pickup or delivery, and pay in cash when you get your order. Live stock from every branch.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button type="button" onClick={onStart} className="group inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-bold text-emerald-950 shadow-lg shadow-black/20 transition hover:bg-amber-200">
              Start shopping <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
            </button>
            {!signedIn && <button onClick={onCreateAccount} className="inline-flex h-12 items-center rounded-full bg-white/10 px-6 text-sm font-semibold ring-1 ring-white/25 backdrop-blur transition hover:bg-white/20">Create a free account</button>}
          </div>
          <dl className="mt-9 flex flex-wrap gap-x-8 gap-y-3">
            {[[String(products.length || photos.length), 'Products'], [String(branchCount || 1), branchCount === 1 ? 'Branch' : 'Branches'], ['₱0', 'Online fees']].map(([value, label]) => (
              <div key={label}>
                <dt className="font-display text-2xl font-extrabold">{value}</dt>
                <dd className="text-xs font-medium uppercase tracking-wider text-emerald-100/60">{label}</dd>
              </div>
            ))}
          </dl>

          {/* Floating photos */}
          <div aria-hidden className="pointer-events-none absolute -right-4 bottom-6 hidden w-[44%] max-w-[300px] xl:block">
            {floating.map((p, i) => (
              <span key={p.name} className="absolute grid size-28 place-items-center rounded-3xl bg-white/95 p-3 shadow-2xl shadow-black/40 ring-1 ring-white/40 xl:size-32"
                style={{ right: [10, 120, 40][i], bottom: [150, 60, 0][i], transform: `rotate(${[8, -10, 4][i]}deg)` }}>
                {p.image_url ? <img src={p.image_url} alt="" className="size-full object-contain" /> : <ShoppingBasket className="size-10 text-emerald-700" />}
              </span>
            ))}
          </div>
        </article>

        {/* Delivery tile */}
        <article className="relative isolate overflow-hidden rounded-[32px] bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 p-7 text-white shadow-[0_30px_60px_-35px_rgba(234,88,12,.8)] lg:col-span-5">
          <span aria-hidden className="absolute -right-10 -top-16 -z-10 size-56 rounded-full bg-yellow-200/40 blur-3xl" />
          <svg aria-hidden viewBox="0 0 200 80" className="absolute bottom-4 right-4 -z-10 w-48 opacity-40"><path d="M5 70 C 50 70, 60 15, 105 25 S 160 60, 195 10" fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="2 8" strokeLinecap="round" /><circle cx="195" cy="10" r="6" fill="#fff" /></svg>
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="inline-flex rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wider ring-1 ring-white/30">Cash on delivery</span>
              <h3 className="mt-4 font-display text-2xl font-extrabold leading-tight xl:text-[28px]">Delivered to your door.</h3>
              <p className="mt-2 max-w-xs text-sm text-white/85">Pin your exact spot on the map and follow your rider live.</p>
            </div>
            <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30 backdrop-blur"><Bike className="size-8" /></span>
          </div>
        </article>

        {/* Best sellers + pay at pickup */}
        <div className="grid gap-4 sm:grid-cols-[1.5fr_1fr] lg:col-span-5">
          <article className="rounded-[32px] bg-white p-5 shadow-[0_20px_50px_-30px_rgba(15,23,42,.35)] ring-1 ring-slate-200/80">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.16em] text-emerald-700"><Flame className="size-4 text-orange-500" />Best sellers</p>
            <ul className="mt-3 space-y-2.5">
              {best.map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-50 p-1 ring-1 ring-slate-100">{p.image_url && <img src={p.image_url} alt="" className="size-full object-contain mix-blend-multiply" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">{p.name}</span>
                    <span className="text-xs font-bold text-emerald-700">{peso(p.price)}<span className="font-medium text-slate-400"> / {p.unit}</span></span>
                  </span>
                  {onAdd && <button type="button" onClick={() => onAdd(p.id)} aria-label={`Quick add ${p.name}`} className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-700 text-white transition hover:bg-emerald-800 active:scale-90"><Plus size={16} strokeWidth={2.6} /></button>}
                </li>
              ))}
            </ul>
          </article>
          <article className="relative isolate flex flex-col justify-between overflow-hidden rounded-[32px] bg-gradient-to-br from-lime-200 via-emerald-100 to-teal-100 p-5 text-emerald-950 ring-1 ring-emerald-900/5">
            <span aria-hidden className="absolute -bottom-10 -right-10 -z-10 size-36 rounded-full bg-white/60 blur-2xl" />
            <span className="grid size-12 place-items-center rounded-2xl bg-white shadow-sm"><Wallet className="size-6 text-emerald-700" /></span>
            <div className="mt-6">
              <h3 className="font-display text-lg font-extrabold leading-tight">Pay at pickup</h3>
              <p className="mt-1 text-xs text-emerald-900/70">No card needed. Reserve now, pay at the counter.</p>
            </div>
          </article>
        </div>
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

