import {
  AtSign,
  Building2,
  Check,
  ChevronRight,
  Circle,
  Copy,
  ExternalLink,
  Hash,
  Landmark,
  Mail,
  ShoppingBag,
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
import { Badge, Button, EmptyState, ErrorBanner, Field, Input, LoadingRows, Modal, PageHeader, Select, Switch, cx } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Branch, Register, Tenant } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { LocationPicker, toLatLng, type LatLng } from '../../components/maps';

type Tab = 'profile' | 'tax' | 'policies' | 'branches' | 'registers' | 'account';
const BUSINESS_TABS: Tab[] = ['profile', 'tax', 'policies'];

type TabDef = { value: Tab; label: string; icon: LucideIcon; note: string; group: 'Business' | 'Operations' | 'You' };

export function SettingsPage() {
  const { can, tenant, branches } = useTenant();
  const tabs: TabDef[] = [
    ...(can('tenant.manage')
      ? [
          { value: 'profile' as Tab, label: 'Business profile', icon: Store, note: 'Name, contact, receipts', group: 'Business' as const },
          { value: 'tax' as Tab, label: 'Tax & pricing', icon: Percent, note: 'VAT and price display', group: 'Business' as const },
          { value: 'policies' as Tab, label: 'Policies', icon: ShieldCheck, note: 'Refunds, stock, hiring', group: 'Business' as const },
        ]
      : []),
    ...(can('branches.manage') ? [{ value: 'branches' as Tab, label: 'Branches', icon: Building2, note: 'Store locations', group: 'Operations' as const }] : []),
    ...(can('registers.manage') ? [{ value: 'registers' as Tab, label: 'Registers', icon: Monitor, note: 'Checkout counters', group: 'Operations' as const }] : []),
    { value: 'account' as Tab, label: 'Account & security', icon: UserCog, note: 'Your email and password', group: 'You' },
  ];
  const groups = (['Business', 'Operations', 'You'] as const).map((g) => ({ name: g, items: tabs.filter((t) => t.group === g) })).filter((g) => g.items.length > 0);
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
      {/* Business card */}
      <section className="relative mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-800 to-[#082419] p-5 text-white shadow-xl shadow-brand-900/20 sm:p-6">
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-sun-400/20 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 size-72 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center">
          <img src="/brand/minimart-logo.svg" alt="" className="size-20 shrink-0 rounded-2xl bg-white object-contain p-1.5 shadow-lg ring-4 ring-white/15" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-2xl font-bold tracking-tight sm:text-3xl">{tenant.name}</h2>
            <p className="mt-0.5 truncate text-sm text-brand-100/80">{[tenant.legal_name, tenant.tin && `TIN ${tenant.tin}`].filter(Boolean).join(' · ') || 'Add your registered name and TIN in the business profile'}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/15"><Building2 className="size-3.5 text-sun-300" />{branches.length} {branches.length === 1 ? 'branch' : 'branches'}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/15"><Percent className="size-3.5 text-sun-300" />{tenant.vat_registered ? `VAT ${Number(tenant.vat_rate)}%` : 'Non-VAT'}</span>
              {tenant.address && <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/15"><MapPin className="size-3.5 shrink-0 text-sun-300" /><span className="truncate">{tenant.address}</span></span>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <BusinessCode code={tenant.slug} />
            <a href={`/shop/${tenant.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-[52px] items-center gap-2 rounded-xl bg-sun-400 px-4 text-sm font-bold text-brand-900 shadow-sm transition hover:bg-sun-300">
              <ShoppingBag className="size-4" /> Online shop <ExternalLink className="size-3.5" />
            </a>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="h-fit min-w-0 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-900/5">
          <div className="flex gap-1 overflow-x-auto lg:block lg:space-y-2">
            {groups.map((g) => (
              <div key={g.name} className="shrink-0">
                <p className="hidden px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 lg:block">{g.name}</p>
                <ul className="flex gap-1 lg:block lg:space-y-0.5">
                  {g.items.map((t) => {
                    const active = tab === t.value;
                    return (
                      <li key={t.value} className="shrink-0">
                        <button type="button" onClick={() => setTab(t.value)} aria-current={active ? 'page' : undefined}
                          className={cx('group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition', active ? 'bg-brand-50 text-brand-900' : 'text-slate-600 hover:bg-slate-50')}>
                          {active && <span aria-hidden className="absolute inset-y-2 left-0 hidden w-1 rounded-full bg-brand-600 lg:block" />}
                          <span className={cx('grid size-9 shrink-0 place-items-center rounded-xl transition', active ? 'bg-brand-700 text-sun-300 shadow-sm shadow-brand-900/20' : 'bg-slate-100 text-slate-500 group-hover:bg-white group-hover:ring-1 group-hover:ring-slate-200')}><t.icon className="size-4" /></span>
                          <span className="min-w-0 flex-1">
                            <span className={cx('block whitespace-nowrap text-sm', active ? 'font-semibold' : 'font-medium')}>{t.label}</span>
                            <span className={cx('hidden truncate text-[11px] lg:block', active ? 'text-brand-700/70' : 'text-slate-400')}>{t.note}</span>
                          </span>
                          <ChevronRight className={cx('hidden size-4 shrink-0 transition lg:block', active ? 'text-brand-600' : 'text-slate-300 group-hover:translate-x-0.5')} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
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
  const text = (k: 'name' | 'legal_name' | 'tin' | 'address' | 'phone' | 'email', label: string, extra: { icon: LucideIcon; placeholder?: string; className?: string; hint?: string }) => (
    <Field label={label} error={err(k)} className={extra.className} hint={extra.hint}>{(id) => <IconInput id={id} icon={extra.icon} placeholder={extra.placeholder} value={form[k] ?? ''} onChange={(v) => set(k, v)} />}</Field>
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
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-6">
            <Panel title="Identity" description="Who the business is. Printed on receipts and purchase orders." icon={Store}>
              <div className="grid gap-4 sm:grid-cols-2">
                {text('name', 'Business name', { icon: Store })}
                {text('legal_name', 'Registered name', { icon: Landmark, placeholder: 'As registered with DTI / SEC' })}
                {text('tin', 'TIN', { icon: Hash, placeholder: '000-000-000-000', hint: 'Tax Identification Number, printed on every receipt.' })}
                <Field label="Staff email domain" error={err('staff_email_domain')} hint="Used to suggest staff emails. Only set a domain whose mailboxes you control.">
                  {(id) => <IconInput id={id} icon={AtSign} placeholder="yourcompany.com" value={form.staff_email_domain ?? ''} onChange={(v) => set('staff_email_domain', v)} />}
                </Field>
              </div>
            </Panel>
            <Panel title="Contact" description="How customers and suppliers reach you. Shown on receipts and staff invitations." icon={Phone}>
              <div className="grid gap-4 sm:grid-cols-2">
                {text('address', 'Address', { icon: MapPin, className: 'sm:col-span-2', placeholder: 'Street, barangay, city' })}
                {text('phone', 'Phone', { icon: Phone, placeholder: '09XX XXX XXXX' })}
                {text('email', 'Email', { icon: Mail, placeholder: 'hello@yourstore.com' })}
              </div>
            </Panel>
          </div>

          <aside className="space-y-6">
            <ProfileChecklist form={form} />
            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700"><ReceiptText className="size-3.5" /> Receipt header preview</p>
              <div className="mt-3 rounded-xl bg-[#fffdf7] px-4 pb-4 pt-4 text-center font-mono text-[11px] leading-relaxed text-slate-600 shadow-sm ring-1 ring-slate-900/5">
                <p className="text-[13px] font-bold uppercase tracking-wide text-slate-900">{form.name || 'Business name'}</p>
                {form.legal_name && <p>{form.legal_name}</p>}
                <p className={cx(!form.address && 'text-slate-300')}>{form.address || 'Address'}</p>
                <p className={cx(!form.tin && 'text-slate-300')}>{form.vat_registered ? 'VAT' : 'NON-VAT'} REG TIN: {form.tin || '000-000-000-000'}</p>
                {(form.phone || form.email) && <p>{[form.phone, form.email].filter(Boolean).join(' · ')}</p>}
                <p className="my-2 border-t border-dashed border-slate-300" />
                <p className="flex justify-between"><span>SALES INVOICE</span><span>#000123</span></p>
              </div>
              <p className="mt-3 text-[11px] text-slate-500">Updates as you type. Save to use it on new receipts.</p>
            </section>
          </aside>
        </div>
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
      <div className={cx('fixed inset-x-4 bottom-24 z-40 md:bottom-4 mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-brand-900 px-4 py-3 text-white shadow-2xl shadow-brand-900/30 ring-1 ring-white/10 transition duration-300 lg:pl-4', dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0')}>
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
    <button type="button" title="Staff sign in with this code. Click to copy."
      onClick={() => { void navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="flex h-[52px] shrink-0 items-center gap-3 rounded-xl bg-white/10 px-3.5 text-left ring-1 ring-white/20 backdrop-blur transition hover:bg-white/15">
      <span>
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-brand-100/70">{copied ? 'Copied' : 'Business code'}</span>
        <span className="block font-mono text-sm font-semibold text-white">{code}</span>
      </span>
      {copied ? <Check className="size-4 text-emerald-300" /> : <Copy className="size-4 text-brand-100/70" />}
    </button>
  );
}

/** Text input with a leading icon, matching the standard input style. */
function IconInput({ id, icon: Icon, value, placeholder, onChange }: { id: string; icon: LucideIcon; value: string; placeholder?: string; onChange: (value: string) => void }) {
  return (
    <div className="relative">
      <Icon aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <Input id={id} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="pl-9" />
    </div>
  );
}

/** How complete the business profile is, with the missing details listed. */
function ProfileChecklist({ form }: { form: Tenant }) {
  const items = [
    { label: 'Business name', done: !!form.name?.trim() },
    { label: 'Registered name', done: !!form.legal_name?.trim() },
    { label: 'TIN', done: !!form.tin?.trim() },
    { label: 'Address', done: !!form.address?.trim() },
    { label: 'Phone', done: !!form.phone?.trim() },
    { label: 'Email', done: !!form.email?.trim() },
  ];
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / items.length) * 100);
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 64 64" className="size-16 shrink-0 -rotate-90" aria-hidden>
          <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-slate-100" />
          <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} className={cx('transition-all duration-500', pct === 100 ? 'stroke-emerald-500' : 'stroke-sun-400')} />
        </svg>
        <div>
          <p className="font-display text-2xl font-bold text-slate-900">{pct}%</p>
          <p className="text-xs text-slate-500">{pct === 100 ? 'Profile complete' : `${items.length - done} detail${items.length - done === 1 ? '' : 's'} missing`}</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-2.5 text-sm">
            <span className={cx('grid size-5 shrink-0 place-items-center rounded-full', i.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-300')}>{i.done ? <Check className="size-3" /> : <Circle className="size-2 fill-current" />}</span>
            <span className={i.done ? 'text-slate-700' : 'text-slate-400'}>{i.label}</span>
          </li>
        ))}
      </ul>
    </section>
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
  const [pin, setPin] = useState<LatLng | null>(null);
  useEffect(() => {
    const b = editing && editing !== 'new' ? editing : null;
    setForm({ code: b?.code ?? '', name: b?.name ?? '', address: b?.address ?? '', phone: b?.phone ?? '', is_active: b?.is_active ?? true });
    setPin(toLatLng(b?.latitude, b?.longitude));
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
                  <p className={cx('flex items-center gap-2 text-xs', b.latitude != null ? 'text-emerald-700' : 'text-amber-700')}><MapPin className="size-3.5 shrink-0" />{b.latitude != null ? 'On the delivery map' : 'Not on the map yet'}</p>
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
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={!form.name.trim() || (isNew && !form.code.trim())} loading={save.isPending} onClick={() => save.mutate(isNew ? { code: form.code, name: form.name, address: form.address || null, phone: form.phone || null, latitude: pin?.lat ?? null, longitude: pin?.lng ?? null } : { name: form.name, address: form.address || null, phone: form.phone || null, is_active: form.is_active, latitude: pin?.lat ?? null, longitude: pin?.lng ?? null })}>{isNew ? 'Add branch' : 'Save changes'}</Button></>}>
        <div className="space-y-5">
          {save.error instanceof ApiError && Object.keys(save.error.errors).length === 0 && <ErrorBanner error={save.error} />}
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            {isNew && <Field label="Code" error={err('code')} hint="e.g. MKT">{(id) => <Input id={id} className="font-mono uppercase" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} />}</Field>}
            <Field label="Name" error={err('name')} className={isNew ? undefined : 'sm:col-span-2'}>{(id) => <Input id={id} placeholder="e.g. Makati Branch" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />}</Field>
          </div>
          <Field label="Address">{(id) => <Input id={id} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />}</Field>
          <div>
            <p className="text-sm font-medium text-slate-700">Location on the map</p>
            <p className="mb-2 text-xs text-slate-500">Used for delivery maps: customers and riders see the store here. Drag the map so the pin sits on the store entrance.</p>
            {editing !== null && <LocationPicker key={isNew ? 'new' : (editing as Branch).id} value={pin} onChange={setPin} start={isNew ? null : toLatLng((editing as Branch).latitude, (editing as Branch).longitude)} height={220} />}
            {pin && <p className="mt-1.5 flex items-center justify-between text-xs text-slate-500"><span>{pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}</span><button type="button" onClick={() => setPin(null)} className="font-semibold text-red-600 hover:underline">Clear location</button></p>}
          </div>
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
