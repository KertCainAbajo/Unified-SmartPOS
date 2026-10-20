import { CheckCircle2, Eye, EyeOff, KeyRound, Lock, LogOut, Mail, MailWarning, MonitorSmartphone, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { useConfirm } from '../../components/Confirm';
import { useToast } from '../../components/Toast';
import { formatDateTime } from '../../lib/format';
import { Button, ErrorBanner, Field, Input, cx } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useTenant } from '../../tenant/TenantProvider';

const ROLE_LABELS: Record<string, string> = { business_owner: 'Owner', branch_manager: 'Branch Manager', user_access_manager: 'HR · User & Access' };

/** The signed-in person's own sign-in details: name, email and password. */
export function AccountSettings() {
  const { user } = useAuth();
  const { roles, tenant } = useTenant();
  if (!user) return null;
  const owner = user.id === tenant.owner_user_id;
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900 p-6 text-white shadow-md shadow-brand-900/20">
        <span aria-hidden className="pointer-events-none absolute -right-10 -top-16 size-48 rounded-full bg-sun-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-sun-300 to-sun-500 font-display text-xl font-bold text-brand-900 shadow-lg">{initials}</span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-xl font-bold">{user.name}</p>
            <p className="flex flex-wrap items-center gap-2 text-sm text-brand-100/80">
              <Mail className="size-3.5" />{user.email}
              {user.email_verified
                ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-300/30"><CheckCircle2 className="size-3" />Verified</span>
                : <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-300/30"><MailWarning className="size-3" />Not verified</span>}
            </p>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold ring-1 ring-white/20">{owner ? 'Business owner' : roles.map((r) => ROLE_LABELS[r] ?? r.replaceAll('_', ' ')).join(', ')}</span>
        </div>
      </section>

      <div className="grid gap-6 2xl:grid-cols-2">
        <ProfileCard />
        <PasswordCard />
      </div>

      <DevicesCard />

      <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 ring-1 ring-slate-100">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" />
        Both changes are recorded in the audit log. Changing your password signs you out on every other device.
      </p>
    </div>
  );
}

function Panel({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
      <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100"><Icon className="size-5" /></span>
        <div>
          <h2 className="font-display font-semibold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, placeholder }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="pr-10" />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function ProfileCard() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [resent, setResent] = useState(false);
  useEffect(() => {
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
  }, [user]);
  if (!user) return null;

  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase();
  const dirty = emailChanged || name.trim() !== user.name;
  const err = (f: string) => (error instanceof ApiError ? error.field(f) : undefined);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/me', { method: 'PATCH', body: { name: name.trim(), email: email.trim(), ...(emailChanged ? { current_password: password } : {}) } });
      await refresh();
      setPassword('');
      toast.success(emailChanged ? `Email changed. Sign in with ${email.trim().toLowerCase()} from now on.` : 'Profile saved.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await api('/auth/email/verification-notification', { method: 'POST' });
      setResent(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send the link.');
    }
  };

  return (
    <Panel icon={UserRound} title="Name & email" description="Your email is what you sign in with.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (dirty && (!emailChanged || password)) void save(); }}>
        {error instanceof ApiError && Object.keys(error.errors).length === 0 && <ErrorBanner error={error} />}
        <Field label="Full name" error={err('name')}>{(id) => <Input id={id} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Email" error={err('email')} hint={emailChanged ? 'You will sign in with the new address.' : undefined}>
          {(id) => <Input id={id} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        {emailChanged && (
          <div className="auth-fade rounded-xl bg-amber-50/70 p-3 ring-1 ring-amber-100">
            <Field label="Current password" error={err('current_password')} hint="Required to confirm it is really you.">
              {(id) => <PasswordInput id={id} autoComplete="current-password" value={password} onChange={setPassword} />}
            </Field>
          </div>
        )}
        {!user.email_verified && !emailChanged && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-amber-800">
            <MailWarning className="size-4" /> This email is not verified yet.
            {resent ? <span className="font-semibold text-emerald-700">Link sent. Check your inbox.</span> : <button type="button" onClick={() => void resend()} className="font-semibold underline-offset-2 hover:underline">Resend verification link</button>}
          </p>
        )}
        <div className="flex justify-end gap-2">
          {dirty && <Button variant="ghost" onClick={() => { setName(user.name); setEmail(user.email); setPassword(''); setError(null); }}>Cancel</Button>}
          <Button type="submit" loading={busy} disabled={!dirty || !name.trim() || !email.trim() || (emailChanged && !password)} icon={<Mail className="size-4" />}>
            {emailChanged ? 'Change email' : 'Save'}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** Mirrors the server rule: 8+ characters with upper- and lowercase letters and a number. */
const CHECKS: { label: string; test: (p: string) => boolean }[] = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'Upper- and lowercase letters', test: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { label: 'At least one number', test: (p) => /\d/.test(p) },
];

function PasswordCard() {
  const toast = useToast();
  const [form, setForm] = useState({ current: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const err = (f: string) => (error instanceof ApiError ? error.field(f) : undefined);
  const passed = CHECKS.filter((c) => c.test(form.password)).length;
  const strong = passed === CHECKS.length;
  const matches = form.confirm !== '' && form.confirm === form.password;
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/me/password', { method: 'PUT', body: { current_password: form.current, password: form.password, password_confirmation: form.confirm } });
      setForm({ current: '', password: '', confirm: '' });
      toast.success('Password changed. Other devices were signed out.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel icon={KeyRound} title="Password" description="Use a password you don't use anywhere else.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (form.current && strong && matches) void save(); }}>
        {error instanceof ApiError && Object.keys(error.errors).length === 0 && <ErrorBanner error={error} />}
        <Field label="Current password" error={err('current_password')}>{(id) => <PasswordInput id={id} autoComplete="current-password" value={form.current} onChange={set('current')} />}</Field>
        <Field label="New password" error={err('password')}>{(id) => <PasswordInput id={id} autoComplete="new-password" value={form.password} onChange={set('password')} />}</Field>
        {form.password && (
          <div className="auth-fade space-y-2">
            <div className="flex gap-1">
              {CHECKS.map((_, i) => <span key={i} className={cx('h-1.5 flex-1 rounded-full transition', i < passed ? (strong ? 'bg-emerald-500' : 'bg-amber-400') : 'bg-slate-200')} />)}
            </div>
            <ul className="grid gap-1 text-xs sm:grid-cols-3">
              {CHECKS.map((c) => (
                <li key={c.label} className={cx('flex items-center gap-1.5', c.test(form.password) ? 'text-emerald-700' : 'text-slate-400')}>
                  <CheckCircle2 className="size-3.5" />{c.label}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Field label="Confirm new password" error={form.confirm && !matches ? 'The passwords do not match.' : undefined}>
          {(id) => <PasswordInput id={id} autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />}
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={!form.current || !strong || !matches} icon={<Lock className="size-4" />}>Change password</Button>
        </div>
      </form>
    </Panel>
  );
}

interface TrustedBrowser { id: number; label: string | null; ip_address: string | null; current: boolean; last_used_at: string | null; expires_at: string }

/** Browsers that skip the emailed sign-in code, and "sign out everywhere else". */
function DevicesCard() {
  const toast = useToast();
  const ask = useConfirm();
  const [devices, setDevices] = useState<TrustedBrowser[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<{ data: TrustedBrowser[] }>('/me/devices').then((r) => setDevices(r.data)).catch(setError);
  useEffect(() => { void load(); }, []);

  async function forget() {
    if (!(await ask({ title: 'Sign out everywhere else?', message: 'Other browsers are signed out, and every browser (this one too) will need an emailed code at the next sign-in.', confirmLabel: 'Sign out everywhere else' }))) return;
    setBusy(true);
    try {
      await api('/me/devices', { method: 'DELETE' });
      toast.success('Signed out everywhere else.');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel icon={MonitorSmartphone} title="Trusted browsers" description="Signing in with your email on a new browser needs a code we email you. These browsers skip it for 30 days.">
      <div className="space-y-3">
        {error ? <ErrorBanner error={error} /> : null}
        {devices === null && !error ? <p className="text-sm text-slate-400">Loading…</p> : devices?.length === 0 ? (
          <p className="text-sm text-slate-500">No trusted browsers. You will get an emailed code each time you sign in on a new browser.</p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-100">
            {devices?.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <span className="grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-500"><MonitorSmartphone className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-medium text-slate-800">{d.label ?? 'Browser'}{d.current && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">This browser</span>}</span>
                  <span className="block text-xs text-slate-500">Last used {formatDateTime(d.last_used_at)}{d.ip_address ? ` · IP ${d.ip_address}` : ''}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button variant="secondary" loading={busy} icon={<LogOut className="size-4" />} onClick={() => void forget()}>Sign out everywhere else</Button>
      </div>
    </Panel>
  );
}
