import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, Phone, ShieldCheck, ShoppingBasket, TriangleAlert, UserRound, X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';

type Mode = 'login' | 'register';

/**
 * Full-screen customer sign-in / sign-up for the online shop. It opens over the shop so the basket survives.
 * Field names match the shop API (name, phone, email, password, password_confirmation); the parent posts the form as-is.
 */
export function CustomerAuthDialog({ open, onClose, storeName, mode, onModeChange, onSubmit, busy, error, basketCount, basketTotal }: {
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

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-[6px]" onClick={() => !busy && onClose()} aria-hidden />
      <div className="relative flex min-h-full items-stretch justify-center sm:items-center sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shop-auth-title"
          className="auth-fade relative grid w-full max-w-[1040px] overflow-hidden bg-white shadow-[0_40px_120px_-30px_rgba(2,44,34,0.65)] sm:rounded-[28px] sm:ring-1 sm:ring-white/10 lg:grid-cols-[1fr_1.02fr]"
        >
          <BrandPanel storeName={storeName} basketCount={basketCount} basketTotal={basketTotal} />

          {/* Form side */}
          <div className="relative flex flex-col px-6 pb-8 pt-6 sm:px-10 sm:pb-10 sm:pt-8 lg:px-12">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close sign in"
              className="absolute right-4 top-4 z-10 grid size-10 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 sm:right-5 sm:top-5"
            >
              <X className="size-5" />
            </button>

            {/* Compact brand strip on small screens */}
            <div className="mb-6 flex items-center gap-3 pr-12 lg:hidden">
              <img src="/brand/minimart-logo.svg" alt="" className="size-11 rounded-xl bg-brand-50 object-contain p-1 ring-1 ring-brand-100" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-700">Online pickup</p>
                <p className="truncate font-display text-base font-bold text-slate-900">{storeName}</p>
              </div>
            </div>

            <div className="my-auto w-full max-w-[400px] self-center lg:self-auto">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-700">Customer account</p>
              <h2 id="shop-auth-title" key={mode} className="auth-fade mt-2 font-display text-[28px] font-bold leading-tight tracking-tight text-slate-900">
                {register ? 'Create your account' : 'Sign in to your account'}
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-slate-500">
                {register ? 'Set up an account to place pickup orders and follow their status.' : 'Welcome back. Sign in to place your order and track your pickups.'}
              </p>

              <div role="radiogroup" aria-label="Account" className="relative mt-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
                <span
                  aria-hidden
                  className={`absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-white shadow-sm ring-1 ring-slate-900/5 transition-transform duration-300 ease-out ${register ? 'translate-x-full' : ''}`}
                />
                {(['login', 'register'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => switchTo(m)}
                    className={`relative rounded-lg py-2.5 text-sm font-semibold transition-colors ${mode === m ? 'text-brand-800' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {m === 'login' ? 'Sign in' : 'Create account'}
                  </button>
                ))}
              </div>

              <form key={mode} onSubmit={onSubmit} className="auth-fade mt-6 space-y-4">
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

                {register && (
                  <Field id="shop-password2" label="Confirm password" icon={<KeyRound />}>
                    {(cls) => <input id="shop-password2" name="password_confirmation" type={showPassword ? 'text' : 'password'} required minLength={10} autoComplete="new-password" placeholder="Repeat the password" className={cls} />}
                  </Field>
                )}

                {capsLock && <p className="-mt-1 flex items-center gap-1.5 text-xs font-medium text-amber-700"><TriangleAlert className="size-3.5" /> Caps Lock is on</p>}

                <button
                  type="submit"
                  disabled={busy}
                  className="group relative !mt-6 flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-brand-700 font-semibold text-white shadow-lg shadow-brand-900/20 transition hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 disabled:cursor-wait disabled:opacity-60"
                >
                  <span className="absolute inset-x-0 top-0 h-px bg-white/25" />
                  {busy
                    ? <><Loader2 className="size-5 animate-spin" /> {register ? 'Creating account…' : 'Signing in…'}</>
                    : <>{register ? 'Create account' : basketCount ? 'Sign in and continue' : 'Sign in'} <ArrowRight className="size-4 transition group-hover:translate-x-0.5" /></>}
                </button>
              </form>

              <div className="my-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                {register ? 'Have an account?' : 'New here?'}
                <span className="h-px flex-1 bg-slate-200" />
              </div>
              <button
                type="button"
                onClick={() => switchTo(register ? 'login' : 'register')}
                className="flex h-11 w-full items-center justify-center rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50/60 hover:text-brand-800"
              >
                {register ? 'Sign in instead' : 'Create a customer account'}
              </button>

              <p className="mt-6 flex items-start gap-2 text-[11px] leading-relaxed text-slate-400">
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

function BrandPanel({ storeName, basketCount, basketTotal }: { storeName: string; basketCount: number; basketTotal: string }) {
  return (
    <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900 p-10 text-white lg:flex lg:flex-col">
      <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-sun-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-20 size-80 rounded-full bg-brand-400/20 blur-3xl" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '36px 36px', maskImage: 'radial-gradient(ellipse at 30% 20%, #000 20%, transparent 75%)' }}
      />

      <div className="relative flex items-center gap-3">
        <img src="/brand/minimart-logo.svg" alt="" className="size-14 rounded-2xl bg-white object-contain p-1.5 shadow-lg shadow-black/20" />
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sun-300">Online pickup</p>
          <p className="truncate font-display text-lg font-bold leading-tight">{storeName}</p>
        </div>
      </div>

      <div className="relative mt-12">
        <h3 className="font-display text-[34px] font-bold leading-[1.1] tracking-tight">
          Order ahead.<br /><span className="text-sun-300">Skip the wait.</span>
        </h3>
        <p className="mt-3 max-w-sm text-sm leading-6 text-brand-100/80">
          Build your basket online, choose a branch, and collect it when it’s ready.
        </p>
      </div>

      <ol className="relative mt-9 space-y-0">
        <Step n={1} title="Choose your items" text="Browse the store and add what you need." />
        <Step n={2} title="The store prepares it" text="Follow your order status from your account." />
        <Step n={3} title="Pick up and pay in store" text="Pay at the counter when you collect." last />
      </ol>

      <div className="relative mt-auto pt-10">
        {basketCount > 0 ? (
          <div className="flex items-center gap-3 rounded-2xl bg-white/[0.08] p-4 ring-1 ring-white/15 backdrop-blur">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-sun-400 text-brand-900"><ShoppingBasket className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Your basket is saved</p>
              <p className="text-xs text-brand-100/75">{basketCount} {basketCount === 1 ? 'item' : 'items'} waiting for checkout</p>
            </div>
            <span className="font-display text-lg font-bold">{basketTotal}</span>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-brand-100/70">
            <ShieldCheck className="size-4 text-sun-300" /> No online payment needed. You pay at pickup.
          </p>
        )}
      </div>
    </aside>
  );
}

function Step({ n, title, text, last }: { n: number; title: string; text: string; last?: boolean }) {
  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      {!last && <span className="absolute left-[17px] top-10 h-[calc(100%-2.75rem)] w-px bg-white/20" aria-hidden />}
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 font-display text-sm font-bold text-sun-300 ring-1 ring-white/20">{n}</span>
      <div className="pt-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-brand-100/70">{text}</p>
      </div>
    </li>
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
  const inputClass = `h-12 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-11 ${trailing ? 'pr-12' : 'pr-3.5'} text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-100`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 [&>svg]:size-4">{icon}</span>
        {children(inputClass)}
        {trailing && <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</span>}
      </div>
      {hint && <p className={`mt-1.5 text-[11px] ${hintTone === 'warn' ? 'font-medium text-amber-700' : 'text-slate-500'}`}>{hint}</p>}
    </div>
  );
}
