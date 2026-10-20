import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock3, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, Phone, ShieldCheck, ShoppingBasket, TriangleAlert, UserRound, Wallet, X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { PhotoItem } from './ShopVisuals';
import { ApiError, api, errorMessage } from '../../lib/api';
import { useLegalHref } from '../../components/LegalLinks';

type Mode = 'login' | 'register';

/**
 * Full-screen customer sign-in / sign-up for the online shop. It opens over the shop so the basket survives.
 * Field names match the shop API (name, phone, email, password, password_confirmation); the parent posts the form as-is.
 */
export function CustomerAuthDialog({ open, onClose, storeName, mode, onModeChange, onSubmit, busy, error, basketCount, basketTotal, apiBase, verifying, onVerified, onCancelVerify }: {
  open: boolean;
  /** Set after sign-up: the email waiting for its 6-digit code. */
  verifying?: { email: string; resendIn: number; remember: boolean } | null;
  onVerified?: () => void;
  onCancelVerify?: () => void;
  /** Shop API base, e.g. `/shop/aling-nena-mini-mart`, used by the forgot-password steps. */
  apiBase: string;
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
  const legalHref = useLegalHref();
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [password, setPassword] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [prefillEmail, setPrefillEmail] = useState('');
  const [notice, setNotice] = useState('');
  const register = mode === 'register';
  useEffect(() => { if (!open) { setRecovering(false); setNotice(''); } }, [open]);
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
      <div className="fixed inset-0 bg-[#062a1d]/55 backdrop-blur-md" onClick={() => !busy && onClose()} aria-hidden />
      <div className="relative flex min-h-full items-stretch justify-center sm:items-center sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shop-auth-title"
          className="auth-fade relative grid w-full max-w-[900px] overflow-hidden bg-white shadow-[0_30px_80px_-30px_rgba(2,44,34,0.55)] sm:rounded-2xl lg:grid-cols-[340px_1fr]"
        >
          {/* ───── Brand side (computers): slim, dark, three reasons to sign up ───── */}
          <aside className="relative hidden flex-col overflow-hidden bg-[#0b3b2c] p-8 text-white lg:flex">
            <span aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-emerald-400/20 blur-3xl" />
            <span aria-hidden className="pointer-events-none absolute -bottom-28 -left-20 size-72 rounded-full bg-amber-300/10 blur-3xl" />
            <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(180deg,transparent,#000_40%,#000_70%,transparent)]" />

            <div className="relative flex items-center gap-3">
              <img src="/brand/minimart-logo.svg" alt="" className="size-11 rounded-xl bg-white object-contain p-1" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">Online shop</p>
                <p className="truncate font-display text-[15px] font-bold">{storeName}</p>
              </div>
            </div>

            <h3 className="relative mt-10 font-display text-[26px] font-bold leading-tight tracking-tight">
              Your neighborhood store, <span className="text-amber-300">on your phone.</span>
            </h3>
            <p className="relative mt-2 text-sm leading-6 text-emerald-50/70">One account for pickup and delivery orders at every branch.</p>

            <ul className="relative mt-8 space-y-4">
              {[
                { icon: <ShoppingBasket />, title: 'Order ahead', text: 'Your basket is ready when you arrive.' },
                { icon: <Clock3 />, title: 'Track every order', text: 'See when it is confirmed, prepared and ready.' },
                { icon: <Wallet />, title: 'Pay when you get it', text: 'Cash at pickup or on delivery. No card needed.' },
              ].map((item) => (
                <li key={item.title} className="flex gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 text-amber-300 ring-1 ring-white/10 [&>svg]:size-[18px]">{item.icon}</span>
                  <span>
                    <span className="block text-sm font-semibold">{item.title}</span>
                    <span className="block text-xs leading-5 text-emerald-50/65">{item.text}</span>
                  </span>
                </li>
              ))}
            </ul>


            {/* A sample of what signed-in customers see: their order moving through the steps. */}
            <div aria-hidden className="relative mt-8">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-200/60">How your order shows up</p>
              <div className="rounded-2xl bg-white/[.07] p-4 ring-1 ring-white/10 backdrop-blur-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-white">ON-20261021-0042</p>
                    <p className="text-[11px] text-emerald-50/55">Pickup · Main Branch</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-300 px-2.5 py-1 text-[10px] font-bold text-[#0b3b2c]">Ready for pickup</span>
                </div>
                <ol className="mt-4 grid grid-cols-4">
                  {['Placed', 'Confirmed', 'Preparing', 'Ready'].map((step, i) => (
                    <li key={step} className="relative flex flex-col items-center text-center">
                      {i > 0 && <span className="absolute right-1/2 top-[11px] h-0.5 w-full bg-emerald-400/70" />}
                      <span className={`relative grid size-6 place-items-center rounded-full ${i === 3 ? 'bg-amber-300 text-[#0b3b2c] ring-4 ring-amber-300/20' : 'bg-emerald-400 text-[#0b3b2c]'}`}>
                        <Check className="size-3.5" strokeWidth={3} />
                      </span>
                      <span className="mt-1.5 text-[10px] font-medium text-emerald-50/70">{step}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs">
                  <span className="text-emerald-50/60">3 items</span>
                  <span className="font-display font-bold text-white">₱186.50</span>
                </div>
              </div>
            </div>

            <div className="relative mt-auto pt-8">
              {basketCount > 0 ? (
                <div className="flex items-center gap-3 rounded-xl bg-white/10 p-3 ring-1 ring-white/15">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-amber-300 text-[#0b3b2c]"><ShoppingBasket className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Your basket is saved</p>
                    <p className="text-xs text-emerald-50/65">{basketCount} {basketCount === 1 ? 'item' : 'items'} waiting for checkout</p>
                  </div>
                  <span className="font-display text-base font-bold">{basketTotal}</span>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-xs text-emerald-50/60"><ShieldCheck className="size-4 text-emerald-300" /> Your details are only used by {storeName}.</p>
              )}
            </div>
          </aside>

          {/* ───── Form side ───── */}
          <div className="relative flex min-h-full flex-col lg:px-10 lg:pb-8 lg:pt-8">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close sign in"
              className="absolute right-4 top-3.5 z-20 grid size-9 place-items-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 disabled:opacity-40 lg:right-5 lg:top-5"
            >
              <X className="size-5" />
            </button>

            {/* Phones, tablets and the app: a simple top bar, like a native app screen. */}
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5 pr-16 sm:px-8 lg:hidden">
              <img src="/brand/minimart-logo.svg" alt="" className="size-10 rounded-xl bg-emerald-50 object-contain p-1 ring-1 ring-emerald-100" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">Online shop</p>
                <p className="truncate font-display text-[15px] font-bold text-[#0b3b2c]">{storeName}</p>
              </div>
              {basketCount > 0 && (
                <span className="ml-auto shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-100">
                  {basketCount} in basket · {basketTotal}
                </span>
              )}
            </div>

            <div className="relative flex flex-1 flex-col bg-white px-5 pb-8 pt-6 sm:px-8 sm:pb-10 lg:p-0">
            <div className="w-full max-w-[410px] self-center lg:my-auto lg:self-auto">
              {verifying ? (
                <EmailVerification apiBase={apiBase} email={verifying.email} remember={verifying.remember} initialResendIn={verifying.resendIn}
                  onBack={() => onCancelVerify?.()} onDone={() => onVerified?.()} />
              ) : recovering ? (
                <PasswordRecovery
                  apiBase={apiBase}
                  initialEmail={prefillEmail}
                  onBack={() => setRecovering(false)}
                  onDone={(email) => {
                    setPrefillEmail(email);
                    setNotice('Your password was changed. Sign in with your new password.');
                    setRecovering(false);
                    switchTo('login');
                  }}
                />
              ) : <>
              <h2 id="shop-auth-title" key={`title-${mode}`} className="auth-fade font-display text-2xl font-bold leading-tight tracking-tight text-[#0b3b2c]">
                {register ? 'Create your account' : 'Welcome back'}
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-slate-500">
                {register ? 'It takes a minute. Place pickup orders and follow their status.' : 'Sign in to place your order and track your pickups.'}
              </p>
              {register && <p className="mt-2 text-xs leading-5 text-slate-500">Your store uses your account details to manage orders. See the <Link to={legalHref('privacy')} className="font-semibold text-emerald-800 underline underline-offset-2">privacy notice</Link> and <Link to={legalHref('terms')} className="font-semibold text-emerald-800 underline underline-offset-2">terms</Link>. The store's own refund rules apply to purchases.</p>}

              <div role="radiogroup" aria-label="Account" className="relative mt-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
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
                    className={`relative rounded-lg py-2 text-sm font-semibold transition-colors ${mode === m ? 'text-emerald-800' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {m === 'login' ? 'Sign in' : 'Create account'}
                  </button>
                ))}
              </div>

              <form key={`form-${mode}`} onSubmit={(e) => { setNotice(''); onSubmit(e); }} className="auth-fade mt-6 space-y-4">
                {notice && !error && (
                  <p role="status" className="sp-alert-in flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> {notice}
                  </p>
                )}
                {error && (
                  <p role="alert" className="sp-alert-in sp-alert-error flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
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
                  {(cls) => <input id="shop-email" name="email" type="email" required autoComplete="email" placeholder="you@email.com" className={cls} defaultValue={register ? undefined : prefillEmail} autoFocus={!register && !prefillEmail} />}
                </Field>

                <Field
                  id="shop-password"
                  label="Password"
                  icon={<KeyRound />}
                  aside={register ? undefined : (
                    <button
                      type="button"
                      onClick={() => {
                        const typed = (document.getElementById('shop-email') as HTMLInputElement | null)?.value.trim() ?? '';
                        setPrefillEmail(typed);
                        setNotice('');
                        setRecovering(true);
                      }}
                      className="text-xs font-semibold text-emerald-700 underline-offset-4 hover:text-emerald-800 hover:underline"
                    >
                      Forgot password?
                    </button>
                  )}
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
                      autoFocus={!register && !!prefillEmail}
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

                {register && (
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-emerald-50/60 p-3 text-sm text-slate-700 ring-1 ring-emerald-100">
                    <input type="checkbox" name="accept_terms" value="1" required className="mt-0.5 size-4 shrink-0 rounded border-slate-300 accent-emerald-700" />
                    <span className="text-xs leading-5">I agree to the <Link to={legalHref('terms')} className="font-semibold text-emerald-800 underline underline-offset-2">terms</Link> and allow {storeName} to use my name, mobile number, email and delivery address to process my orders, as described in the <Link to={legalHref('privacy')} className="font-semibold text-emerald-800 underline underline-offset-2">privacy notice</Link>.</span>
                  </label>
                )}

                {/* The hidden "0" is sent when the box is unticked; a ticked box's "1" comes later and wins. */}
                <input type="hidden" name="remember" value="0" />
                <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700">
                  <input type="checkbox" name="remember" value="1" defaultChecked className="mt-0.5 size-4 rounded border-slate-300 accent-emerald-700" />
                  <span><span className="font-semibold">Keep me signed in</span><span className="block text-xs text-slate-500">Untick on a shared or public computer.</span></span>
                </label>

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
              </>}
            </div>
          </div>
            </div>
        </div>
      </div>
    </div>
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

function Field({ id, label, icon, trailing, hint, hintTone = 'muted', aside, children }: {
  id: string;
  label: string;
  icon: ReactNode;
  trailing?: ReactNode;
  hint?: string;
  hintTone?: 'muted' | 'warn';
  /** Shown at the right end of the label row, e.g. a "Forgot password?" link. */
  aside?: ReactNode;
  children: (inputClass: string) => ReactNode;
}) {
  const inputClass = `peer h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-11 ${trailing ? 'pr-12' : 'pr-3.5'} text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-600/10`;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-xs font-semibold text-slate-700">{label}</label>
        {aside}
      </div>
      <div className="relative">
        {children(inputClass)}
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition peer-focus:text-emerald-600 [&>svg]:size-4">{icon}</span>
        {trailing && <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</span>}
      </div>
      {hint && <p className={`mt-1.5 text-[11px] ${hintTone === 'warn' ? 'font-medium text-amber-700' : 'text-slate-500'}`}>{hint}</p>}
    </div>
  );
}

type RecoveryStep = 'email' | 'code' | 'password';

/** Forgot password: email → 6-digit code from the inbox → new password. */
function PasswordRecovery({ apiBase, initialEmail, onBack, onDone }: {
  apiBase: string;
  initialEmail: string;
  onBack: () => void;
  onDone: (email: string) => void;
}) {
  const [step, setStep] = useState<RecoveryStep>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await action(); } catch (e) { setError(e instanceof ApiError ? e.field('code') ?? e.field('password') ?? e.field('email') ?? e.message : errorMessage(e)); } finally { setBusy(false); }
  }
  const sendCode = () => run(async () => {
    const result = await api<{ resend_after_seconds: number }>(`${apiBase}/password/forgot`, { method: 'POST', body: { email: email.trim() } });
    setCode('');
    setResendIn(result.resend_after_seconds ?? 60);
    setStep('code');
  });
  const verify = () => run(async () => {
    await api(`${apiBase}/password/verify`, { method: 'POST', body: { email: email.trim(), code } });
    setStep('password');
  });
  const save = () => run(async () => {
    await api(`${apiBase}/password/reset`, { method: 'POST', body: { email: email.trim(), code, password, password_confirmation: confirm } });
    onDone(email.trim());
  });

  const index = { email: 0, code: 1, password: 2 }[step];
  const titles: Record<RecoveryStep, [string, ReactNode]> = {
    email: ['Forgot your password?', 'Enter the email you shop with and we will send you a 6-digit code.'],
    code: ['Check your email', <>We sent a 6-digit code to <b className="text-slate-700">{maskEmail(email.trim())}</b>. It expires in 15 minutes.</>],
    password: ['Create a new password', 'Use at least 10 characters. You will sign in with it next time.'],
  };
  const tooShort = password.length > 0 && password.length < 10;
  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <div>
      <button type="button" onClick={step === 'email' ? onBack : () => { setError(''); setStep(step === 'password' ? 'code' : 'email'); }} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition hover:text-slate-800">
        <ArrowLeft className="size-4" /> {step === 'email' ? 'Back to sign in' : 'Back'}
      </button>

      <ol className="mt-5 flex items-center gap-2" aria-label={`Step ${index + 1} of 3`}>
        {['Email', 'Code', 'New password'].map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold transition ${i < index ? 'bg-emerald-600 text-white' : i === index ? 'bg-emerald-800 text-white ring-4 ring-emerald-100' : 'bg-slate-100 text-slate-400'}`}>
              {i < index ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className={`hidden text-xs font-semibold sm:block ${i <= index ? 'text-slate-800' : 'text-slate-400'}`}>{label}</span>
            {i < 2 && <span className={`h-0.5 flex-1 rounded-full ${i < index ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
          </li>
        ))}
      </ol>

      <div key={step} className="auth-fade">
        <span className="mt-6 grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-700/10">
          {step === 'email' ? <Mail className="size-5" /> : step === 'code' ? <ShieldCheck className="size-5" /> : <KeyRound className="size-5" />}
        </span>
        <h2 id="shop-auth-title" className="mt-4 font-display text-[28px] font-extrabold leading-tight tracking-tight text-[#0b3b2c]">{titles[step][0]}</h2>
        <p className="mt-1.5 text-sm leading-6 text-slate-500">{titles[step][1]}</p>

        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => { e.preventDefault(); if (step === 'email') void sendCode(); else if (step === 'code') void verify(); else void save(); }}
        >
          {error && (
            <p role="alert" className="sp-alert-in sp-alert-error flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}

          {step === 'email' && (
            <Field id="reset-email" label="Email address" icon={<Mail />}>
              {(cls) => <input id="reset-email" type="email" required autoFocus autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} className={cls} />}
            </Field>
          )}

          {step === 'code' && (
            <>
              <CodeInput value={code} onChange={(v) => { setCode(v); setError(''); }} disabled={busy} />
              <p className="text-center text-sm text-slate-500">
                Didn&apos;t get it?{' '}
                {resendIn > 0
                  ? <span className="font-medium text-slate-400">Resend in {resendIn}s</span>
                  : <button type="button" disabled={busy} onClick={() => void sendCode()} className="font-semibold text-emerald-700 hover:underline disabled:opacity-50">Resend code</button>}
                <span className="mx-1.5 text-slate-300">·</span>
                <button type="button" onClick={() => { setError(''); setStep('email'); }} className="font-semibold text-emerald-700 hover:underline">Use another email</button>
              </p>
              <p className="text-center text-[11px] text-slate-400">Check your spam folder too.</p>
            </>
          )}

          {step === 'password' && (
            <>
              <Field
                id="reset-password"
                label="New password"
                icon={<KeyRound />}
                hint={tooShort ? `${10 - password.length} more characters needed` : undefined}
                hintTone="warn"
                trailing={
                  <button type="button" onClick={() => setShow((v) => !v)} className="grid size-9 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" aria-label={show ? 'Hide password' : 'Show password'}>
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                }
              >
                {(cls) => <input id="reset-password" type={show ? 'text' : 'password'} required minLength={10} autoFocus autoComplete="new-password" placeholder="Create a new password" value={password} onChange={(e) => setPassword(e.target.value)} className={cls} />}
              </Field>
              {password.length > 0 && <StrengthBar length={password.length} />}
              <Field id="reset-password2" label="Confirm new password" icon={<KeyRound />} hint={mismatch ? 'The passwords do not match yet.' : undefined} hintTone="warn">
                {(cls) => <input id="reset-password2" type={show ? 'text' : 'password'} required minLength={10} autoComplete="new-password" placeholder="Repeat the new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={cls} />}
              </Field>
            </>
          )}

          <button
            type="submit"
            disabled={busy || (step === 'email' && !email.trim()) || (step === 'code' && code.length !== 6) || (step === 'password' && (password.length < 10 || confirm !== password))}
            className="group relative !mt-6 flex h-[52px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-b from-emerald-700 to-emerald-900 font-semibold text-white shadow-lg shadow-emerald-900/25 transition hover:from-emerald-600 hover:to-emerald-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy
              ? <><Loader2 className="size-5 animate-spin" /> Please wait…</>
              : <>{step === 'email' ? 'Send code' : step === 'code' ? 'Verify code' : 'Save new password'} <ArrowRight className="size-4 transition group-hover:translate-x-0.5" /></>}
          </button>
        </form>
      </div>
    </div>
  );
}

/** After sign-up: enter the 6-digit code emailed to the customer to activate the account. */
function EmailVerification({ apiBase, email, remember, initialResendIn, onBack, onDone }: {
  apiBase: string;
  email: string;
  remember: boolean;
  initialResendIn: number;
  onBack: () => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const [resendIn, setResendIn] = useState(initialResendIn);
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  async function verify(value = code) {
    if (value.length !== 6) return;
    setBusy(true);
    setError('');
    try {
      await api(`${apiBase}/verify-email`, { method: 'POST', body: { email, code: value, remember } });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.field('code') ?? e.message : errorMessage(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ resend_after_seconds: number }>(`${apiBase}/verify-email/resend`, { method: 'POST', body: { email } });
      setResendIn(r.resend_after_seconds ?? 60);
      setSent('A new code is on its way.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition hover:text-slate-800">
        <ArrowLeft className="size-4" /> Change my details
      </button>

      <ol className="mt-5 flex items-center gap-2" aria-label="Step 2 of 2">
        <li className="flex flex-1 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><Check className="size-3.5" strokeWidth={3} /></span>
          <span className="hidden text-xs font-semibold text-slate-800 sm:block">Your details</span>
          <span className="h-0.5 flex-1 rounded-full bg-emerald-500" />
        </li>
        <li className="flex items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-800 text-xs font-bold text-white ring-4 ring-emerald-100">2</span>
          <span className="hidden text-xs font-semibold text-slate-800 sm:block">Confirm email</span>
        </li>
      </ol>

      <div className="auth-fade">
        <span className="relative mt-6 grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-700/10">
          <Mail className="size-6" />
          <span className="absolute -right-1 -top-1 size-3.5 animate-ping rounded-full bg-emerald-400/70" />
          <span className="absolute -right-1 -top-1 size-3.5 rounded-full bg-emerald-500 ring-2 ring-white" />
        </span>
        <h2 id="shop-auth-title" className="mt-4 font-display text-[28px] font-extrabold leading-tight tracking-tight text-[#0b3b2c]">Check your email</h2>
        <p className="mt-1.5 text-sm leading-6 text-slate-500">We sent a 6-digit code to <b className="text-slate-700">{maskEmail(email)}</b>. Enter it to finish creating your account. It expires in 15 minutes.</p>

        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          {error && (
            <p role="alert" className="sp-alert-in sp-alert-error flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}
          {sent && !error && <p role="status" className="sp-alert-in flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-200"><CheckCircle2 className="size-4" /> {sent}</p>}

          {/* Filling the last box checks the code straight away. */}
          <CodeInput value={code} onChange={(v) => { setCode(v); setError(''); setSent(''); if (v.length === 6) void verify(v); }} disabled={busy} />

          <p className="text-center text-sm text-slate-500">
            Didn&apos;t get it?{' '}
            {resendIn > 0
              ? <span className="font-medium text-slate-400">Resend in {resendIn}s</span>
              : <button type="button" disabled={busy} onClick={() => void resend()} className="font-semibold text-emerald-700 hover:underline disabled:opacity-50">Resend code</button>}
            <span className="mx-1.5 text-slate-300">·</span>
            <button type="button" onClick={onBack} className="font-semibold text-emerald-700 hover:underline">Wrong email?</button>
          </p>
          <p className="text-center text-[11px] text-slate-400">Check your Spam or Promotions folder too.</p>

          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="group relative !mt-6 flex h-[52px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-b from-emerald-700 to-emerald-900 font-semibold text-white shadow-lg shadow-emerald-900/25 transition hover:from-emerald-600 hover:to-emerald-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <><Loader2 className="size-5 animate-spin" /> Checking…</> : <>Confirm and continue <ArrowRight className="size-4 transition group-hover:translate-x-0.5" /></>}
          </button>
        </form>
      </div>
    </div>
  );
}

/** Six boxes for a one-time code: typing moves forward, Backspace moves back, pasting fills them all. */
function CodeInput({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const boxes = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  const focus = (i: number) => (document.getElementById(`reset-code-${Math.max(0, Math.min(5, i))}`) as HTMLInputElement | null)?.focus();
  const setAt = (i: number, digit: string) => {
    const next = boxes.slice();
    next[i] = digit;
    onChange(next.join('').slice(0, 6));
  };

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="6-digit code">
      {boxes.map((digit, i) => (
        <input
          key={i}
          id={`reset-code-${i}`}
          value={digit}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          autoFocus={i === 0}
          maxLength={1}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, '').slice(-1);
            setAt(i, d);
            if (d) focus(i + 1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digit) { e.preventDefault(); setAt(i - 1, ''); focus(i - 1); }
            if (e.key === 'ArrowLeft') focus(i - 1);
            if (e.key === 'ArrowRight') focus(i + 1);
          }}
          onPaste={(e) => {
            const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
            if (!digits) return;
            e.preventDefault();
            onChange(digits);
            focus(digits.length);
          }}
          className={`h-14 w-full min-w-0 rounded-xl border text-center font-display text-2xl font-bold text-slate-900 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-600/10 disabled:opacity-60 ${digit ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200 bg-slate-50/70'}`}
        />
      ))}
    </div>
  );
}

/** a••••@gmail.com — enough for the customer to recognise the address without spelling it out. */
function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!domain) return email;
  return `${name.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, name.length - 1)))}@${domain}`;
}
