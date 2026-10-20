import { useQueryClient } from '@tanstack/react-query';
import { Check, Eye, LogOut, EyeOff, KeyRound, LoaderCircle, Mail, Phone, ShieldCheck, TriangleAlert, UserRound, X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Awning } from './ShopVisuals';
import { ApiError, api, errorMessage } from '../../lib/api';

interface Account { id: number; name: string; email: string; phone: string }

/** The shopper's own account: name and mobile number the store and rider use, and changing the password. */
export function CustomerAccountDialog({ base, business, account, onClose, onSignOut }: { base: string; business: string; account: Account; onClose: () => void; onSignOut?: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(account.name);
  const [phone, setPhone] = useState(account.phone);
  const [profileState, setProfileState] = useState<{ busy?: boolean; done?: boolean; error?: string }>({});
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [passwordState, setPasswordState] = useState<{ busy?: boolean; done?: boolean; error?: string }>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileState({ busy: true });
    try {
      await api(`${base}/me`, { method: 'PATCH', body: { name: name.trim(), phone: phone.trim() } });
      await queryClient.invalidateQueries({ queryKey: ['shop-account', business] });
      setProfileState({ done: true });
    } catch (err) {
      setProfileState({ error: err instanceof ApiError ? err.field('phone') ?? err.field('name') ?? err.message : errorMessage(err) });
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordState({ busy: true });
    try {
      await api(`${base}/me/password`, { method: 'PUT', body: { current_password: current, password, password_confirmation: confirm } });
      setCurrent(''); setPassword(''); setConfirm('');
      setPasswordState({ done: true });
    } catch (err) {
      setPasswordState({ error: err instanceof ApiError ? err.field('current_password') ?? err.field('password') ?? err.message : errorMessage(err) });
    }
  }

  const profileChanged = name.trim() !== account.name || phone.trim() !== account.phone;
  const passwordReady = current.length > 0 && password.length >= 10 && password === confirm;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-[#062a1d]/55 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative flex min-h-full items-end justify-center sm:items-center sm:p-6">
        <div role="dialog" aria-modal="true" aria-label="My account" className="auth-fade relative w-full max-w-lg overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]">
          {/* Profile header */}
          <Awning />
          <div className="relative overflow-hidden border-b border-emerald-900/10 bg-gradient-to-br from-[#eef7ea] via-white to-[#fff5dc] px-6 pb-5 pt-5 text-[#0b3b2c]">
            <span aria-hidden className="mx-auto mb-3 block h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" />
            <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 grid size-9 place-items-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 hover:text-slate-800"><X className="size-5" /></button>
            <div className="relative flex items-center gap-4 pr-10">
              <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 font-display text-2xl font-extrabold text-emerald-950 shadow-sm ring-4 ring-white">{account.name.charAt(0).toUpperCase()}</span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[.18em] text-amber-700">My account</p>
                <p className="truncate font-display text-xl font-bold">{account.name}</p>
                <p className="truncate text-xs text-slate-500">{account.email}</p>
              </div>
            </div>
            <div className="relative mt-4 flex flex-wrap gap-2 text-[11px] font-semibold">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-slate-700 ring-1 ring-slate-200"><ShieldCheck className="size-3.5 text-emerald-600" />Email confirmed</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-slate-700 ring-1 ring-slate-200"><Phone className="size-3.5 text-emerald-600" />{account.phone || 'No mobile yet'}</span>
            </div>
          </div>

          <div className="max-h-[68vh] space-y-6 overflow-y-auto p-6">
            <form onSubmit={saveProfile} className="space-y-4">
              <h2 className="font-display text-base font-bold text-slate-900">Your details</h2>
              <Field icon={<Mail />} label="Email" hint="Used to sign in. Contact the store to change it.">
                <input value={account.email} disabled className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-500" />
              </Field>
              <Field icon={<UserRound />} label="Full name">
                <input value={name} onChange={(e) => { setName(e.target.value); setProfileState({}); }} required maxLength={255} autoComplete="name" className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10" />
              </Field>
              <Field icon={<Phone />} label="Mobile number" hint="The store and your rider call this number about your orders.">
                <input value={phone} onChange={(e) => { setPhone(e.target.value); setProfileState({}); }} required maxLength={30} inputMode="tel" autoComplete="tel" className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10" />
              </Field>
              <Status state={profileState} doneText="Details saved." />
              <button type="submit" disabled={!profileChanged || profileState.busy || !name.trim() || !phone.trim()} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 text-sm font-bold text-white transition hover:bg-emerald-900 disabled:bg-slate-200 disabled:text-slate-500">
                {profileState.busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />} Save details
              </button>
            </form>

            <form onSubmit={savePassword} className="space-y-4 border-t border-slate-100 pt-6">
              <h2 className="flex items-center gap-2 font-display text-base font-bold text-slate-900"><ShieldCheck className="size-5 text-emerald-700" /> Change password</h2>
              <Field icon={<KeyRound />} label="Current password">
                <input type={show ? 'text' : 'password'} value={current} onChange={(e) => { setCurrent(e.target.value); setPasswordState({}); }} autoComplete="current-password" className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-11 text-sm outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10" />
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide passwords' : 'Show passwords'} className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-100">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </Field>
              <Field icon={<KeyRound />} label="New password" hint={password && password.length < 10 ? `${10 - password.length} more characters needed` : 'At least 10 characters.'}>
                <input type={show ? 'text' : 'password'} value={password} onChange={(e) => { setPassword(e.target.value); setPasswordState({}); }} autoComplete="new-password" className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10" />
              </Field>
              <Field icon={<KeyRound />} label="Confirm new password" hint={confirm && confirm !== password ? 'The passwords do not match yet.' : undefined}>
                <input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => { setConfirm(e.target.value); setPasswordState({}); }} autoComplete="new-password" className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10" />
              </Field>
              <Status state={passwordState} doneText="Password changed. Use it next time you sign in." />
              <button type="submit" disabled={!passwordReady || passwordState.busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 text-sm font-bold text-white transition hover:bg-emerald-900 disabled:bg-slate-200 disabled:text-slate-500">
                {passwordState.busy ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Change password
              </button>
            </form>

            {onSignOut && (
              <button type="button" onClick={onSignOut} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-50">
                <LogOut className="size-4" /> Sign out
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ icon, label, hint, children }: { icon: ReactNode; label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</span>
      <span className="relative block">
        <span className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-slate-400 [&>svg]:size-4">{icon}</span>
        {children}
      </span>
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

function Status({ state, doneText }: { state: { done?: boolean; error?: string }; doneText: string }) {
  if (state.error) return <p role="alert" className="sp-alert-in sp-alert-error flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200"><TriangleAlert className="mt-0.5 size-4 shrink-0" /> {state.error}</p>;
  if (state.done) return <p role="status" className="sp-alert-in flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-200"><Check className="size-4" /> {doneText}</p>;
  return null;
}
