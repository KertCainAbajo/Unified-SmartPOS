import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Checkbox, ErrorBanner, Field, Input } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { AuthLayout } from './AuthLayout';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    password_confirmation: '',
    businessName: '',
    tin: '',
    branchName: 'Main Branch',
    vatRegistered: true,
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));
  const err = (name: string) => (error instanceof ApiError ? error.field(name) : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { tenantId } = await register({
        name: form.name,
        email: form.email,
        password: form.password,
        password_confirmation: form.password_confirmation,
        business: {
          name: form.businessName,
          tin: form.tin || undefined,
          branch_name: form.branchName || undefined,
          vat_registered: form.vatRegistered,
        },
      });
      navigate(`/t/${tenantId}`, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your business"
      subtitle="Set up your owner account and first branch."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-teal-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error instanceof ApiError && Object.keys(error.errors).length === 0 ? <ErrorBanner error={error} /> : null}
        <Field label="Your name" error={err('name')}>
          {(id) => <Input id={id} autoComplete="name" value={form.name} onChange={(e) => set('name')(e.target.value)} />}
        </Field>
        <Field label="Email" error={err('email')}>
          {(id) => <Input id={id} type="email" autoComplete="email" value={form.email} onChange={(e) => set('email')(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" error={err('password')} hint="8+ characters, upper & lower case, a number.">
            {(id) => <Input id={id} type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password')(e.target.value)} />}
          </Field>
          <Field label="Confirm password">
            {(id) => (
              <Input id={id} type="password" autoComplete="new-password" value={form.password_confirmation} onChange={(e) => set('password_confirmation')(e.target.value)} />
            )}
          </Field>
        </div>
        <hr className="border-slate-100" />
        <Field label="Business name" error={err('business.name')}>
          {(id) => <Input id={id} value={form.businessName} onChange={(e) => set('businessName')(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="TIN (optional)" error={err('business.tin')}>
            {(id) => <Input id={id} placeholder="000-000-000-000" value={form.tin} onChange={(e) => set('tin')(e.target.value)} />}
          </Field>
          <Field label="First branch name" error={err('business.branch_name')}>
            {(id) => <Input id={id} value={form.branchName} onChange={(e) => set('branchName')(e.target.value)} />}
          </Field>
        </div>
        <Checkbox label="VAT-registered business (12% VAT)" checked={form.vatRegistered} onChange={set('vatRegistered')} />
        <Button type="submit" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
