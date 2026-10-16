import { BarChart3, Boxes, Briefcase, Calculator, Check, ClipboardList, Headset, ShoppingCart, ChevronRight, Clock, Copy, Crown, KeyRound, Layers, MailCheck, Package, Printer, Receipt, RotateCcw, Settings, ShieldAlert, ShieldCheck, Store, Truck, UserCheck, UserPlus, UserRound, UserX, Users, Wallet, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { BranchTag, ScopeChip } from '../../components/BranchSwitcher';
import { Avatar, Badge, Button, Checkbox, EmptyState, ErrorBanner, Field, Input, LoadingRows, Modal, PageHeader, Pagination, SearchField, Segmented, StatCard, Tabs, Textarea, cx } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { formatDate, formatDateTime, titleCase } from '../../lib/format';
import { printDocument } from '../../lib/print';
import { useDebounced, useTenantMutation, useTenantQuery } from '../../lib/hooks';
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
  const { can, tenant } = useTenant();
  const [tab, setTab] = useState<'members' | 'roles'>('members');
  if (!can('staff.view')) return <NoAccess what="team management" />;
  return (
    <>
      <PageHeader
        eyebrow="Business"
        title="Team"
        description="Staff accounts, roles and branch access. Employees sign in with the business code and their username."
        actions={<><BusinessCodeChip code={tenant.slug} /><ScopeChip /></>}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'members', label: 'Staff', icon: Users }, { value: 'roles', label: 'Roles & permissions', icon: ShieldCheck }]} />
      <div key={tab} className="auth-fade">{tab === 'members' ? <MembersTab /> : <RolesTab />}</div>
    </>
  );
}

function BusinessCodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" title="Staff use this code to sign in on a new device"
      onClick={() => { void navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-3.5 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-900/5 transition hover:ring-brand-200">
      <KeyRound className="size-3.5 text-brand-600" />
      Business code <span className="font-mono font-semibold text-brand-800">{code}</span>
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5 text-slate-400" />}
    </button>
  );
}

const STATUS_TONE: Record<StaffMember['status'], string> = {
  active: 'from-emerald-400 to-emerald-600',
  invited: 'from-sky-400 to-sky-600',
  suspended: 'from-amber-400 to-amber-600',
  offboarded: 'from-slate-300 to-slate-400',
};

export interface Credentials {
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

export interface IssuedResponse {
  data: StaffMember;
  activation_code: string | null;
  temporary_password: string | null;
  code_expires_at: string | null;
}

export const toCredentials = (r: IssuedResponse): Credentials => ({
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

function useStatusCount(status: string, branchId: number | undefined) {
  const q = useTenantQuery<Paginated<StaffMember>>('/staff', { status: status || undefined, branch_id: branchId, per_page: 1 });
  return q.data ? q.data.meta?.total ?? q.data.total ?? q.data.data.length : null;
}

/** Positions from most to least senior; custom roles go last. */
const ROLE_ORDER = ['business_owner', 'user_access_manager', 'branch_manager', 'accountant', 'auditor', 'purchasing_staff', 'inventory_staff', 'cashier', 'customer_service'];
const rank = (r?: Role) => (r ? (ROLE_ORDER.indexOf(r.key) + 1 || ROLE_ORDER.length + 1) : 99);
const primaryRole = (m: StaffMember) => [...(m.roles ?? [])].sort((a, b) => rank(a) - rank(b))[0];

const ROLE_ICON: Record<string, LucideIcon> = {
  business_owner: Crown, user_access_manager: ShieldCheck, branch_manager: Briefcase, accountant: Calculator, auditor: ClipboardList,
  purchasing_staff: Truck, inventory_staff: Boxes, cashier: ShoppingCart, customer_service: Headset,
};
const roleIcon = (r: Role) => ROLE_ICON[r.key] ?? UserRound;
const ROLE_TONE: Record<string, string> = {
  business_owner: 'from-sun-400 to-sun-500', user_access_manager: 'from-indigo-400 to-indigo-600', branch_manager: 'from-brand-500 to-brand-700',
  accountant: 'from-teal-400 to-emerald-600', auditor: 'from-slate-400 to-slate-600', purchasing_staff: 'from-violet-400 to-violet-600',
  inventory_staff: 'from-amber-400 to-orange-500', cashier: 'from-sky-400 to-sky-600', customer_service: 'from-rose-400 to-rose-600', default: 'from-slate-400 to-slate-500',
};

function RoleChip({ active, icon: Icon, label, count, tone = 'from-brand-500 to-brand-700', onClick }: { active: boolean; icon: LucideIcon; label: string; count: number; tone?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cx('inline-flex shrink-0 items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-3 text-xs font-semibold ring-1 transition', active ? 'bg-brand-900 text-white ring-brand-900 shadow-sm' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>
      <span className={cx('grid size-6 place-items-center rounded-lg bg-gradient-to-br text-white', tone)}><Icon className="size-3.5" /></span>
      {label}
      <span className={cx('rounded-full px-1.5 text-[10px] tabular-nums', active ? 'bg-white/20' : 'bg-slate-100 text-slate-500')}>{count}</span>
    </button>
  );
}

function MembersTab() {
  const { can, tenant, viewAll, scopeBranchId } = useTenant();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim());
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [roleId, setRoleId] = useState<number | null>(null);
  const filters = { status, q: q || undefined, branch_id: scopeBranchId, per_page: 100 };
  // Everyone matching the search/status (for the role counts), and the list itself (narrowed to one role if picked).
  const everyone = useTenantQuery<Paginated<StaffMember>>('/staff', { ...filters, page: 1 });
  const list = useTenantQuery<Paginated<StaffMember>>('/staff', { ...filters, page, role_id: roleId ?? undefined });
  const total = useStatusCount('', scopeBranchId);
  const active = useStatusCount('active', scopeBranchId);
  const invited = useStatusCount('invited', scopeBranchId);
  const suspended = useStatusCount('suspended', scopeBranchId);
  const rows = list.data?.data ?? [];
  const filtered = !!q || !!status || roleId !== null;
  const roleCounts = [...(everyone.data?.data ?? []).reduce((map, m) => {
    const r = primaryRole(m);
    if (r) map.set(r.id, { role: r, count: (map.get(r.id)?.count ?? 0) + 1 });
    return map;
  }, new Map<number, { role: Role; count: number }>()).values()].sort((a, b) => rank(a.role) - rank(b.role));
  const groups = [...rows.reduce((map, m) => {
    const r = primaryRole(m);
    const key = r?.id ?? 0;
    const g = map.get(key) ?? { role: r, members: [] as StaffMember[] };
    g.members.push(m);
    return map.set(key, g);
  }, new Map<number, { role: Role | undefined; members: StaffMember[] }>()).values()].sort((a, b) => rank(a.role) - rank(b.role));

  return (
    <>
      <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard tone="featured" icon={Users} label="Team members" value={total} hint={viewAll ? 'Across all branches' : 'Including all-branch staff'} />
        <StatCard tone="brand" icon={UserCheck} label="Active" value={active} hint="Can sign in and work" />
        <StatCard tone="sky" icon={MailCheck} label="Invited" value={invited} hint="Waiting for first sign-in" />
        <StatCard tone={suspended ? 'warn' : 'default'} icon={UserX} label="Suspended" value={suspended} hint={suspended ? 'Access paused' : 'No one suspended'} />
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <SearchField className="lg:w-80" value={term} onChange={(v) => { setTerm(v); setPage(1); }} placeholder="Search name, username or employee ID" />
          <Segmented label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }}
            options={[{ value: '', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'invited', label: 'Invited' }, { value: 'suspended', label: 'Suspended' }, { value: 'offboarded', label: 'Offboarded' }]} />
          {can('staff.create') && <Button className="lg:ml-auto" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>Add staff</Button>}
        </div>

        {/* Role / position categories */}
        {roleCounts.length > 0 && (
          <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-4 py-3 [scrollbar-width:none]">
            <RoleChip active={roleId === null} icon={Users} label="All positions" count={everyone.data?.data.length ?? 0} onClick={() => { setRoleId(null); setPage(1); }} />
            {roleCounts.map(({ role, count }) => (
              <RoleChip key={role.id} active={roleId === role.id} icon={roleIcon(role)} label={role.name} count={count} tone={ROLE_TONE[role.key] ?? ROLE_TONE.default} onClick={() => { setRoleId(roleId === role.id ? null : role.id); setPage(1); }} />
            ))}
          </div>
        )}

        {list.error ? <ErrorBanner error={list.error} className="m-4" /> : list.isPending ? <LoadingRows label="Loading staff" /> : rows.length === 0 ? (
          <EmptyState icon={Users} title={filtered ? 'No staff match' : 'No staff yet'}
            description={filtered ? 'Try another name or status.' : 'Add cashiers, inventory staff and managers so they can sign in.'}
            action={!filtered && can('staff.create') && <Button size="sm" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>Add staff</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wider text-slate-400">
                  <th scope="col" className="py-3 pl-5 pr-3 text-left font-semibold">Employee</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Role</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Branches</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Status</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Last sign-in</th>
                  <th scope="col" className="w-10" />
                </tr>
              </thead>
              {groups.map((g) => {
                const Icon = g.role ? roleIcon(g.role) : Users;
                const activeCount = g.members.filter((m) => m.status === 'active').length;
                return (
              <tbody key={g.role?.id ?? 0} className="divide-y divide-slate-100 border-b border-slate-100 last:border-b-0">
                <tr className="bg-gradient-to-r from-brand-50/70 via-slate-50/60 to-slate-50/30">
                  <th scope="colgroup" colSpan={6} className="py-2.5 pl-5 pr-4 text-left">
                    <span className="flex flex-wrap items-center gap-2.5">
                      <span className={cx('grid size-8 place-items-center rounded-lg bg-gradient-to-br text-white shadow-sm', g.role ? ROLE_TONE[g.role.key] ?? ROLE_TONE.default : ROLE_TONE.default)}><Icon className="size-4" /></span>
                      <span className="text-[13px] font-semibold text-slate-800">{g.role?.name ?? 'No role'}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">{g.members.length} {g.members.length === 1 ? 'person' : 'people'}</span>
                      {activeCount < g.members.length && <span className="text-[11px] text-slate-400">{activeCount} active</span>}
                      {g.role?.description && <span className="hidden truncate text-xs font-normal text-slate-400 xl:inline">· {g.role.description}</span>}
                    </span>
                  </th>
                </tr>
                {g.members.map((m) => {
                  const name = m.name ?? m.email ?? 'Unnamed';
                  const owner = m.user_id === tenant.owner_user_id;
                  return (
                    <tr key={m.id} tabIndex={0} onClick={() => setSelectedId(m.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(m.id); }}
                      className={cx('group cursor-pointer transition-colors hover:bg-brand-50/40 focus-visible:bg-brand-50/60 focus-visible:outline-none', m.status === 'offboarded' && 'opacity-60')}>
                      <td className="py-3 pl-5 pr-3">
                        <span className="flex items-center gap-3">
                          <span className="relative">
                            <Avatar name={name} />
                            <span className={cx('absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-gradient-to-br ring-2 ring-white', STATUS_TONE[m.status])} />
                          </span>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-1.5 font-medium text-slate-900">
                              {name}
                              {owner && <span className="inline-flex items-center gap-0.5 rounded-md bg-sun-300/30 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-sun-500"><Crown className="size-3" />Owner</span>}
                              {m.user_id === user?.id && <span className="rounded-md bg-slate-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-500">You</span>}
                            </span>
                            <span className="flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                              <span className="truncate">{m.username ?? m.email}</span>
                              {m.employee_code && <span className="rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-600">{m.employee_code}</span>}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex flex-wrap gap-1">
                          {m.roles?.map((r) => <span key={r.id} className={cx('whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset', r.id === g.role?.id ? 'bg-brand-50 text-brand-800 ring-brand-200' : 'bg-slate-50 text-slate-600 ring-slate-200')}>{r.name}</span>)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {m.all_branches
                          ? <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-gradient-to-r from-brand-600 to-brand-700 px-2 py-0.5 text-[11px] font-semibold text-white"><Layers className="size-3" />All branches</span>
                          : m.branches?.length
                            ? <span className="flex flex-wrap gap-1">{m.branches.map((b) => <BranchTag key={b.id} id={b.id} className={!viewAll && b.id === scopeBranchId ? 'bg-brand-50 text-brand-800 ring-brand-200' : undefined} />)}</span>
                            : <span className="text-slate-400">None</span>}
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex flex-col items-start gap-1">
                          <Badge status={m.status} />
                          {m.must_change_password && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700"><Clock className="size-3" />First sign-in pending</span>}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">{m.last_login_at ? formatDateTime(m.last_login_at) : <span className="text-slate-300">Never</span>}</td>
                      <td className="pr-4 text-right"><ChevronRight className="inline size-4 -translate-x-1 text-slate-300 opacity-0 transition group-hover:translate-x-0 group-hover:text-brand-600 group-hover:opacity-100" /></td>
                    </tr>
                  );
                })}
              </tbody>
                );
              })}
            </table>
          </div>
        )}
        <Pagination page={page} data={list.data} onPage={setPage} />
      </section>
      <CreateStaff open={creating} onClose={() => setCreating(false)} />
      {selectedId !== null && <StaffDetail id={selectedId} onClose={() => setSelectedId(null)} />}
    </>
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
            <label key={r.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm transition hover:border-slate-300 hover:bg-slate-50 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/60 has-[:checked]:ring-2 has-[:checked]:ring-brand-100">
              <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={roleIds.includes(r.id)} onChange={() => onRolesChange(toggle(roleIds, r.id))} />
              <span><span className="font-medium text-slate-900">{r.name}</span><span className="block text-xs text-slate-500">{r.description}</span></span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Branch access</p>
        <div className="flex flex-wrap gap-2">
          {allBranches && (
            <button type="button" aria-pressed={all} onClick={() => setAll(!all)} className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition', all ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>
              <Layers className="size-3.5" />All branches
            </button>
          )}
          {!all && branches.map((b) => {
            const on = branchIds.includes(b.id);
            return (
              <button key={b.id} type="button" aria-pressed={on} onClick={() => setBranchIds(toggle(branchIds, b.id))} className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition', on ? 'bg-brand-50 text-brand-800 ring-brand-400' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>
                {on ? <Check className="size-3.5" /> : <Store className="size-3.5 text-slate-400" />}{b.name}
              </button>
            );
          })}
        </div>
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
export function CredentialSlip({ credentials }: { credentials: Credentials }) {
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
            <button type="button" className="rounded-md border border-slate-200 px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50 print:hidden" onClick={() => copy(value)}>
              {copied === value ? 'Copied' : 'Copy'}
            </button>
          )}
        </span>
      </div>
    ) : null;

  return (
    <div className="space-y-3">
      <div className="print-area overflow-hidden rounded-2xl border border-slate-200 text-sm shadow-sm">
        <div className="flex items-center gap-3 bg-gradient-to-r from-brand-700 to-brand-900 px-4 py-3 text-white">
          <KeyRound className="size-5 text-sun-300" />
          <div><p className="font-display font-semibold">{tenant.name}</p><p className="text-[11px] text-brand-100/80">Staff sign-in details · keep private</p></div>
        </div>
        <div className="p-4">
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
      </div>
      <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-100">
        This is the only time the {credentials.temporaryPassword ? 'password' : 'code'} is shown. Print or copy it now — it is not stored in readable form and cannot be viewed later. If it is lost, use <strong>Reset password</strong> to issue a new one.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------------- Create */

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
        <span className="grid size-6 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white shadow-sm">{n}</span>
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
    <Modal open={open} onClose={close} title={issued ? 'Account created' : 'Add staff account'} icon={issued ? KeyRound : UserPlus} size="lg" description={issued ? 'Hand these details to the employee.' : 'Four quick steps. Sign-in details are generated for you.'}
      footer={issued
        ? <><Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => printDocument()}>Print slip</Button><Button onClick={close}>Done</Button></>
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
                <label key={o.value} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${o.disabled ? 'cursor-not-allowed border-slate-100 opacity-50' : 'cursor-pointer border-slate-200 hover:bg-slate-50 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/60'}`}>
                  <input type="radio" name="delivery" className="mt-0.5 accent-brand-600" value={o.value} checked={form.delivery === o.value} disabled={o.disabled} onChange={() => edit('delivery')(o.value)} />
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
            <button type="button" className="text-sm font-medium text-brand-700 hover:underline" onClick={() => setShowProfile((v) => !v)}>
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

  if (!member) return <Modal open onClose={onClose} title="Staff" icon={Users}>{detail.error ? <ErrorBanner error={detail.error} /> : <LoadingRows rows={3} />}</Modal>;

  const managed = member.account_type === 'company_managed';
  const isSelf = member.user_id === user?.id;
  const isOwner = member.user_id === tenant.owner_user_id;
  const manageable = !isSelf && !isOwner;
  const info = (label: string, value: string | null | undefined) => (
    <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100"><dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt><dd className="mt-0.5 text-sm font-medium text-slate-900">{value || '—'}</dd></div>
  );

  if (issued) {
    return (
      <Modal open onClose={onClose} title="New sign-in details" icon={KeyRound} size="md" footer={<><Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => printDocument()}>Print slip</Button><Button onClick={() => setIssued(null)}>Done</Button></>}>
        <CredentialSlip credentials={issued} />
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={member.name ?? member.email ?? 'Staff'} size="lg" description={member.roles?.map((r) => r.name).join(', ')}>
      <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl bg-gradient-to-br from-brand-50 to-cream/60 p-4 ring-1 ring-brand-100">
        <span className="relative">
          <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 font-display text-lg font-bold text-white shadow-md">{(member.name ?? member.email ?? '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')}</span>
          <span className={cx('absolute -bottom-1 -right-1 size-4 rounded-full bg-gradient-to-br ring-2 ring-white', STATUS_TONE[member.status])} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold text-slate-900">{member.name ?? member.email}<Badge status={member.status} />{isOwner && <span className="inline-flex items-center gap-0.5 rounded-md bg-sun-300/30 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-sun-500"><Crown className="size-3" />Owner</span>}</p>
          <p className="truncate text-xs text-slate-500">{[member.username, member.email, member.employee_code].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="text-right text-xs text-slate-500"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Last sign-in</p>{member.last_login_at ? formatDateTime(member.last_login_at) : 'Never'}</div>
      </div>
      <Tabs<DetailTab> value={tab} onChange={setTab} tabs={[
        { value: 'account', label: 'Account', icon: KeyRound },
        ...(member.profile !== undefined ? [{ value: 'personal' as DetailTab, label: 'Personal information', icon: UserRound }] : []),
        ...(manageable ? [{ value: 'access' as DetailTab, label: 'Roles & access', icon: ShieldCheck }] : []),
      ]} />

      {tab === 'account' && (
        <div className="space-y-5">
          <dl className="grid gap-2 sm:grid-cols-2">
            {info('Full name', member.name)}
            {info('Employee ID', member.employee_code)}
            {info('Business code', tenant.slug)}
            {info('Username', member.username)}
            {info('Email', member.email)}
            {info('Account type', member.account_type === 'company_managed' ? 'Company-managed' : 'Personal account')}
            {info('Signs in with', member.sign_in_with === 'email' ? 'Email + password' : 'Username or employee ID + password')}
            {info('Last sign-in', formatDateTime(member.last_login_at))}
            {info('Roles', member.roles?.map((r) => r.name).join(', '))}
            {info('Branches', member.all_branches ? 'All branches' : member.branches?.map((b) => b.name).join(', '))}
          </dl>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="grid size-9 place-items-center rounded-lg bg-brand-50 text-brand-600"><KeyRound className="size-4" /></span>
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
            <section className="space-y-3 rounded-xl border border-rose-100 bg-rose-50/30 p-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-rose-700"><ShieldAlert className="size-3.5" />Account status</p>
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

const PERMISSION_GROUP_ICON: Record<string, LucideIcon> = { sales: Receipt, refunds: RotateCcw, shifts: Clock, products: Package, categories: Package, inventory: Boxes, purchasing: Truck, suppliers: Truck, expenses: Wallet, reports: BarChart3, staff: Users, recruitment: UserPlus, tenant: Settings, branches: Settings, registers: Settings, customers: Users, audit_logs: ShieldCheck };

function RolesTab() {
  const roles = useTenantQuery<{ data: Role[] }>('/roles');
  const [open, setOpen] = useState<Role | null>(null);
  const rows = roles.data?.data ?? [];
  const max = Math.max(1, ...rows.map((r) => r.permissions?.length ?? 0));
  const groups = (open?.permissions ?? []).reduce<Record<string, string[]>>((acc, p) => {
    const [g, ...rest] = p.split('.');
    (acc[g] ??= []).push(rest.join('.') || g);
    return acc;
  }, {});

  if (roles.error) return <ErrorBanner error={roles.error} />;
  if (roles.isPending) return <LoadingRows label="Loading roles" />;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const count = r.permissions?.length ?? 0;
          return (
            <button key={r.id} type="button" onClick={() => setOpen(r)} className="group flex flex-col rounded-2xl bg-white p-5 text-left shadow-sm ring-1 ring-slate-900/5 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-brand-200">
              <div className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm shadow-brand-900/20"><ShieldCheck className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-display font-semibold text-slate-900">{r.name}</p>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    <span className={cx('rounded-md px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide', r.is_system ? 'bg-slate-100 text-slate-500' : 'bg-violet-50 text-violet-700')}>{r.is_system ? 'System' : 'Custom'}</span>
                    {r.requires_email_sign_in && <span className="rounded-md bg-sky-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-sky-700">Email sign-in</span>}
                  </span>
                </div>
                <ChevronRight className="size-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
              </div>
              <p className="mt-3 line-clamp-2 flex-1 text-sm text-slate-500">{r.description ?? 'No description.'}</p>
              <div className="mt-4">
                <div className="flex justify-between text-xs"><span className="text-slate-500">Permissions</span><span className="font-semibold tabular-nums text-slate-800">{count}</span></div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600" style={{ width: `${(count / max) * 100}%` }} /></div>
              </div>
            </button>
          );
        })}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} icon={ShieldCheck} size="lg" description={open ? `${open.permissions?.length ?? 0} permissions · ${open.is_system ? 'System role' : 'Custom role'}` : undefined}>
        <div className="space-y-4">
          {open?.description && <p className="text-sm text-slate-600">{open.description}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(groups).map(([g, perms]) => {
              const Icon = PERMISSION_GROUP_ICON[g] ?? ShieldCheck;
              return (
                <div key={g} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                  <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-800"><Icon className="size-3.5 text-brand-600" />{titleCase(g)}</p>
                  <ul className="flex flex-wrap gap-1">
                    {perms.map((p) => <li key={p} className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200"><Check className="size-3 text-emerald-600" />{titleCase(p)}</li>)}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
}
