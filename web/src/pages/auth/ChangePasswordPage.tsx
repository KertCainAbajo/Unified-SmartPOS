import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { Button, ErrorBanner, Field, Input } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { AuthLayout } from './AuthLayout';

/** Shown after signing in with a temporary password from a manager: the employee chooses their own. */
export function ChangePasswordPage() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const err = (f: string) => (error instanceof ApiError ? error.field(f) : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/me/password', { method: 'PUT', body: { current_password: current, password, password_confirmation: confirmation } });
      await refresh();
      navigate('/', { replace: true });
    } catch (ex) {
      setError(ex);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={`Welcome, ${user?.name ?? ''}`} subtitle="Choose your own password. Only you will know it — your manager cannot see it.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error instanceof ApiError && Object.keys(error.errors).length === 0 && <ErrorBanner error={error} />}
        <Field label="Temporary password (from your manager)" error={err('current_password')}>
          {(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />}
        </Field>
        <Field label="New password" error={err('password')} hint="At least 8 characters with upper and lower case letters and a number.">
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label="Confirm new password">
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />}
        </Field>
        <Button type="submit" className="w-full" loading={busy}>
          Save password
        </Button>
        <Button variant="ghost" className="w-full" onClick={async () => { await logout(); navigate('/login'); }}>
          Sign out
        </Button>
      </form>
    </AuthLayout>
  );
}
