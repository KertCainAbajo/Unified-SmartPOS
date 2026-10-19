import { ArrowLeft, Check, CheckCircle2, Circle, Eye, EyeOff, KeyRound, Mail, MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useToast } from '../../components/Toast';
import { Button, ErrorBanner, cx } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { AuthLayout } from './AuthLayout';

const inputClass = 'h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-[0.95rem] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-100';

const backToSignIn = (
  <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-600"><ArrowLeft className="size-4" /> Back to sign in</Link>
);

/** Management sign-in: ask for a password reset link by email. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email: email.trim() } });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={sent ? 'Check your email' : 'Forgot your password?'} subtitle={sent ? undefined : 'For owners, managers, HR and platform admins who sign in with an email. We will email you a link to choose a new password.'} footer={backToSignIn}>
      {sent ? (
        <div className="sp-rise space-y-4 text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-emerald-100 text-emerald-700 ring-8 ring-emerald-50"><MailCheck className="size-8" /></span>
          <p className="text-sm text-slate-600">If <strong className="text-slate-900">{email.trim()}</strong> has an account, a reset link is on its way. Open it on this device within 60 minutes.</p>
          <p className="text-xs text-slate-500">Nothing in your inbox? Check Spam, or <button type="button" onClick={() => setSent(false)} className="font-semibold text-brand-700 hover:underline">try again</button>.</p>
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-100">Cashiers and crew who sign in with a username: ask your manager to reset your password.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <ErrorBanner error={error} />
          <div>
            <label htmlFor="reset-email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-[1.125rem] -translate-y-1/2 text-slate-400" />
              <input id="reset-email" type="email" required autoFocus autoComplete="email" placeholder="you@business.com" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!email.trim()}>Email me a reset link</Button>
        </form>
      )}
    </AuthLayout>
  );
}

/** Password rules (same as the server): 8+ characters, upper and lower case letters, and a number. */
const RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'An uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'A lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'A number', test: (p) => /\d/.test(p) },
];

/** Opened from the emailed link: choose a new password. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const token = params.get('token') ?? '';
  const email = params.get('email') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const passed = RULES.filter((r) => r.test(password)).length;
  const matches = confirm.length > 0 && confirm === password;
  const ready = passed === RULES.length && matches;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, email, password, password_confirmation: confirm } });
      toast.success('Password changed. Sign in with your new password.');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!token || !email) {
    return (
      <AuthLayout title="This link is incomplete" subtitle="Open the link from the email again, or ask for a new one." footer={backToSignIn}>
        <Link to="/forgot-password"><Button className="w-full" size="lg">Send a new link</Button></Link>
      </AuthLayout>
    );
  }

  const strength = ['bg-slate-200', 'bg-rose-400', 'bg-amber-400', 'bg-sky-400', 'bg-emerald-500'][passed];
  return (
    <AuthLayout title="Choose a new password" subtitle={`For ${email}`} footer={backToSignIn}>
      <form onSubmit={submit} className="space-y-5">
        {error instanceof ApiError && error.field('email')
          ? <ErrorBanner error={new Error('This reset link has expired or was already used. Ask for a new one from “Forgot password?”.')} />
          : <ErrorBanner error={error} />}
        <div>
          <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-slate-700">New password</label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-[1.125rem] -translate-y-1/2 text-slate-400" />
            <input id="new-password" type={show ? 'text' : 'password'} autoFocus autoComplete="new-password" className={cx(inputClass, 'pr-12')} value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-100">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1">{RULES.map((_, i) => <span key={i} className={cx('h-1 rounded-full transition-colors duration-300', i < passed ? strength : 'bg-slate-200')} />)}</div>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {RULES.map((r) => {
              const ok = r.test(password);
              return <li key={r.label} className={cx('flex items-center gap-1.5 text-xs transition-colors', ok ? 'text-emerald-700' : 'text-slate-500')}>{ok ? <CheckCircle2 className="size-3.5" /> : <Circle className="size-3.5" />}{r.label}</li>;
            })}
          </ul>
        </div>
        <div>
          <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-slate-700">Type it again</label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-[1.125rem] -translate-y-1/2 text-slate-400" />
            <input id="confirm-password" type={show ? 'text' : 'password'} autoComplete="new-password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {confirm && <p className={cx('mt-1.5 flex items-center gap-1.5 text-xs font-medium', matches ? 'text-emerald-700' : 'text-amber-700')}>{matches ? <><Check className="size-3.5" />Passwords match</> : 'The passwords do not match yet.'}</p>}
        </div>
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!ready}>Save new password</Button>
      </form>
    </AuthLayout>
  );
}
