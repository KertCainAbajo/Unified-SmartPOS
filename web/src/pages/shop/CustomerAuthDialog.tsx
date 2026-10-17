import { ArrowRight, Clock3, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, Phone, ShoppingBasket, TriangleAlert, UserRound, Wallet, X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { BasketVisual, type PhotoItem } from './ShopVisuals';

type Mode = 'login' | 'register';

/**
 * Full-screen customer sign-in / sign-up for the online shop. It opens over the shop so the basket survives.
 * Field names match the shop API (name, phone, email, password, password_confirmation); the parent posts the form as-is.
 */
export function CustomerAuthDialog({ open, onClose, storeName, mode, onModeChange, onSubmit, busy, error, basketCount, basketTotal, photos }: {
  open: boolean;
  onClose: () => void;
  storeName: string;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  error: string;
  basketCount: number;
  basketTotal: string;
  /** Basket items when there are some, otherwise the catalogue; their photos fill the basket illustration. */
  photos: PhotoItem[];
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [password, setPassword] = useState('');
  const register = mode === 'register';
  const trackCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState('CapsLock'));
  const switchTo = (next: Mode) => {
    setPassword('');
    setShowPassword(false);
    onModeChange(next);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', onKey); };
  }, [open, busy, onClose]);

  if (!open) return null;

  const withPhotos = photos.filter((p) => p.image_url);
  const basketPhotos = (withPhotos.length ? withPhotos : photos).slice(0, 5);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-[#062a1d]/55 backdrop-blur-md" onClick={() => !busy && onClose()} aria-hidden />
      <div className="relative flex min-h-full items-stretch justify-center sm:items-center sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shop-auth-title"
          className="auth-fade relative grid w-full max-w-[1060px] overflow-hidden bg-white shadow-[0_40px_120px_-30px_rgba(2,44,34,0.6)] sm:rounded-[28px] lg:grid-cols-[1.02fr_1fr]"
        >
          {/* ───── Brand side ───── */}
          <aside className="relative hidden flex-col overflow-hidden bg-gradient-to-br from-[#e6f3e6] via-[#f3f9ef] to-[#dcefdd] p-10 lg:flex">
            <div className="pointer-events-none absolute -left-20 -top-24 size-72 rounded-full bg-white/70 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-28 -right-16 size-80 rounded-full bg-emerald-200/60 blur-3xl" />

            <div className="relative flex items-center gap-3">
              <img src="/brand/minimart-logo.svg" alt="" className="size-12 rounded-2xl bg-white object-contain p-1 shadow-sm ring-1 ring-emerald-900/10" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">Online pickup</p>
                <p className="truncate font-display text-base font-bold text-[#0b3b2c]">{storeName}</p>
              </div>
            </div>

            <h3 className="relative mt-8 font-display text-[34px] font-extrabold leading-[1.05] tracking-tight text-[#0b3b2c]">
              Order ahead.<br /><span className="text-emerald-600">Skip the wait.</span>
            </h3>

            <div className="relative mx-auto mt-4 w-full max-w-[400px]">
              <BasketVisual photos={basketPhotos} note={false} />
            </div>

            <div className="relative mt-auto pt-6">
              {basketCount > 0 ? (
                <div className="flex items-center gap-3 rounded-2xl bg-white/85 p-3.5 shadow-sm ring-1 ring-emerald-900/10 backdrop-blur">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-800 text-white"><ShoppingBasket className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#0b3b2c]">Your basket is saved</p>
                    <p className="text-xs text-slate-500">{basketCount} {basketCount === 1 ? 'item' : 'items'} waiting for checkout</p>
                  </div>
                  <span className="font-display text-lg font-bold text-[#0b3b2c]">{basketTotal}</span>
                </div>
              ) : (
                <ul className="grid grid-cols-3 gap-2 text-[11px] font-semibold text-[#0b3b2c]">
                  <Perk icon={<ShoppingBasket />} label="Order ahead" />
                  <Perk icon={<Clock3 />} label="Quick pickup" />
                  <Perk icon={<Wallet />} label="Pay in store" />
                </ul>
              )}
            </div>
          </aside>

          {/* ───── Form side ───── */}
          <div className="relative flex flex-col px-6 pb-8 pt-6 sm:px-10 sm:pb-10 sm:pt-9 lg:px-12">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close sign in"
              className="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 disabled:opacity-40 sm:right-5 sm:top-5"
            >
              <X className="size-5" />
            </button>

            {/* Compact brand strip on small screens */}
            <div className="mb-6 flex items-center gap-3 pr-12 lg:hidden">
              <img src="/brand/minimart-logo.svg" alt="" className="size-11 rounded-xl bg-emerald-50 object-contain p-1 ring-1 ring-emerald-100" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Online pickup</p>
                <p className="truncate font-display text-base font-bold text-slate-900">{storeName}</p>
              </div>
            </div>

            <div className="my-auto w-full max-w-[410px] self-center lg:self-auto">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-800 ring-1 ring-emerald-700/15">
                <span className="size-1.5 rounded-full bg-emerald-500" /> Customer account
              </span>
              <h2 id="shop-auth-title" key={`title-${mode}`} className="auth-fade mt-4 font-display text-[30px] font-extrabold leading-tight tracking-tight text-[#0b3b2c]">
                {register ? 'Create your account' : 'Welcome back'}
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-slate-500">
                {register ? 'It takes a minute. Place pickup orders and follow their status.' : 'Sign in to place your order and track your pickups.'}
              </p>

              <div role="radiogroup" aria-label="Account" className="relative mt-6 grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
                <span
                  aria-hidden
                  className={`absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-xl bg-white shadow-sm ring-1 ring-slate-900/5 transition-transform duration-300 ease-out ${register ? 'translate-x-full' : ''}`}
                />
                {(['login', 'register'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => switchTo(m)}
                    className={`relative rounded-xl py-2.5 text-sm font-semibold transition-colors ${mode === m ? 'text-emerald-800' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {m === 'login' ? 'Sign in' : 'Create account'}
                  </button>
                ))}
              </div>

              <form key={`form-${mode}`} onSubmit={onSubmit} className="auth-fade mt-6 space-y-4">
                {error && (
                  <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
                  </p>
                )}

                {register && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="shop-name" label="Full name" icon={<UserRound />}>
                      {(cls) => <input id="shop-name" name="name" required maxLength={255} autoComplete="name" placeholder="Juan Dela Cruz" className={cls} autoFocus />}
                    </Field>
                    <Field id="shop-phone" label="Mobile number" icon={<Phone />}>
                      {(cls) => <input id="shop-phone" name="phone" type="tel" required maxLength={30} inputMode="tel" autoComplete="tel" placeholder="09XX XXX XXXX" className={cls} />}
                    </Field>
                  </div>
                )}

                <Field id="shop-email" label="Email address" icon={<Mail />}>
                  {(cls) => <input id="shop-email" name="email" type="email" required autoComplete="email" placeholder="you@email.com" className={cls} autoFocus={!register} />}
                </Field>

                <Field
                  id="shop-password"
                  label="Password"
                  icon={<KeyRound />}
                  hint={register ? (password.length > 0 && password.length < 10 ? `${10 - password.length} more characters needed` : 'Use at least 10 characters.') : undefined}
                  hintTone={register && password.length > 0 && password.length < 10 ? 'warn' : 'muted'}
                  trailing={
                    <button type="button" onClick={() => setShowPassword((v) => !v)} className="grid size-9 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  }
                >
                  {(cls) => (
                    <input
                      id="shop-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={register ? 10 : 1}
                      autoComplete={register ? 'new-password' : 'current-password'}
                      placeholder={register ? 'Create a password' : 'Enter your password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyUp={trackCaps}
                      onKeyDown={trackCaps}
                      onBlur={() => setCapsLock(false)}
                      className={cls}
                    />
                  )}
                </Field>
                {register && password.length > 0 && <StrengthBar length={password.length} />}

                {register && (
                  <Field id="shop-password2" label="Confirm password" icon={<KeyRound />}>
                    {(cls) => <input id="shop-password2" name="password_confirmation" type={showPassword ? 'text' : 'password'} required minLength={10} autoComplete="new-password" placeholder="Repeat the password" className={cls} />}
                  </Field>
                )}

                {capsLock && <p className="-mt-1 flex items-center gap-1.5 text-xs font-medium text-amber-700"><TriangleAlert className="size-3.5" /> Caps Lock is on</p>}

                <button
                  type="submit"
                  disabled={busy}
                  className="group relative !mt-6 flex h-[52px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-b from-emerald-700 to-emerald-900 font-semibold text-white shadow-lg shadow-emerald-900/25 transition hover:from-emerald-600 hover:to-emerald-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200 disabled:cursor-wait disabled:opacity-60"
                >
                  <span className="absolute inset-x-0 top-0 h-px bg-white/25" />
                  {busy
                    ? <><Loader2 className="size-5 animate-spin" /> {register ? 'Creating account…' : 'Signing in…'}</>
                    : <>{register ? 'Create account' : basketCount ? 'Sign in and continue' : 'Sign in'} <ArrowRight className="size-4 transition group-hover:translate-x-0.5" /></>}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-slate-500">
                {register ? 'Already have an account? ' : 'New to the shop? '}
                <button type="button" onClick={() => switchTo(register ? 'login' : 'register')} className="font-semibold text-emerald-700 underline-offset-4 hover:text-emerald-800 hover:underline">
                  {register ? 'Sign in' : 'Create a free account'}
                </button>
              </p>

              <p className="mt-6 flex items-start justify-center gap-2 border-t border-slate-100 pt-5 text-center text-[11px] leading-relaxed text-slate-400">
                <Lock className="mt-px size-3.5 shrink-0" />
                Your account is only used for {storeName}’s online pickup orders.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Perk({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <li className="flex items-center justify-center gap-1.5 rounded-xl bg-white/80 px-2 py-2.5 shadow-sm ring-1 ring-emerald-900/10">
      <span className="text-emerald-600 [&>svg]:size-4">{icon}</span>
      {label}
    </li>
  );
}

/** Length-only guidance, matching the 10-character rule the server enforces. */
function StrengthBar({ length }: { length: number }) {
  const level = length < 10 ? 1 : length < 14 ? 2 : 3;
  const colors = ['bg-amber-400', 'bg-emerald-500', 'bg-emerald-600'];
  return (
    <div className="-mt-2 flex items-center gap-2" aria-hidden>
      <div className="grid flex-1 grid-cols-3 gap-1">{[1, 2, 3].map((i) => <span key={i} className={`h-1 rounded-full transition-colors ${i <= level ? colors[level - 1] : 'bg-slate-200'}`} />)}</div>
      <span className="w-14 text-right text-[11px] font-medium text-slate-500">{['Too short', 'Good', 'Strong'][level - 1]}</span>
    </div>
  );
}

function Field({ id, label, icon, trailing, hint, hintTone = 'muted', children }: {
  id: string;
  label: string;
  icon: ReactNode;
  trailing?: ReactNode;
  hint?: string;
  hintTone?: 'muted' | 'warn';
  children: (inputClass: string) => ReactNode;
}) {
  const inputClass = `peer h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-11 ${trailing ? 'pr-12' : 'pr-3.5'} text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-600/10`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</label>
      <div className="relative">
        {children(inputClass)}
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition peer-focus:text-emerald-600 [&>svg]:size-4">{icon}</span>
        {trailing && <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</span>}
      </div>
      {hint && <p className={`mt-1.5 text-[11px] ${hintTone === 'warn' ? 'font-medium text-amber-700' : 'text-slate-500'}`}>{hint}</p>}
    </div>
  );
}
