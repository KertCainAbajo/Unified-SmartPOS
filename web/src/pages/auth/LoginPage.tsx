import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth, type LoginCredentials } from '../../auth/AuthProvider';
import { Button, ErrorBanner, Field, Input, Tabs } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { getDeviceBusiness, setDeviceBusiness } from '../../lib/device';
import { AuthLayout } from './AuthLayout';

type Mode = 'staff' | 'email';

/**
 * Staff sign in with username or employee ID + password; the business comes from this device. Owners, managers,
 * HR and platform administrators sign in with email (the API refuses username sign-in for them).
 */
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [device, setDevice] = useState(getDeviceBusiness);
  const [mode, setMode] = useState<Mode>(device ? 'staff' : 'email');
  const [email, setEmail] = useState('');
  const [businessCode, setBusinessCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const code = device?.code ?? businessCode.trim().toLowerCase();
    const credentials: LoginCredentials = mode === 'email' ? { email, password } : { business_code: code, username: username.trim(), password };
    try {
      await login(credentials);
      // Remember the business; the real name replaces the code once the business is opened.
      if (mode === 'staff' && !device) setDeviceBusiness({ code, name: code });
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const fieldError = error instanceof ApiError ? error.field(mode === 'email' ? 'email' : 'username') : undefined;

  return (
    <AuthLayout
      title="Sign in"
      subtitle={mode === 'staff' ? 'Enter your username or employee ID and password.' : 'Business owners, managers and HR sign in with email.'}
      footer={
        <>
          New business?{' '}
          <Link to="/register" className="font-medium text-teal-700 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <Tabs<Mode> value={mode} onChange={(m) => { setMode(m); setError(null); }} tabs={[{ value: 'staff', label: 'Staff' }, { value: 'email', label: 'Owner, manager & HR' }]} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && !fieldError ? <ErrorBanner error={error} /> : null}
        {mode === 'email' ? (
          <Field label="Email" error={fieldError}>
            {(id) => <Input id={id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
          </Field>
        ) : (
          <>
            {device ? (
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="text-slate-600">
                  Store: <span className="font-medium text-slate-900">{device.name}</span>
                </span>
                <button type="button" className="text-xs font-medium text-teal-700 hover:underline" onClick={() => { setDeviceBusiness(null); setDevice(null); }}>
                  Change
                </button>
              </div>
            ) : (
              <Field label="Business code" hint="Needed only the first time on this device. Ask your manager.">
                {(id) => <Input id={id} autoCapitalize="none" value={businessCode} onChange={(e) => setBusinessCode(e.target.value)} />}
              </Field>
            )}
            <Field label="Username or employee ID" error={fieldError}>
              {(id) => <Input id={id} autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />}
            </Field>
          </>
        )}
        <Field label="Password">
          {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
      {import.meta.env.DEV && (
        <p className="mt-6 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
          Local demo (password <code>DemoPass123</code>): email <code>owner@demo.smartpos.test</code>, <code>manager@demo.smartpos.test</code>,{' '}
          <code>hr@demo.smartpos.test</code>; staff of <code>aling-nena-mini-mart</code>: <code>cashier.main01</code> or <code>EMP-102</code>.
        </p>
      )}
    </AuthLayout>
  );
}
