import {
  Building2,
  Check,
  Copy,
  Loader2,
  MapPin,
  Monitor,
  Pencil,
  Percent,
  Phone,
  Plus,
  Power,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  Store,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import { useSearchParams } from 'react-router';
import { AccountSettings } from './AccountSettings';
import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, EmptyState, ErrorBanner, Field, FormSection, Input, LoadingRows, Modal, PageHeader, Select, Switch, cx } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Branch, Register, Tenant } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';

type Tab = 'profile' | 'tax' | 'policies' | 'branches' | 'registers' | 'account';
const BUSINESS_TABS: Tab[] = ['profile', 'tax', 'policies'];

export function SettingsPage() {
  const { can, tenant } = useTenant();
  const tabs: { value: Tab; label: string; icon: LucideIcon; note: string }[] = [
    ...(can('tenant.manage')
      ? [
          { value: 'profile' as Tab, label: 'Business profile', icon: Store, note: 'Name, contact, receipts' },
          { value: 'tax' as Tab, label: 'Tax & pricing', icon: Percent, note: 'VAT and price display' },
          { value: 'policies' as Tab, label: 'Policies', icon: ShieldCheck, note: 'Refunds, stock, hiring' },
        ]
      : []),
    ...(can('branches.manage') ? [{ value: 'branches' as Tab, label: 'Branches', icon: Building2, note: 'Store locations' }] : []),
    ...(can('registers.manage') ? [{ value: 'registers' as Tab, label: 'Registers', icon: Monitor, note: 'Checkout counters' }] : []),
    { value: 'account' as Tab, label: 'Account & security', icon: UserCog, note: 'Your email and password' },
  ];
  const [params, setParams] = useSearchParams();
  const requested = tabs.find((t) => t.value === params.get('tab'))?.value;
  const [tabState, setTabState] = useState<Tab>(requested ?? tabs[0].value);
  const tab = requested ?? tabState;
  const setTab = (t: Tab) => {
    setTabState(t);
    if (params.get('tab')) setParams({}, { replace: true });
  };

  return (
    <>
      <PageHeader eyebrow="Business" title="Settings" description={`Configure how ${tenant.name} runs: business details, tax, policies, branches and registers.`} />
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Settings sections" className="h-fit rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-900/5 lg:sticky lg:top-4">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {tabs.map((t) => {
              const active = tab === t.value;
              return (
                <li key={t.value} className="shrink-0">
                  <button type="button" onClick={() => setTab(t.value)} aria-current={active ? 'page' : undefined}
                    className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition', active ? 'bg-brand-700 text-white shadow-sm shadow-brand-900/20' : 'text-slate-600 hover:bg-slate-50')}>
                    <span className={cx('grid size-8 shrink-0 place-items-center rounded-lg', active ? 'bg-white/15 text-sun-300' : 'bg-slate-100 text-slate-500')}><t.icon className="size-4" /></span>
                    <span className="min-w-0">
                      <span className="block whitespace-nowrap text-sm font-medium">{t.label}</span>
                      <span className={cx('hidden truncate text-[11px] lg:block', active ? 'text-brand-100/80' : 'text-slate-400')}>{t.note}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          {can('tenant.manage') && <div className={cx(!BUSINESS_TABS.includes(tab) && 'hidden')}><BusinessSettings section={tab} /></div>}
          {tab === 'branches' && <BranchesPanel />}
          {tab === 'registers' && <RegistersPanel />}
          {tab === 'account' && <AccountSettings />}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Business */

const Panel = ({ title, description, icon: Icon, children, actions }: { title: string; description: string; icon: LucideIcon; children: ReactNode; actions?: ReactNode }) => (
  <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm shadow-brand-900/20"><Icon className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="font-display font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      {actions}
    </header>
    <div className="p-5">{children}</div>
  </section>
);

const SAVED_KEYS = ['name', 'legal_name', 'staff_email_domain', 'tin', 'address', 'phone', 'email', 'vat_rate', 'vat_registered', 'prices_include_vat', 'allow_negative_stock', 'recruitment_allow_self_approval', 'refund_approval_threshold', 'refund_window_days'] as const;

function BusinessSettings({ section }: { section: Tab }) {
  const { tenant, tenantId } = useTenant();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Tenant>({ ...tenant });
  useEffect(() => setForm({ ...tenant }), [tenant]);
  const save = useTenantMutation<Record<string, unknown>>('PATCH', '', {
    success: 'Settings saved.',
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tenant-context', tenantId] }),
    toastErrors: false,
  });
  const err = (f: string) => (save.error instanceof ApiError ? save.error.field(f) : undefined);
  const set = <K extends keyof Tenant>(k: K, v: Tenant[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: 'name' | 'legal_name' | 'tin' | 'address' | 'phone' | 'email', label: string, extra: { placeholder?: string; className?: string; hint?: string } = {}) => (
    <Field label={label} error={err(k)} className={extra.className} hint={extra.hint}>{(id) => <Input id={id} placeholder={extra.placeholder} value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)} />}</Field>
  );
  const dirty = SAVED_KEYS.some((k) => String(form[k] ?? '') !== String(tenant[k] ?? ''));
  const submit = () =>
    save.mutate({
      name: form.name, legal_name: form.legal_name || null, staff_email_domain: form.staff_email_domain || null, tin: form.tin || null, address: form.address || null, phone: form.phone || null, email: form.email || null,
      vat_rate: form.vat_rate, vat_registered: form.vat_registered, prices_include_vat: form.prices_include_vat, allow_negative_stock: form.allow_negative_stock,
      recruitment_allow_self_approval: form.recruitment_allow_self_approval,
      refund_approval_threshold: form.refund_approval_threshold, refund_window_days: form.refund_window_days,
    });

  // A sample ₱100 sale, to show what the VAT settings mean.
  const rate = Number(form.vat_rate) || 0;
  const sampleVat = !form.vat_registered ? 0 : form.prices_include_vat ? 100 - 100 / (1 + rate / 100) : rate;
  const sampleTotal = form.vat_registered && !form.prices_include_vat ? 100 + rate : 100;

  return (
    <div className="space-y-6 pb-20">
      {save.error instanceof ApiError && Object.keys(save.error.errors).length === 0 && <ErrorBanner error={save.error} />}

      {section === 'profile' && (
        <Panel title="Business profile" description="Shown on receipts, purchase orders and staff invitations." icon={Store}>
          <div className="mb-6 flex items-center gap-4 rounded-2xl bg-gradient-to-br from-brand-50 to-cream/70 p-4 ring-1 ring-brand-100">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 font-display text-xl font-bold text-white shadow-md">{(form.name || '?').slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg font-semibold text-slate-900">{form.name || 'Business name'}</p>
              <p className="truncate text-xs text-slate-500">{[form.legal_name, form.tin && `TIN ${form.tin}`].filter(Boolean).join(' · ') || 'Registered name and TIN appear here'}</p>
            </div>
            <BusinessCode code={tenant.slug} />
          </div>
          <div className="space-y-6">
            <FormSection title="Identity">
              <div className="grid gap-4 sm:grid-cols-2">
                {text('name', 'Business name')}
                {text('legal_name', 'Registered name', { placeholder: 'As registered with DTI / SEC' })}
                {text('tin', 'TIN', { placeholder: '000-000-000-000' })}
                <Field label="Staff email domain" error={err('staff_email_domain')} hint="Used to suggest staff emails. Only set a domain whose mailboxes you control.">{(id) => <Input id={id} placeholder="yourcompany.com" value={form.staff_email_domain ?? ''} onChange={(e) => set('staff_email_domain', e.target.value)} />}</Field>
              </div>
            </FormSection>
            <FormSection title="Contact">
              <div className="grid gap-4 sm:grid-cols-2">
                {text('address', 'Address', { className: 'sm:col-span-2' })}
                {text('phone', 'Phone', { placeholder: '09XX XXX XXXX' })}
                {text('email', 'Email', { placeholder: 'hello@yourstore.com' })}
              </div>
            </FormSection>
          </div>
        </Panel>
      )}

      {section === 'tax' && (
        <Panel title="Tax & pricing" description="How VAT is applied at the register and printed on receipts." icon={Percent}>
          <div className="grid gap-6 xl:grid-cols-[1fr_17rem]">
            <div className="space-y-2">
              <Switch label="VAT-registered" description="Receipts show VAT and the business is liable for output tax." checked={form.vat_registered} onChange={(v) => set('vat_registered', v)} />
              <Switch label="Prices include VAT" description="Shelf prices already contain VAT (typical in the Philippines)." checked={form.prices_include_vat} onChange={(v) => set('prices_include_vat', v)} disabled={!form.vat_registered} />
              <div className="px-3 pt-2">
                <Field label="VAT rate" error={err('vat_rate')}>
                  {(id) => (
                    <div className="flex h-10 w-40 items-center rounded-xl border border-slate-200 bg-white shadow-sm focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
                      <input id={id} inputMode="decimal" value={form.vat_rate} onChange={(e) => set('vat_rate', e.target.value)} disabled={!form.vat_registered} className="h-full w-full bg-transparent px-3 text-sm tabular-nums outline-none disabled:text-slate-400" />
                      <span className="pr-3 text-sm font-semibold text-slate-400">%</span>
                    </div>
                  )}
                </Field>
              </div>
            </div>
            <aside className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700"><ReceiptText className="size-3.5" /> Receipt preview</p>
              <div className="mt-3 space-y-1.5 rounded-xl bg-white p-3 font-mono text-xs text-slate-600 shadow-sm ring-1 ring-slate-900/5">
                <div className="flex justify-between"><span>1 × Sample item</span><span>{formatMoney('100.00')}</span></div>
                <div className="flex justify-between text-slate-400"><span>{form.vat_registered ? `VAT ${rate}%${form.prices_include_vat ? ' (incl.)' : ''}` : 'Non-VAT'}</span><span>{formatMoney(sampleVat.toFixed(2))}</span></div>
                <div className="flex justify-between border-t border-dashed border-slate-200 pt-1.5 font-bold text-slate-900"><span>TOTAL</span><span>{formatMoney(sampleTotal.toFixed(2))}</span></div>
              </div>
              <p className="mt-3 text-[11px] text-slate-500">Senior citizen and PWD sales are VAT-exempt automatically.</p>
            </aside>
          </div>
        </Panel>
      )}

      {section === 'policies' && (
        <>
          <Panel title="Refunds" description="When a manager must sign off on returning money." icon={RotateCcw}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Approval needed above" error={err('refund_approval_threshold')} hint="Refunds larger than this wait for a manager.">
                {(id) => (
                  <div className="flex h-10 items-center rounded-xl border border-slate-200 bg-white shadow-sm focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
                    <span className="pl-3 text-sm font-semibold text-slate-400">₱</span>
                    <input id={id} inputMode="decimal" value={form.refund_approval_threshold} onChange={(e) => set('refund_approval_threshold', e.target.value)} className="h-full w-full bg-transparent px-2 text-sm tabular-nums outline-none" />
                  </div>
                )}
              </Field>
              <Field label="Refund window" error={err('refund_window_days')} hint="Older sales need approval to refund.">
                {(id) => (
                  <div className="flex h-10 items-center rounded-xl border border-slate-200 bg-white shadow-sm focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
                    <input id={id} inputMode="numeric" value={String(form.refund_window_days)} onChange={(e) => set('refund_window_days', Number(e.target.value.replace(/\D/g, '')) || 0)} className="h-full w-full bg-transparent px-3 text-sm tabular-nums outline-none" />
                    <span className="pr-3 text-sm text-slate-400">days</span>
                  </div>
                )}
              </Field>
            </div>
          </Panel>
          <Panel title="Stock & hiring" description="Safeguards. The recommended setting is off for both." icon={ShieldCheck}>
            <div className="space-y-1">
              <Switch tone="warn" label="Allow selling below zero stock" description="Not recommended. Stock counts can go negative and hide shrinkage." checked={form.allow_negative_stock} onChange={(v) => set('allow_negative_stock', v)} />
              <Switch tone="warn" label="Let a recommender also give final hiring approval" description="Not recommended. Keeps the same delegate from approving their own recommendation." checked={form.recruitment_allow_self_approval} onChange={(v) => set('recruitment_allow_self_approval', v)} />
            </div>
          </Panel>
        </>
      )}

      {/* Sticky save bar */}
      <div className={cx('fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-brand-900 px-4 py-3 text-white shadow-2xl shadow-brand-900/30 ring-1 ring-white/10 transition duration-300 lg:pl-4', dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0')}>
        <span className="size-2 animate-pulse rounded-full bg-sun-400" />
        <span className="flex-1 text-sm">You have unsaved changes</span>
        <button type="button" onClick={() => setForm({ ...tenant })} className="rounded-lg px-3 py-1.5 text-sm text-brand-100 transition hover:bg-white/10">Discard</button>
        <button type="button" disabled={save.isPending} onClick={submit} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sun-400 px-3 text-sm font-semibold text-brand-900 transition hover:bg-sun-300 disabled:opacity-60">
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save changes
        </button>
      </div>
    </div>
  );
}

function BusinessCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" title="Staff sign in with this code"
      onClick={() => { void navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="hidden shrink-0 items-center gap-2 rounded-xl bg-white px-3 py-2 text-left shadow-sm ring-1 ring-slate-900/5 transition hover:ring-brand-200 sm:flex">
      <span>
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">Business code</span>
        <span className="block font-mono text-sm font-semibold text-brand-800">{code}</span>
      </span>
      {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4 text-slate-400" />}
    </button>
  );
}

/* ------------------------------------------------------------------ Branches */

function BranchesPanel() {
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();
  const list = useTenantQuery<{ data: Branch[] }>('/branches');
  const registers = useTenantQuery<{ data: Register[] }>('/registers');
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const [form, setForm] = useState({ code: '', name: '', address: '', phone: '', is_active: true });
  useEffect(() => {
    const b = editing && editing !== 'new' ? editing : null;
    setForm({ code: b?.code ?? '', name: b?.name ?? '', address: b?.address ?? '', phone: b?.phone ?? '', is_active: b?.is_active ?? true });
  }, [editing]);
  const isNew = editing === 'new';
  const save = useTenantMutation<Record<string, unknown>>(isNew ? 'POST' : 'PATCH', isNew ? '/branches' : `/branches/${(editing as Branch | null)?.id}`, {
    success: 'Branch saved.',
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['tenant-context', tenantId] });
    },
    toastErrors: false,
  });
  const err = (f: string) => (save.error instanceof ApiError ? save.error.field(f) : undefined);
  const rows = list.data?.data ?? [];

  return (
    <Panel title="Branches" description={`${rows.length} store ${rows.length === 1 ? 'location' : 'locations'}. Each keeps its own stock, registers and sales.`} icon={Building2}
      actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add branch</Button>}>
      {list.error ? <ErrorBanner error={list.error} /> : list.isPending ? <LoadingRows rows={3} /> : rows.length === 0 ? (
        <EmptyState icon={Building2} title="No branches yet" description="Add your first store location." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {rows.map((b) => {
            const regs = (registers.data?.data ?? []).filter((r) => r.branch_id === b.id);
            const live = regs.filter((r) => r.open_session).length;
            return (
              <article key={b.id} className={cx('group flex flex-col rounded-2xl p-4 ring-1 transition', b.is_active ? 'bg-white ring-slate-200 hover:shadow-md hover:ring-brand-200' : 'bg-slate-50 ring-slate-200')}>
                <div className="flex items-start gap-3">
                  <span className={cx('grid size-11 shrink-0 place-items-center rounded-xl font-mono text-xs font-bold', b.is_active ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white' : 'bg-slate-200 text-slate-500')}>{b.code}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display font-semibold text-slate-900">{b.name}</p>
                    <Badge status={b.is_active ? 'active' : 'archived'}>{b.is_active ? 'Active' : 'Inactive'}</Badge>
                  </div>
                  <button type="button" onClick={() => setEditing(b)} aria-label={`Edit ${b.name}`} className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-brand-50 hover:text-brand-700"><Pencil className="size-4" /></button>
                </div>
                <div className="mt-4 space-y-1.5 text-sm text-slate-600">
                  <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-3.5 shrink-0 text-slate-400" /><span className={cx(!b.address && 'text-slate-300')}>{b.address ?? 'No address'}</span></p>
                  <p className="flex items-center gap-2"><Phone className="size-3.5 shrink-0 text-slate-400" /><span className={cx(!b.phone && 'text-slate-300')}>{b.phone ?? 'No phone'}</span></p>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-slate-500"><Monitor className="size-3.5" />{regs.length} {regs.length === 1 ? 'register' : 'registers'}</span>
                  {live > 0 && <span className="inline-flex items-center gap-1 font-medium text-emerald-700"><span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />{live} open now</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={isNew ? 'Add branch' : 'Edit branch'} icon={Building2}
        description={isNew ? 'The code is printed on receipts and cannot be changed later.' : `Code ${form.code}`}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={!form.name.trim() || (isNew && !form.code.trim())} loading={save.isPending} onClick={() => save.mutate(isNew ? { code: form.code, name: form.name, address: form.address || null, phone: form.phone || null } : { name: form.name, address: form.address || null, phone: form.phone || null, is_active: form.is_active })}>{isNew ? 'Add branch' : 'Save changes'}</Button></>}>
        <div className="space-y-5">
          {save.error instanceof ApiError && Object.keys(save.error.errors).length === 0 && <ErrorBanner error={save.error} />}
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            {isNew && <Field label="Code" error={err('code')} hint="e.g. MKT">{(id) => <Input id={id} className="font-mono uppercase" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} />}</Field>}
            <Field label="Name" error={err('name')} className={isNew ? undefined : 'sm:col-span-2'}>{(id) => <Input id={id} placeholder="e.g. Makati Branch" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />}</Field>
          </div>
          <Field label="Address">{(id) => <Input id={id} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />}</Field>
          {!isNew && <Switch label="Active" description="Inactive branches are hidden from the branch switcher and cannot sell." checked={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />}
        </div>
      </Modal>
    </Panel>
  );
}

/* ------------------------------------------------------------------ Registers */

function RegistersPanel() {
  const { branches, branch } = useTenant();
  const list = useTenantQuery<{ data: Register[] }>('/registers');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ branch_id: String(branch?.id ?? branches[0]?.id ?? ''), code: '', name: '' });
  const create = useTenantMutation<Record<string, unknown>>('POST', '/registers', { success: 'Register added.', onSuccess: () => { setAdding(false); setForm((f) => ({ ...f, code: '', name: '' })); }, toastErrors: false });
  const toggle = useTenantMutation<Register>('PATCH', (r) => `/registers/${r.id}`, { success: 'Register updated.' });
  const err = (f: string) => (create.error instanceof ApiError ? create.error.field(f) : undefined);
  const rows = list.data?.data ?? [];
  const groups = branches.map((b) => ({ branch: b, regs: rows.filter((r) => r.branch_id === b.id) })).filter((g) => g.regs.length > 0);

  return (
    <Panel title="Registers" description={`${rows.length} checkout ${rows.length === 1 ? 'counter' : 'counters'}. Cashiers open a shift on a register to start selling.`} icon={Monitor}
      actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add register</Button>}>
      {list.error ? <ErrorBanner error={list.error} /> : list.isPending ? <LoadingRows rows={3} /> : rows.length === 0 ? (
        <EmptyState icon={Monitor} title="No registers yet" description="Add a register for each checkout counter." />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.branch.id}>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500"><Store className="size-3.5 text-brand-600" />{g.branch.name}<span className="h-px flex-1 bg-slate-100" /></p>
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {g.regs.map((r) => (
                  <div key={r.id} className={cx('flex items-center gap-3 rounded-xl p-3 ring-1 transition', r.is_active ? 'bg-white ring-slate-200' : 'bg-slate-50 ring-slate-200')}>
                    <span className={cx('relative grid size-10 shrink-0 place-items-center rounded-xl', r.open_session ? 'bg-emerald-50 text-emerald-600' : r.is_active ? 'bg-brand-50 text-brand-600' : 'bg-slate-200 text-slate-400')}>
                      <Monitor className="size-5" />
                      {r.open_session && <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full bg-emerald-500 ring-2 ring-white" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cx('block truncate font-medium', r.is_active ? 'text-slate-900' : 'text-slate-400')}>{r.name}</span>
                      <span className="flex items-center gap-2 text-xs text-slate-400"><span className="font-mono">{r.code}</span>{r.open_session ? <span className="font-medium text-emerald-700">Shift open</span> : !r.is_active && <span>Inactive</span>}</span>
                    </span>
                    <button type="button" title={r.is_active ? 'Deactivate' : 'Activate'} aria-label={`${r.is_active ? 'Deactivate' : 'Activate'} ${r.name}`}
                      disabled={!!r.open_session && r.is_active}
                      onClick={() => toggle.mutate({ ...r, is_active: !r.is_active })}
                      className={cx('grid size-8 place-items-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40', r.is_active ? 'text-slate-400 hover:bg-rose-50 hover:text-rose-600' : 'text-brand-600 hover:bg-brand-50')}>
                      <Power className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add register" icon={Monitor} description="A checkout counter where cashiers open shifts."
        footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button disabled={!form.code.trim() || !form.name.trim()} loading={create.isPending} onClick={() => create.mutate({ branch_id: Number(form.branch_id), code: form.code, name: form.name })}>Add register</Button></>}>
        <div className="grid gap-4">
          <Field label="Branch" error={err('branch_id')}>{(id) => <Select id={id} value={form.branch_id} onChange={(e) => setForm((f) => ({ ...f, branch_id: e.target.value }))}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <Field label="Code" error={err('code')}>{(id) => <Input id={id} className="font-mono uppercase" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="REG-2" />}</Field>
            <Field label="Name" error={err('name')}>{(id) => <Input id={id} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Register 2" />}</Field>
          </div>
        </div>
      </Modal>
    </Panel>
  );
}
