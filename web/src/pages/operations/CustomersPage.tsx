import {
  BadgeCheck,
  ChevronRight,
  Download,
  FileText,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  UserCheck,
  UserMinus,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { StatCard, Button, Checkbox, ErrorBanner, Field, Input, Modal, Pagination, Textarea, cx } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { todayManila } from '../../lib/format';
import { useDebounced, useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Customer, Paginated } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';

/** A stable avatar colour per customer, so the same person always looks the same. */
const AVATARS = [
  'from-brand-400 to-brand-700',
  'from-sun-400 to-amber-600',
  'from-sky-400 to-sky-700',
  'from-violet-400 to-violet-700',
  'from-rose-400 to-rose-600',
  'from-emerald-400 to-emerald-700',
];
const avatarFor = (name: string) => AVATARS[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATARS.length];

/** Downloads the listed customers as a CSV file. */
function exportCsv(rows: Customer[]) {
  const header = ['Name', 'Phone', 'Email', 'TIN', 'Address', 'Status', 'Notes'];
  const lines = rows.map((c) => [c.name, c.phone ?? '', c.email ?? '', c.tin ?? '', c.address ?? '', c.is_active ? 'Active' : 'Inactive', c.notes ?? '']);
  const csv = [header, ...lines].map((cols) => cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `customers-${todayManila()}.csv` });
  link.click();
  URL.revokeObjectURL(url);
}

export function CustomersPage() {
  const { can } = useTenant();
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const q = useDebounced(term);
  const list = useTenantQuery<Paginated<Customer>>('/customers', { q: q || undefined, page, include_inactive: 1 });

  if (!can('customers.view')) return <NoAccess what="customers" />;
  const canManage = can('customers.manage');

  const rows = list.data?.data ?? [];
  const total = list.data?.meta?.total ?? list.data?.total ?? rows.length;
  const partial = total > rows.length;
  const active = rows.filter((c) => c.is_active).length;
  const withTin = rows.filter((c) => c.tin).length;
  const searching = term.trim() !== '';
  const pageNote = partial ? 'On this page' : searching ? 'Matching your search' : 'All customers';
  const clearSearch = () => { setTerm(''); setPage(1); };

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700 shadow-sm ring-1 ring-brand-900/10 backdrop-blur"><span className="size-1.5 rounded-full bg-gradient-to-br from-brand-400 to-brand-600" />Selling</p>
          <h1 className="mt-2.5 font-display text-[1.75rem] font-extrabold leading-[1.1] tracking-[-0.02em] text-brand-900 sm:text-[2.15rem]">Customers</h1>
          <p className="mt-1 text-sm text-slate-500">Regulars and business buyers, with the details needed for official receipts.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={() => exportCsv(rows)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-800 shadow-sm ring-1 ring-slate-900/5 transition hover:bg-brand-50 hover:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="size-4" /> Export CSV
          </button>
          {canManage && <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add customer</Button>}
        </div>
      </header>

      {/* Summary */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat Icon={Users} label="Customers" value={list.data ? String(total) : null} note={searching ? 'Matching your search' : 'Saved in your store'} tint="brand" />
        <Stat Icon={UserCheck} label="Active" value={list.data ? String(active) : null} note={pageNote} tint="emerald" />
        <Stat Icon={UserMinus} label="Inactive" value={list.data ? String(rows.length - active) : null} note={pageNote} tint="slate" />
        <Stat Icon={FileText} label="With TIN" value={list.data ? String(withTin) : null} note="Ready for official receipts" tint="sun" />
      </section>

      {/* Directory */}
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="group relative flex h-10 items-center rounded-xl bg-slate-50 ring-1 ring-slate-200 transition focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-500 sm:w-96">
            <Search className="pointer-events-none ml-3 size-4 text-slate-400 transition group-focus-within:text-brand-600" />
            <input
              className="h-full w-full bg-transparent pl-2.5 pr-8 text-sm outline-none placeholder:text-slate-400"
              placeholder="Search name, phone or email"
              value={term}
              onChange={(e) => { setTerm(e.target.value); setPage(1); }}
              aria-label="Search customers"
            />
            {term && (
              <button type="button" aria-label="Clear search" onClick={clearSearch} className="absolute right-2 grid size-6 place-items-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                <X className="size-3.5" />
              </button>
            )}
          </label>
          {list.data && rows.length > 0 && (
            <p className="text-xs text-slate-500">
              Showing <span className="font-semibold text-slate-700">{rows.length}</span> of <span className="font-semibold text-slate-700">{total}</span>
              {canManage && <span className="hidden sm:inline"> · Click a customer to edit</span>}
            </p>
          )}
        </div>

        {list.error ? (
          <ErrorBanner error={list.error} className="m-4" />
        ) : list.isPending ? (
          <LoadingRows />
        ) : rows.length === 0 ? (
          searching ? (
            <Empty Icon={Search} title={`No customers match “${term.trim()}”`} body="Check the spelling, or search by phone number or email instead."
              action={<button type="button" onClick={clearSearch} className="text-sm font-semibold text-brand-700 hover:underline">Clear search</button>} />
          ) : (
            <Empty Icon={Users} title="No customers yet" body="Save regulars and business buyers here. Their TIN and address are filled in automatically on official receipts."
              action={canManage ? <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add your first customer</Button> : undefined} />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="sp-cards w-full text-sm">
              <thead className="bg-slate-50/70">
                <tr className="text-[11px] uppercase tracking-wider text-slate-400">
                  <th scope="col" className="py-3 pl-5 pr-3 text-left font-semibold">Customer</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Contact</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">TIN</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Status</th>
                  <th scope="col" className="w-10 pr-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    onClick={canManage ? () => setEditing(c) : undefined}
                    onKeyDown={canManage ? (e) => { if (e.key === 'Enter') setEditing(c); } : undefined}
                    tabIndex={canManage ? 0 : undefined}
                    aria-label={canManage ? `Edit ${c.name}` : undefined}
                    className={cx('group transition-colors', canManage && 'cursor-pointer hover:bg-brand-50/50 focus-visible:bg-brand-50/60 focus-visible:outline-none', !c.is_active && 'opacity-70')}
                  >
                    <td className="py-3.5 pl-5 pr-3">
                      <span className="flex items-center gap-3">
                        <span className={cx('grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br text-xs font-bold text-white shadow-sm', c.is_active ? avatarFor(c.name) : 'from-slate-300 to-slate-400')}>
                          {initials(c.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-slate-900">{c.name}</span>
                          {c.address ? (
                            <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500"><MapPin className="size-3 shrink-0" />{c.address}</span>
                          ) : c.notes ? (
                            <span className="mt-0.5 block max-w-xs truncate text-xs text-slate-400">{c.notes}</span>
                          ) : null}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="flex flex-col gap-1">
                        {c.phone && (
                          <a href={`tel:${c.phone}`} onClick={(e) => e.stopPropagation()} className="inline-flex w-fit items-center gap-1.5 text-slate-700 hover:text-brand-700">
                            <Phone className="size-3.5 text-slate-400" />{c.phone}
                          </a>
                        )}
                        {c.email && (
                          <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()} className="inline-flex w-fit items-center gap-1.5 text-xs text-slate-500 hover:text-brand-700">
                            <Mail className="size-3.5 text-slate-400" />{c.email}
                          </a>
                        )}
                        {!c.phone && !c.email && <span className="text-slate-300">—</span>}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      {c.tin ? (
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-sun-300/25 px-2 py-0.5 font-mono text-[0.78rem] text-amber-900 ring-1 ring-inset ring-amber-500/20">
                          <BadgeCheck className="size-3.5" />{c.tin}
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-3.5">
                      <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
                        c.is_active ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-slate-100 text-slate-500 ring-slate-500/15')}>
                        <span className={cx('size-1.5 rounded-full', c.is_active ? 'bg-emerald-500' : 'bg-slate-400')} />
                        {c.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="pr-4 text-right">
                      {canManage && <ChevronRight className="inline size-4 -translate-x-1 text-slate-300 opacity-0 transition group-hover:translate-x-0 group-hover:text-brand-600 group-hover:opacity-100" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} data={list.data} onPage={setPage} />
      </section>

      <CustomerForm customer={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

/* --------------------------------------------------------------------------- Pieces */

const TINTS = {
  brand: 'bg-brand-50 text-brand-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  slate: 'bg-slate-100 text-slate-500',
  sun: 'bg-sun-300/30 text-amber-700',
};

function Stat({ Icon, label, value, note, tint }: { Icon: LucideIcon; label: string; value: string | null; note: string; tint: keyof typeof TINTS }) {
  const tone = ({ brand: 'brand', emerald: 'brand', amber: 'warn', slate: 'default', rose: 'rose', sun: 'sun', sky: 'sky', violet: 'sky' } as const as Record<string, 'brand' | 'warn' | 'default' | 'rose' | 'sun' | 'sky'>)[tint] ?? 'default';
  return <StatCard icon={Icon} label={label} value={value} hint={note} tone={tone} />;
}

function Empty({ Icon, title, body, action }: { Icon: LucideIcon; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="relative grid size-16 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
        <Icon className="size-7" />
        <span aria-hidden className="absolute -right-1.5 -top-1.5 size-4 rounded-full bg-sun-400 ring-4 ring-white" />
      </span>
      <p className="mt-5 font-display text-base font-semibold text-slate-900">{title}</p>
      <p className="mt-1 max-w-md text-sm text-slate-500">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Placeholder rows shown while customers load. */
function LoadingRows() {
  return (
    <div className="divide-y divide-slate-100" role="status" aria-label="Loading customers">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <span className="size-10 animate-pulse rounded-full bg-slate-100" />
          <span className="space-y-2">
            <span className="block h-3 w-40 animate-pulse rounded bg-slate-100" />
            <span className="block h-2.5 w-24 animate-pulse rounded bg-slate-100" />
          </span>
          <span className="ml-auto hidden h-3 w-32 animate-pulse rounded bg-slate-100 sm:block" />
          <span className="h-5 w-16 animate-pulse rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function CustomerForm({ customer, onClose }: { customer: Customer | 'new' | null; onClose: () => void }) {
  const isNew = customer === 'new';
  const [form, setForm] = useState({ name: '', phone: '', email: '', tin: '', address: '', notes: '', is_active: true });
  useEffect(() => {
    const c = customer && customer !== 'new' ? customer : null;
    setForm({ name: c?.name ?? '', phone: c?.phone ?? '', email: c?.email ?? '', tin: c?.tin ?? '', address: c?.address ?? '', notes: c?.notes ?? '', is_active: c?.is_active ?? true });
  }, [customer]);
  const save = useTenantMutation<Record<string, unknown>>(isNew ? 'POST' : 'PATCH', isNew ? '/customers' : `/customers/${(customer as Customer | null)?.id}`, { success: 'Customer saved.', onSuccess: onClose, toastErrors: false });
  const err = (f: string) => (save.error instanceof ApiError ? save.error.field(f) : undefined);
  const body = () => Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Modal open={customer !== null} onClose={onClose} title={isNew ? 'Add customer' : 'Edit customer'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate(body())}>{isNew ? 'Add customer' : 'Save changes'}</Button></>}>
      {/* Live preview of how the customer will appear */}
      <div className="mb-5 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-brand-50 to-cream/60 p-4 ring-1 ring-brand-100">
        <span className={cx('grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br text-sm font-bold text-white shadow-sm', form.name.trim() ? avatarFor(form.name) : 'from-slate-300 to-slate-400')}>
          {initials(form.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-display font-semibold text-slate-900">{form.name.trim() || 'New customer'}</p>
          <p className="truncate text-xs text-slate-500">{[form.phone, form.email].filter(Boolean).join(' · ') || 'Add a phone number or email below'}</p>
        </div>
        {form.tin && <span className="ml-auto hidden rounded-md bg-sun-300/30 px-2 py-0.5 text-[11px] font-semibold text-amber-900 sm:inline">TIN on file</span>}
      </div>

      <FormSection title="Contact">
        <Field label="Full name" error={err('name')} className="sm:col-span-2">{(id) => <Input id={id} value={form.name} autoFocus placeholder="e.g. Juan Dela Cruz" onChange={(e) => set({ name: e.target.value })} />}</Field>
        <Field label="Phone" error={err('phone')}>{(id) => <Input id={id} value={form.phone} placeholder="09XX XXX XXXX" inputMode="tel" onChange={(e) => set({ phone: e.target.value })} />}</Field>
        <Field label="Email" error={err('email')}>{(id) => <Input id={id} type="email" value={form.email} placeholder="name@example.com" onChange={(e) => set({ email: e.target.value })} />}</Field>
      </FormSection>

      <FormSection title="Business details" hint="Printed on official receipts when this customer is selected at checkout.">
        <Field label="TIN" error={err('tin')}>{(id) => <Input id={id} value={form.tin} placeholder="000-000-000-000" onChange={(e) => set({ tin: e.target.value })} />}</Field>
        <Field label="Address" error={err('address')}>{(id) => <Input id={id} value={form.address} placeholder="Street, barangay, city" onChange={(e) => set({ address: e.target.value })} />}</Field>
        <Field label="Notes" className="sm:col-span-2">{(id) => <Textarea id={id} value={form.notes} placeholder="Preferences, credit terms, anything worth remembering" onChange={(e) => set({ notes: e.target.value })} />}</Field>
      </FormSection>

      {!isNew && (
        <div className="mt-2 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
          <Checkbox label="Active customer (can be selected at checkout)" checked={form.is_active} onChange={(v) => set({ is_active: v })} />
        </div>
      )}
    </Modal>
  );
}

function FormSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="mb-5">
      <legend className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">{title}</legend>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
