import { useQueryClient } from '@tanstack/react-query';
import { Check, Eye, EyeOff, KeyRound, LoaderCircle, Mail, Phone, ShieldCheck, TriangleAlert, UserRound, X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api, errorMessage } from '../../lib/api';

interface Account { id: number; name: string; email: string; phone: string }

/** The shopper's own account: name and mobile number the store and rider use, and changing the password. */
export function CustomerAccountDialog({ base, business, account, onClose }: { base: string; business: string; account: Account; onClose: () => void }) {
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
          <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
            <span className="grid size-12 place-items-center rounded-full bg-gradient-to-br from-emerald-600 to-emerald-900 font-display text-lg font-bold text-white">{account.name.charAt(0).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[.18em] text-emerald-700">My account</p>
              <p className="truncate font-display text-lg font-bold text-slate-900">{account.name}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-10 place-items-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"><X className="size-5" /></button>
          </div>

          <div className="max-h-[75vh] space-y-6 overflow-y-auto p-6">
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
  if (state.error) return <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200"><TriangleAlert className="mt-0.5 size-4 shrink-0" /> {state.error}</p>;
  if (state.done) return <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-200"><Check className="size-4" /> {doneText}</p>;
  return null;
}
