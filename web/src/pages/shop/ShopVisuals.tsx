import { ArrowRight, BadgeCheck, Heart, ShoppingBasket, Store, Tag } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

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

const SLIDES: { eyebrow: string; title: [string, string, string]; text: string }[] = [
  { eyebrow: 'Your neighborhood mini mart', title: ['Good finds from your ', 'neighborhood', ' store.'], text: 'Fresh products, everyday essentials, and fair prices, all in one place.' },
  { eyebrow: 'Order online, pick up in store', title: ['Order ahead and ', 'skip the line', '.'], text: 'Fill your basket online, choose a branch, and collect your order when it is ready.' },
  { eyebrow: 'No online payment needed', title: ['Reserve now, ', 'pay at pickup', '.'], text: 'Pay at the counter when you collect. Prices are confirmed by the store at pickup.' },
];

/** Light, photo-led storefront banner with three rotating messages. */
export function ShopHero({ photos, signedIn, onCreateAccount }: { photos: PhotoItem[]; signedIn: boolean; onCreateAccount: () => void }) {
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const withPhotos = photos.filter((photo) => photo.image_url);
  const pool = withPhotos.length >= 3 ? withPhotos : photos;
  const shown = Array.from({ length: Math.min(5, pool.length) }, (_, i) => pool[(slide * 5 + i) % pool.length]);
  const current = SLIDES[slide];

  useEffect(() => {
    if (paused || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setTimeout(() => setSlide((s) => (s + 1) % SLIDES.length), 7000);
    return () => window.clearTimeout(timer);
  }, [slide, paused]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Store highlights"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="relative isolate overflow-hidden rounded-[28px] bg-gradient-to-br from-[#e6f3e6] via-[#f3f9ef] to-[#dcefdd] ring-1 ring-emerald-900/[.06]"
    >
      <div className="absolute -left-24 -top-24 -z-10 size-80 rounded-full bg-white/60 blur-3xl" />
      <div className="absolute -bottom-32 right-[18%] -z-10 size-[420px] rounded-full bg-emerald-200/50 blur-3xl" />
      <div className="absolute right-0 top-0 -z-10 hidden h-full w-[46%] bg-[radial-gradient(circle_at_60%_55%,rgba(255,255,255,.85),transparent_62%)] lg:block" />

      <div className="grid items-center gap-4 px-6 pb-14 pt-8 sm:px-10 lg:grid-cols-[1.08fr_1fr] lg:gap-6 lg:px-14 lg:pb-12 lg:pt-10">
        <div key={slide} className="auth-fade">
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-emerald-900 shadow-sm ring-1 ring-emerald-900/10"><Store size={13} className="text-emerald-600" /> {current.eyebrow}</span>
          <h2 className="mt-5 max-w-xl font-display text-[34px] font-extrabold leading-[1.06] tracking-tight text-[#0b3b2c] sm:text-[46px] xl:text-[54px]">
            {current.title[0]}<span className="text-emerald-600">{current.title[1]}</span>{current.title[2]}
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-7 text-slate-600 sm:text-base">{current.text}</p>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-[#0b3b2c]">
            <Feature icon={<BadgeCheck />}>Quality products</Feature>
            <Feature icon={<Tag />}>Affordable prices</Feature>
            <Feature icon={<ShoppingBasket />}>Quick &amp; easy pickup</Feature>
          </ul>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="#products" className="inline-flex h-12 items-center gap-2 rounded-full bg-emerald-800 px-6 text-sm font-bold text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-900">Start shopping <ArrowRight size={16} /></a>
            {!signedIn && <button onClick={onCreateAccount} className="inline-flex h-12 items-center rounded-full bg-white px-6 text-sm font-semibold text-emerald-900 shadow-sm ring-1 ring-emerald-900/10 transition hover:bg-emerald-50">Create a free account</button>}
          </div>
        </div>

        <div className="relative mx-auto hidden w-full max-w-[520px] sm:block lg:max-w-[560px]">
          <BasketVisual key={slide} photos={shown} className="auth-fade" />
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-5 flex justify-center gap-2" role="tablist" aria-label="Choose a highlight">
        {SLIDES.map((s, i) => (
          <button key={s.eyebrow} role="tab" aria-selected={slide === i} aria-label={`Highlight ${i + 1}`} onClick={() => setSlide(i)} className={`h-2 rounded-full transition-all duration-300 ${slide === i ? 'w-7 bg-emerald-700' : 'w-2 bg-emerald-900/20 hover:bg-emerald-900/35'}`} />
        ))}
      </div>
    </section>
  );
}

function Feature({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-full bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-700/25 [&>svg]:size-[18px]">{icon}</span>
      {children}
    </li>
  );
}
