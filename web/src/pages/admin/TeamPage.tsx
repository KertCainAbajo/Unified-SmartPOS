import { KeyRound, Plus, Printer } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { Badge, Button, Card, Checkbox, DataTable, ErrorBanner, Field, Input, Modal, PageHeader, Pagination, Select, Tabs, Textarea } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { formatDate, formatDateTime, titleCase } from '../../lib/format';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Paginated, Role, StaffMember, StaffProfile } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

/**
 * Staff accounts. The server enforces every rule (owner-only admin roles, branch scope, no self-edits);
 * buttons simply follow the caller's permissions. Passwords are never displayed after they are issued:
 * a generated password (e.g. AlingNena-4827) is shown once on the credential slip; it is permanent unless the
 * administrator asks the employee to change it at first sign-in.
 */
export function TeamPage() {
  const { can } = useTenant();
  const [tab, setTab] = useState<'members' | 'roles'>('members');
  if (!can('staff.view')) return <NoAccess what="team management" />;
  return (
    <>
      <PageHeader title="Team" description="Staff accounts, roles and branch access. Employees sign in with the business code and their username." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'members', label: 'Staff' }, { value: 'roles', label: 'Roles & permissions' }]} />
      {tab === 'members' ? <MembersTab /> : <RolesTab />}
    </>
  );
}

interface Credentials {
  name: string;
  signInWith: 'username' | 'email';
  username: string | null;
  email: string | null;
  employeeCode: string | null;
  temporaryPassword: string | null;
  mustChange: boolean;
  activationCode: string | null;
  expiresAt: string | null;
}

interface IssuedResponse {
  data: StaffMember;
  activation_code: string | null;
  temporary_password: string | null;
  code_expires_at: string | null;
}

const toCredentials = (r: IssuedResponse): Credentials => ({
  name: r.data.name ?? '',
  signInWith: r.data.sign_in_with,
  username: r.data.username,
  email: r.data.email,
  employeeCode: r.data.employee_code,
  temporaryPassword: r.temporary_password,
  mustChange: !!r.data.must_change_password,
  activationCode: r.activation_code,
  expiresAt: r.code_expires_at,
});

function MembersTab() {
  const { can, tenant } = useTenant();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const list = useTenantQuery<Paginated<StaffMember>>('/staff', { page, status });

  return (
    <Card
      padded={false}
      title={`Business code: ${tenant.slug}`}
      actions={
        <div className="flex gap-2">
          <Select className="h-8 w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="">All statuses</option>
            {['invited', 'active', 'suspended', 'offboarded'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </Select>
          {can('staff.create') && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Add staff</Button>}
        </div>
      }
    >
      <DataTable
        rows={list.data?.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(m) => m.id}
        onRowClick={(m) => setSelectedId(m.id)}
        empty="No staff."
        columns={[
          { header: 'Name', cell: (m) => <><p className="font-medium text-slate-900">{m.name ?? m.email}{m.user_id === tenant.owner_user_id && <span className="ml-2 text-xs text-teal-700">Owner</span>}{m.user_id === user?.id && <span className="ml-2 text-xs text-slate-400">You</span>}</p><p className="text-xs text-slate-500">{m.username ?? m.email}</p></> },
          { header: 'Employee ID', cell: (m) => m.employee_code ?? '—' },
          { header: 'Roles', cell: (m) => m.roles?.map((r) => r.name).join(', ') },
          { header: 'Branches', cell: (m) => (m.all_branches ? 'All branches' : m.branches?.map((b) => b.name).join(', ') || 'None') },
          { header: 'Status', cell: (m) => <>{<Badge status={m.status} />}{m.must_change_password && <span className="ml-2 text-xs text-amber-700">First sign-in pending</span>}</> },
        ]}
      />
      <Pagination page={page} data={list.data} onPage={setPage} />
      <CreateStaff open={creating} onClose={() => setCreating(false)} />
      {selectedId !== null && <StaffDetail id={selectedId} onClose={() => setSelectedId(null)} />}
    </Card>
  );
}

/* --------------------------------------------------------------------------- Shared pieces */

function RoleAndBranchFields({ roleIds, onRolesChange, all, setAll, branchIds, setBranchIds }: {
  roleIds: number[]; onRolesChange: (v: number[]) => void; all: boolean; setAll: (v: boolean) => void; branchIds: number[]; setBranchIds: (v: number[]) => void;
}) {
  const { branches, allBranches } = useTenant();
  const roles = useTenantQuery<{ data: Role[] }>('/roles');
  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Role</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {/* Only roles this user may give; e.g. branch managers cannot create other managers. */}
          {roles.data?.data.filter((r) => r.assignable !== false || roleIds.includes(r.id)).map((r) => (
            <label key={r.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50 has-[:checked]:border-teal-600 has-[:checked]:bg-teal-50/40">
              <input type="checkbox" className="mt-0.5 accent-teal-700" checked={roleIds.includes(r.id)} onChange={() => onRolesChange(toggle(roleIds, r.id))} />
              <span><span className="font-medium text-slate-900">{r.name}</span><span className="block text-xs text-slate-500">{r.description}</span></span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Branch access</p>
        {allBranches && <Checkbox label="All branches" checked={all} onChange={setAll} />}
        {!all && <div className="mt-2 flex flex-wrap gap-3">{branches.map((b) => <Checkbox key={b.id} label={b.name} checked={branchIds.includes(b.id)} onChange={() => setBranchIds(toggle(branchIds, b.id))} />)}</div>}
      </div>
    </>
  );
}

const emptyProfile: StaffProfile = { job_title: '', hire_date: '', phone: '', address: '', birth_date: '', emergency_contact_name: '', emergency_contact_phone: '', notes: '' };

function ProfileFields({ value, onChange, errors }: { value: StaffProfile; onChange: (v: StaffProfile) => void; errors?: ApiError }) {
  const set = (k: keyof StaffProfile) => (v: string) => onChange({ ...value, [k]: v });
  const err = (k: string) => errors?.field(`profile.${k}`);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Job title" error={err('job_title')}>{(id) => <Input id={id} value={value.job_title ?? ''} onChange={(e) => set('job_title')(e.target.value)} />}</Field>
      <Field label="Hire date" error={err('hire_date')}>{(id) => <Input id={id} type="date" value={value.hire_date ?? ''} onChange={(e) => set('hire_date')(e.target.value)} />}</Field>
      <Field label="Mobile number" error={err('phone')}>{(id) => <Input id={id} inputMode="tel" value={value.phone ?? ''} onChange={(e) => set('phone')(e.target.value)} />}</Field>
      <Field label="Birth date" error={err('birth_date')}>{(id) => <Input id={id} type="date" value={value.birth_date ?? ''} onChange={(e) => set('birth_date')(e.target.value)} />}</Field>
      <Field label="Address" error={err('address')} className="sm:col-span-2">{(id) => <Input id={id} value={value.address ?? ''} onChange={(e) => set('address')(e.target.value)} />}</Field>
      <Field label="Emergency contact" error={err('emergency_contact_name')}>{(id) => <Input id={id} value={value.emergency_contact_name ?? ''} onChange={(e) => set('emergency_contact_name')(e.target.value)} />}</Field>
      <Field label="Emergency contact number" error={err('emergency_contact_phone')}>{(id) => <Input id={id} inputMode="tel" value={value.emergency_contact_phone ?? ''} onChange={(e) => set('emergency_contact_phone')(e.target.value)} />}</Field>
      <Field label="Notes" error={err('notes')} className="sm:col-span-2">{(id) => <Textarea id={id} value={value.notes ?? ''} onChange={(e) => set('notes')(e.target.value)} />}</Field>
    </div>
  );
}

/** Empty strings become null so cleared fields are cleared on the server. */
const profilePayload = (p: StaffProfile) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === '' ? null : v]));

/** Printable slip with the new sign-in details. The password is shown only here, only once. */
function CredentialSlip({ credentials }: { credentials: Credentials }) {
  const { tenant } = useTenant();
  const [copied, setCopied] = useState<string | null>(null);
  // Copies the exact value; selecting it by hand easily picks up a stray space.
  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(value);
      setTimeout(() => setCopied(null), 2000);
    });
  };
  const row = (label: string, value: string | null, mono = false, copyable = false) =>
    value ? (
      <div className="flex items-center justify-between gap-4 border-b border-dashed border-slate-200 py-1.5">
        <span className="text-slate-500">{label}</span>
        <span className="flex items-center gap-2">
          <span className={mono ? 'font-mono text-base font-semibold tracking-wide text-slate-900' : 'font-medium text-slate-900'}>{value}</span>
          {copyable && (
            <button type="button" className="rounded border border-slate-200 px-1.5 py-0.5 text-xs text-teal-700 hover:bg-slate-50 print:hidden" onClick={() => copy(value)}>
              {copied === value ? 'Copied' : 'Copy'}
            </button>
          )}
        </span>
      </div>
    ) : null;

  return (
    <div className="space-y-3">
      <div className="print-area rounded-lg border border-slate-300 p-4 text-sm">
        <p className="text-base font-semibold text-slate-900">{tenant.name}</p>
        <p className="mb-3 text-xs text-slate-500">Staff sign-in details — keep private</p>
        {row('Name', credentials.name)}
        {credentials.signInWith === 'email' ? (
          <>
            {row('Employee ID', credentials.employeeCode)}
            {row('Sign in with email', credentials.email, true)}
          </>
        ) : (
          <>
            {row('Username', credentials.username, true)}
            {row('or Employee ID', credentials.employeeCode, true)}
            {row('Business code (new device only)', tenant.slug)}
            {row('Email', credentials.email)}
          </>
        )}
        {row(credentials.mustChange ? 'Temporary password' : 'Password', credentials.temporaryPassword, true, true)}
        {row('Activation code', credentials.activationCode, true, true)}
        {credentials.expiresAt && <p className="mt-3 text-xs text-slate-600">Use before {formatDateTime(credentials.expiresAt)}. {credentials.temporaryPassword ? 'You will be asked to choose your own password at first sign-in.' : 'Enter it on the activation page to choose your password.'}</p>}
        {credentials.temporaryPassword && !credentials.mustChange && <p className="mt-3 text-xs text-slate-600">This is your password. Keep this slip private and do not share your password with co-workers.</p>}
      </div>
      <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
        This is the only time the {credentials.temporaryPassword ? 'password' : 'code'} is shown. Print or copy it now — it is not stored in readable form and cannot be viewed later. If it is lost, use <strong>Reset password</strong> to issue a new one.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------------- Create */

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="flex size-5 items-center justify-center rounded-full bg-teal-700 text-xs text-white">{n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * How the first password reaches the employee. Activation codes are redeemed with a username, so they are not
 * offered to managers and HR (who sign in by email); email links need an address.
 */
function deliveryOptions(emailSignIn: boolean, hasEmail: boolean) {
  return [
    { value: 'temporary_password', label: 'Generate a password', description: 'A simple password based on the business name, e.g. AlingNena-4827, printed on a slip now.', disabled: false },
    ...(emailSignIn ? [] : [{ value: 'manual', label: 'Generate a one-time activation code', description: 'The employee enters the code to set their password.', disabled: false }]),
    { value: 'email', label: 'Email an activation link', description: hasEmail ? 'Sent to the email above.' : 'Enter an email above to use this.', disabled: !hasEmail },
  ];
}

function CreateStaff({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { branch, path } = useTenant();
  const [form, setForm] = useState({ name: '', username: '', email: '', employee_code: '', delivery: 'temporary_password' });
  const [requireChange, setRequireChange] = useState(false);
  const [profile, setProfile] = useState<StaffProfile>(emptyProfile);
  const [showProfile, setShowProfile] = useState(false);
  const [roleIds, setRoleIds] = useState<number[]>([]);
  const [all, setAll] = useState(false);
  const [branchIds, setBranchIds] = useState<number[]>(branch ? [branch.id] : []);
  const [issued, setIssued] = useState<Credentials | null>(null);
  const roles = useTenantQuery<{ data: Role[] }>('/roles');
  // Owners, managers and HR sign in with email, so their account needs one.
  const emailRequired = !!roles.data?.data.some((r) => roleIds.includes(r.id) && r.requires_email_sign_in);
  // Fields still holding a generated value are refreshed when the role/branch changes; typed values are kept.
  const autoFilled = useRef({ username: true, email: true, employee_code: true });

  const save = useTenantMutation<Record<string, unknown>, IssuedResponse>('POST', '/staff', {
    success: 'Staff account created.',
    onSuccess: (r) => setIssued(toCredentials(r)),
    toastErrors: false,
  });
  const err = (f: string) => (save.error instanceof ApiError ? save.error.field(f) : undefined);

  // Generate username, employee ID and company email from the chosen role, branch and business.
  useEffect(() => {
    if (!open || roleIds.length === 0) return;
    let cancelled = false;
    api<{ username: string; employee_code: string; email: string | null }>(path('/staff/username-suggestion'), {
      query: { role_id: roleIds[0], branch_id: all ? undefined : branchIds[0] },
    })
      .then((s) => {
        if (cancelled) return;
        setForm((f) => ({
          ...f,
          username: autoFilled.current.username ? s.username : f.username,
          employee_code: autoFilled.current.employee_code ? s.employee_code : f.employee_code,
          email: autoFilled.current.email ? (s.email ?? '') : f.email,
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, roleIds, branchIds, all, path]);

  // Fall back to a temporary password when the chosen delivery no longer applies (role or email changed).
  const deliveryValid = deliveryOptions(emailRequired, !!form.email).some((o) => o.value === form.delivery && !o.disabled);
  useEffect(() => {
    if (!deliveryValid) setForm((f) => ({ ...f, delivery: 'temporary_password' }));
  }, [deliveryValid]);

  const submit = () =>
    save.mutate({
      name: form.name,
      // Managers and HR sign in by email; the server still assigns them an internal username.
      username: emailRequired ? null : form.username || null,
      email: form.email || null,
      employee_code: form.employee_code || null,
      delivery: form.delivery,
      ...(form.delivery === 'temporary_password' ? { require_password_change: requireChange } : {}),
      role_ids: roleIds,
      all_branches: all,
      branch_ids: all ? [] : branchIds,
      ...(showProfile ? { profile: profilePayload(profile) } : {}),
    });

  const edit = (k: 'name' | 'username' | 'email' | 'employee_code' | 'delivery') => (v: string) => {
    if (k === 'username' || k === 'email' || k === 'employee_code') autoFilled.current[k] = v === '';
    setForm((f) => ({ ...f, [k]: v }));
  };

  const close = () => {
    setIssued(null);
    setForm({ name: '', username: '', email: '', employee_code: '', delivery: 'temporary_password' });
    setRequireChange(false);
    setProfile(emptyProfile);
    setShowProfile(false);
    setRoleIds([]);
    autoFilled.current = { username: true, email: true, employee_code: true };
    save.reset();
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={issued ? 'Account created' : 'Add staff account'} size="lg"
      footer={issued
        ? <><Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print slip</Button><Button onClick={close}>Done</Button></>
        : <><Button variant="secondary" onClick={close}>Cancel</Button><Button loading={save.isPending} disabled={!form.name || roleIds.length === 0 || (emailRequired && !form.email)} onClick={submit}>Create account</Button></>}>
      {issued ? (
        <CredentialSlip credentials={issued} />
      ) : (
        <div className="space-y-6">
          {save.error instanceof ApiError && Object.keys(save.error.errors).length === 0 && <ErrorBanner error={save.error} />}

          <Step n={1} title="Employee">
            <Field label="Full name" error={err('name')}>{(id) => <Input id={id} value={form.name} onChange={(e) => edit('name')(e.target.value)} autoFocus />}</Field>
          </Step>

          <Step n={2} title="Role and branch">
            <RoleAndBranchFields roleIds={roleIds} onRolesChange={setRoleIds} all={all} setAll={setAll} branchIds={branchIds} setBranchIds={setBranchIds} />
            {err('role_ids') && <p className="text-xs text-red-600">{err('role_ids')}</p>}
            {err('branch_ids') && <p className="text-xs text-red-600">{err('branch_ids')}</p>}
          </Step>

          <Step n={3} title="Sign-in details">
            {roleIds.length === 0 ? (
              <p className="text-sm text-slate-500">Choose a role first — the sign-in details are generated from it.</p>
            ) : (
              <>
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {emailRequired
                    ? <>Managers and HR sign in with <strong>email + password</strong>.</>
                    : <>This employee signs in with <strong>username or employee ID + password</strong>.</>}
                </p>
                {emailRequired ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Email" error={err('email')} hint="Required — used to sign in.">{(id) => <Input id={id} type="email" value={form.email} onChange={(e) => edit('email')(e.target.value)} />}</Field>
                    <Field label="Employee ID" error={err('employee_code')} hint="Generated — you can change it.">{(id) => <Input id={id} value={form.employee_code} onChange={(e) => edit('employee_code')(e.target.value)} />}</Field>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Username" error={err('username')} hint="Generated — you can change it.">{(id) => <Input id={id} value={form.username} onChange={(e) => edit('username')(e.target.value)} />}</Field>
                    <Field label="Employee ID" error={err('employee_code')} hint="Can also be used to sign in.">{(id) => <Input id={id} value={form.employee_code} onChange={(e) => edit('employee_code')(e.target.value)} />}</Field>
                    <Field label="Company email (optional)" error={err('email')} hint="For notifications and password reset links." className="sm:col-span-2">{(id) => <Input id={id} type="email" value={form.email} onChange={(e) => edit('email')(e.target.value)} />}</Field>
                  </div>
                )}
              </>
            )}
          </Step>

          <Step n={4} title="First password">
            <div className="space-y-2">
              {deliveryOptions(emailRequired, !!form.email).map((o) => (
                <label key={o.value} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${o.disabled ? 'cursor-not-allowed border-slate-100 opacity-50' : 'cursor-pointer border-slate-200 hover:bg-slate-50 has-[:checked]:border-teal-600 has-[:checked]:bg-teal-50/40'}`}>
                  <input type="radio" name="delivery" className="mt-0.5 accent-teal-700" value={o.value} checked={form.delivery === o.value} disabled={o.disabled} onChange={() => edit('delivery')(o.value)} />
                  <span><span className="font-medium text-slate-900">{o.label}</span><span className="block text-xs text-slate-500">{o.description}</span></span>
                </label>
              ))}
            </div>
            {form.delivery === 'temporary_password' && (
              <Checkbox label="Ask the employee to change it at first sign-in (more secure)" checked={requireChange} onChange={setRequireChange} />
            )}
            {err('delivery') && <p className="text-xs text-red-600">{err('delivery')}</p>}
          </Step>

          <div>
            <button type="button" className="text-sm font-medium text-teal-700 hover:underline" onClick={() => setShowProfile((v) => !v)}>
              {showProfile ? 'Hide personal information' : '+ Add personal information (optional)'}
            </button>
            {showProfile && <div className="mt-3"><ProfileFields value={profile} onChange={setProfile} errors={save.error instanceof ApiError ? save.error : undefined} /></div>}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* --------------------------------------------------------------------------- Detail */

type DetailTab = 'account' | 'personal' | 'access';

function StaffDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { can, tenant } = useTenant();
  const { user } = useAuth();
  const detail = useTenantQuery<{ data: StaffMember }>(`/staff/${id}`);
  const member = detail.data?.data;
  const [tab, setTab] = useState<DetailTab>('account');
  const [issued, setIssued] = useState<Credentials | null>(null);
  const [reason, setReason] = useState('');
  const [profile, setProfile] = useState<StaffProfile>(emptyProfile);
  const [roleIds, setRoleIds] = useState<number[]>([]);
  const [all, setAll] = useState(false);
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [resetRequireChange, setResetRequireChange] = useState(false);

  useEffect(() => {
    if (!member) return;
    setProfile({ ...emptyProfile, ...Object.fromEntries(Object.entries(member.profile ?? {}).map(([k, v]) => [k, v ?? ''])) });
    setRoleIds(member.roles?.map((r) => r.id) ?? []);
    setAll(member.all_branches);
    setBranchIds(member.branches?.map((b) => b.id) ?? []);
  }, [member]);

  const action = (a: string) => `/staff/${id}/${a}`;
  const credentials = useTenantMutation<{ action: string; delivery: string; require_password_change: boolean }, IssuedResponse>('POST', (b) => action(b.action), { success: 'New sign-in details issued.', onSuccess: (r) => setIssued(toCredentials(r)) });
  const status = useTenantMutation<{ action: string; reason?: string; delivery?: string }, IssuedResponse>('POST', (b) => action(b.action), { success: 'Account updated.', onSuccess: (r) => (r.temporary_password || r.activation_code ? setIssued(toCredentials(r)) : setReason('')) });
  const saveProfile = useTenantMutation<{ profile: Record<string, unknown> }>('PATCH', `/staff/${id}`, { success: 'Personal information saved.', toastErrors: false });
  const roles = useTenantMutation<{ role_ids: number[] }>('POST', action('change-role'), { success: 'Roles updated.' });
  const branchesM = useTenantMutation<{ all_branches: boolean; branch_ids: number[] }>('POST', action('transfer-branches'), { success: 'Branch access updated.' });

  if (!member) return <Modal open onClose={onClose} title="Staff">{detail.error ? <ErrorBanner error={detail.error} /> : <p className="text-sm text-slate-500">Loading…</p>}</Modal>;

  const managed = member.account_type === 'company_managed';
  const isSelf = member.user_id === user?.id;
  const isOwner = member.user_id === tenant.owner_user_id;
  const manageable = !isSelf && !isOwner;
  const info = (label: string, value: string | null | undefined) => (
    <div><dt className="text-xs text-slate-500">{label}</dt><dd className="text-sm font-medium text-slate-900">{value || '—'}</dd></div>
  );

  if (issued) {
    return (
      <Modal open onClose={onClose} title="New sign-in details" size="md" footer={<><Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print slip</Button><Button onClick={() => setIssued(null)}>Done</Button></>}>
        <CredentialSlip credentials={issued} />
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={member.name ?? member.email ?? 'Staff'} size="lg">
      <Tabs<DetailTab> value={tab} onChange={setTab} tabs={[
        { value: 'account', label: 'Account' },
        ...(member.profile !== undefined ? [{ value: 'personal' as DetailTab, label: 'Personal information' }] : []),
        ...(manageable ? [{ value: 'access' as DetailTab, label: 'Roles & access' }] : []),
      ]} />

      {tab === 'account' && (
        <div className="space-y-5">
          <dl className="grid gap-4 sm:grid-cols-2">
            {info('Full name', member.name)}
            {info('Employee ID', member.employee_code)}
            {info('Business code', tenant.slug)}
            {info('Username', member.username)}
            {info('Email', member.email)}
            {info('Account type', member.account_type === 'company_managed' ? 'Company-managed' : 'Personal account')}
            {info('Signs in with', member.sign_in_with === 'email' ? 'Email + password' : 'Username or employee ID + password')}
            <div><dt className="text-xs text-slate-500">Status</dt><dd><Badge status={member.status} /></dd></div>
            {info('Last sign-in', formatDateTime(member.last_login_at))}
            {info('Roles', member.roles?.map((r) => r.name).join(', '))}
            {info('Branches', member.all_branches ? 'All branches' : member.branches?.map((b) => b.name).join(', '))}
          </dl>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
            <div className="flex items-center gap-2 text-sm">
              <KeyRound className="size-4 text-slate-400" />
              <span>
                <span className="font-medium text-slate-900">Password: ••••••••</span>
                <span className="block text-xs text-slate-500">
                  {member.must_change_password
                    ? 'Temporary password issued — the employee has not chosen their own yet.'
                    : 'Hidden for security. If it is forgotten, reset it to print a new one.'}
                </span>
              </span>
            </div>
            {can('staff.credentials') && managed && manageable && ['active', 'invited'].includes(member.status) && (
              <Button size="sm" variant="secondary" loading={credentials.isPending} onClick={() => {
                if (member.status === 'invited' || confirm(`Reset ${member.name}'s password? Their current password stops working and they are signed out everywhere.`)) {
                  credentials.mutate({ action: member.status === 'invited' ? 'resend-invitation' : 'recovery', delivery: 'temporary_password', require_password_change: resetRequireChange });
                }
              }}>
                Reset password
              </Button>
            )}
          </div>
          {can('staff.credentials') && managed && manageable && ['active', 'invited'].includes(member.status) && (
            <Checkbox label="When resetting, ask the employee to change it at next sign-in" checked={resetRequireChange} onChange={setResetRequireChange} />
          )}
          {!managed && <p className="text-xs text-slate-500">Personal accounts reset their own password with "Forgot password" on the sign-in page.</p>}

          {manageable && (can('staff.status') || can('staff.offboard')) && (
            <section className="space-y-3 border-t border-slate-100 pt-4">
              <Field label="Reason (required to suspend or offboard)">{(fid) => <Input id={fid} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
              <div className="flex flex-wrap gap-2">
                {can('staff.status') && ['active', 'invited'].includes(member.status) && <Button size="sm" variant="secondary" disabled={!reason} onClick={() => status.mutate({ action: 'suspend', reason })}>Suspend</Button>}
                {can('staff.status') && member.status === 'suspended' && <Button size="sm" variant="secondary" onClick={() => status.mutate({ action: 'reactivate' })}>Reactivate</Button>}
                {can('staff.status') && can('staff.credentials') && member.status === 'offboarded' && <Button size="sm" variant="secondary" onClick={() => status.mutate({ action: 'reactivate', delivery: 'temporary_password' })}>Rehire</Button>}
                {can('staff.offboard') && member.status !== 'offboarded' && <Button size="sm" variant="danger" disabled={!reason} onClick={() => confirm('Offboard this employee? All their sessions end immediately and their login is disabled.') && status.mutate({ action: 'offboard', reason })}>Offboard</Button>}
              </div>
              {member.status_reason && <p className="text-xs text-slate-500">Status note: {member.status_reason}</p>}
            </section>
          )}
        </div>
      )}

      {tab === 'personal' && (
        <div className="space-y-4">
          {can('staff.update') && manageable ? (
            <>
              {saveProfile.error && !(saveProfile.error instanceof ApiError && Object.keys(saveProfile.error.errors).length) && <ErrorBanner error={saveProfile.error} />}
              <ProfileFields value={profile} onChange={setProfile} errors={saveProfile.error instanceof ApiError ? saveProfile.error : undefined} />
              <div className="flex justify-end"><Button loading={saveProfile.isPending} onClick={() => saveProfile.mutate({ profile: profilePayload(profile) })}>Save personal information</Button></div>
            </>
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2">
              {info('Job title', member.profile?.job_title)}
              {info('Hire date', formatDate(member.profile?.hire_date))}
              {info('Mobile number', member.profile?.phone)}
              {info('Birth date', formatDate(member.profile?.birth_date))}
              {info('Address', member.profile?.address)}
              {info('Emergency contact', [member.profile?.emergency_contact_name, member.profile?.emergency_contact_phone].filter(Boolean).join(' · '))}
            </dl>
          )}
          <p className="text-xs text-slate-500">Personal information is visible only to staff administrators and the employee.</p>
        </div>
      )}

      {tab === 'access' && member.status !== 'offboarded' && (
        <section className="space-y-4">
          <RoleAndBranchFields roleIds={roleIds} onRolesChange={setRoleIds} all={all} setAll={setAll} branchIds={branchIds} setBranchIds={setBranchIds} />
          <div className="flex gap-2">
            {can('staff.assign_roles') && <Button size="sm" variant="secondary" loading={roles.isPending} disabled={roleIds.length === 0} onClick={() => roles.mutate({ role_ids: roleIds })}>Save roles</Button>}
            {can('staff.assign_branches') && <Button size="sm" variant="secondary" loading={branchesM.isPending} onClick={() => branchesM.mutate({ all_branches: all, branch_ids: all ? [] : branchIds })}>Save branches</Button>}
          </div>
        </section>
      )}
    </Modal>
  );
}

/* --------------------------------------------------------------------------- Roles */

function RolesTab() {
  const roles = useTenantQuery<{ data: Role[] }>('/roles');
  const [open, setOpen] = useState<Role | null>(null);
  return (
    <Card padded={false}>
      <DataTable
        rows={roles.data?.data}
        loading={roles.isPending}
        error={roles.error}
        rowKey={(r) => r.id}
        onRowClick={setOpen}
        columns={[
          { header: 'Role', cell: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
          { header: 'Type', cell: (r) => (r.is_system ? 'System' : 'Custom') },
          { header: 'Description', cell: (r) => <span className="text-slate-500">{r.description}</span> },
          { header: 'Permissions', cell: (r) => r.permissions?.length ?? 0, align: 'right' },
        ]}
      />
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''}>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">{open?.permissions?.map((p) => <li key={p}><code className="text-xs">{p}</code></li>)}</ul>
      </Modal>
    </Card>
  );
}
