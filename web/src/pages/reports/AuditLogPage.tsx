import {
  ArrowRight,
  Bike,
  Boxes,
  CalendarDays,
  Clock,
  ClipboardList,
  Globe,
  KeyRound,
  Package,
  Receipt,
  RotateCcw,
  Settings,
  ShieldCheck,
  Store,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { BranchTag, ScopeChip } from '../../components/BranchSwitcher';
import { Avatar, DateRange, EmptyState, ErrorBanner, LoadingRows, Modal, PageHeader, Pagination, SearchField, Segmented, cx } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { actionTitle, fieldLabel, formatValue, recordTitle, splitChanges } from './auditText';
import { useDebounced, useTenantQuery } from '../../lib/hooks';
import type { AuditLogEntry, Paginated } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

/** Colour + icon per action domain (the part before the first dot). */
const DOMAIN: Record<string, { icon: LucideIcon; tone: string }> = {
  sale: { icon: Receipt, tone: 'bg-brand-50 text-brand-700 ring-brand-200' },
  refund: { icon: RotateCcw, tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
  product: { icon: Package, tone: 'bg-sky-50 text-sky-700 ring-sky-200' },
  category: { icon: Package, tone: 'bg-sky-50 text-sky-700 ring-sky-200' },
  inventory: { icon: Boxes, tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  stock_transfer: { icon: Boxes, tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  stock_count: { icon: Boxes, tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  goods_receipt: { icon: Truck, tone: 'bg-violet-50 text-violet-700 ring-violet-200' },
  branch: { icon: Settings, tone: 'bg-slate-100 text-slate-700 ring-slate-300' },
  register: { icon: Settings, tone: 'bg-slate-100 text-slate-700 ring-slate-300' },
  customer: { icon: Users, tone: 'bg-teal-50 text-teal-700 ring-teal-200' },
  purchase_order: { icon: Truck, tone: 'bg-violet-50 text-violet-700 ring-violet-200' },
  expense: { icon: Wallet, tone: 'bg-teal-50 text-teal-700 ring-teal-200' },
  staff: { icon: Users, tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  auth: { icon: KeyRound, tone: 'bg-slate-100 text-slate-700 ring-slate-300' },
  tenant: { icon: Settings, tone: 'bg-slate-100 text-slate-700 ring-slate-300' },
  online_order: { icon: Bike, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rider: { icon: Bike, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  shift: { icon: Clock, tone: 'bg-brand-50 text-brand-700 ring-brand-200' },
  user: { icon: KeyRound, tone: 'bg-slate-100 text-slate-700 ring-slate-300' },
  role: { icon: Users, tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  supplier: { icon: Truck, tone: 'bg-violet-50 text-violet-700 ring-violet-200' },
};
const domainOf = (action: string) => DOMAIN[action.split('.')[0]] ?? { icon: ShieldCheck, tone: 'bg-slate-100 text-slate-700 ring-slate-300' };

const FILTERS = [
  { value: '', label: 'Everything' },
  { value: 'sale', label: 'Sales' },
  { value: 'refund', label: 'Refunds' },
  { value: 'product', label: 'Products' },
  { value: 'inventory', label: 'Stock' },
  { value: 'purchase_order', label: 'Purchasing' },
  { value: 'staff', label: 'Staff' },
];

const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA');
const dayLabel = (iso: string) => {
  const key = dayKey(iso);
  const today = new Date().toLocaleDateString('en-CA');
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });

export function AuditLogPage() {
  const { can, viewAll, scopeBranchId } = useTenant();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [domain, setDomain] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  const a = useDebounced(action.trim());
  const filter = a ? (a.includes('*') || a.includes('.') ? a : `${a}.*`) : domain ? `${domain}.*` : undefined;
  const list = useTenantQuery<Paginated<AuditLogEntry>>('/audit-logs', { action: filter, branch_id: scopeBranchId, date_from: range.from || undefined, date_to: range.to || undefined, page });

  if (!can('audit_logs.view')) return <NoAccess what="the audit log" />;
  const rows = list.data?.data ?? [];
  const days = rows.reduce<{ key: string; label: string; items: AuditLogEntry[] }[]>((acc, r) => {
    const key = dayKey(r.created_at);
    const last = acc[acc.length - 1];
    if (last?.key === key) last.items.push(r);
    else acc.push({ key, label: dayLabel(r.created_at), items: [r] });
    return acc;
  }, []);
  const filtered = !!a || !!domain || !!range.from || !!range.to;

  return (
    <>
      <PageHeader
        eyebrow="Business"
        title="Audit log"
        description="Every sensitive action: who did it, when, and what changed. Entries are permanent and cannot be edited."
        actions={<ScopeChip />}
      />

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
        <div className="space-y-3 border-b border-slate-100 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <SearchField className="lg:w-80" value={action} onChange={(v) => { setAction(v); setPage(1); }} placeholder="Action, e.g. refund.* or product.price_changed" />
            <DateRange from={range.from} to={range.to} onChange={(r) => { setRange(r); setPage(1); }} />
            {filtered && <button type="button" onClick={() => { setAction(''); setDomain(''); setRange({ from: '', to: '' }); setPage(1); }} className="text-xs font-semibold text-slate-500 hover:text-slate-800 hover:underline lg:ml-auto">Clear filters</button>}
          </div>
          <Segmented label="Area" value={domain} onChange={(v) => { setDomain(v); setAction(''); setPage(1); }} options={FILTERS} />
        </div>

        {list.error ? <ErrorBanner error={list.error} className="m-4" /> : list.isPending ? <LoadingRows label="Loading audit log" /> : rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title={filtered ? 'No entries match' : 'No activity yet'} description={filtered ? 'Try a wider date range or another action.' : 'Sensitive actions like voids, refunds and price changes are recorded here.'} />
        ) : (
          <div className="divide-y divide-slate-100">
            {days.map((day) => (
              <section key={day.key}>
                <header className="sticky top-0 z-10 flex items-center gap-2.5 bg-gradient-to-r from-brand-50/80 via-slate-50/80 to-white/80 px-5 py-2 backdrop-blur">
                  <span className="grid size-7 place-items-center rounded-lg bg-white text-brand-600 shadow-sm ring-1 ring-slate-900/5"><CalendarDays className="size-3.5" /></span>
                  <span className="text-[13px] font-semibold text-slate-800">{day.label}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">{day.items.length}</span>
                </header>
                <ol className="relative px-5 py-2">
                  <span aria-hidden className="absolute bottom-4 left-[2.45rem] top-4 w-px bg-slate-200" />
                  {day.items.map((r) => {
                    const dm = domainOf(r.action);
                    const changed = r.new_values ? Object.keys(r.new_values).length : 0;
                    return (
                      <li key={r.id}>
                        <button type="button" onClick={() => setSelected(r)} className="group relative flex w-full items-start gap-4 rounded-xl px-2 py-2.5 text-left transition hover:bg-brand-50/40 focus-visible:bg-brand-50/60 focus-visible:outline-none">
                          <span className={cx('relative z-[1] grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-white', dm.tone.split(' ').slice(0, 2).join(' '))}><dm.icon className="size-4" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900" title={r.action}>{actionTitle(r.action)}</span>
                              {r.auditable_type && <span className={cx('rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', dm.tone)}>{recordTitle(r)}</span>}
                              {viewAll && (r.branch_id === null ? <span className="text-[11px] text-slate-400">Business-wide</span> : <BranchTag id={r.branch_id} />)}
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                              <span className="inline-flex items-center gap-1.5">{r.user ? <Avatar name={r.user.name} size="sm" /> : <ShieldCheck className="size-4 text-slate-400" />}<span className="font-medium text-slate-700">{r.user?.name ?? 'System'}</span></span>
                              {changed > 0 && <span>{changed} {changed === 1 ? 'detail' : 'details'}</span>}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-slate-400">{timeOf(r.created_at)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
        <Pagination page={page} data={list.data} onPage={setPage} />
      </section>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? actionTitle(selected.action) : ''} icon={selected ? domainOf(selected.action).icon : undefined} size="lg"
        description={selected ? <>{formatDateTime(selected.created_at)} · by {selected.user?.name ?? 'the system'}</> : undefined}>
        {selected && <AuditDetail entry={selected} />}
      </Modal>
    </>
  );
}

function AuditDetail({ entry }: { entry: AuditLogEntry }) {
  const { branchName } = useTenant();
  const { changes, facts, before, after } = splitChanges(entry);
  const value = (k: string, v: unknown) => formatValue(k, v, (id) => branchName(id), entry.people);
  const metadata = Object.entries(entry.metadata ?? {}).filter(([k, v]) => v !== null && v !== '' && !(k in after) && !(k in before));
  const record = recordTitle(entry);
  const title = actionTitle(entry.action);

  return (
    <div className="space-y-5 text-sm">
      {/* Plain summary: who did what, to which record, where and when. */}
      <div className="flex items-start gap-3 rounded-2xl bg-gradient-to-br from-brand-50 to-white p-4 ring-1 ring-brand-100">
        {entry.user ? <Avatar name={entry.user.name} /> : <span className="grid size-9 place-items-center rounded-full bg-slate-100 text-slate-500"><ShieldCheck className="size-4" /></span>}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] text-slate-800"><strong className="text-slate-900">{entry.user?.name ?? 'The system'}</strong> {title.charAt(0).toLowerCase() + title.slice(1)}.</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {record && <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 font-medium text-slate-700 ring-1 ring-slate-200"><ClipboardList className="size-3.5 text-brand-600" />{record}</span>}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 font-medium text-slate-700 ring-1 ring-slate-200"><Store className="size-3.5 text-brand-600" />{entry.branch_id === null ? 'Whole business' : branchName(entry.branch_id)}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 font-medium text-slate-700 ring-1 ring-slate-200"><Clock className="size-3.5 text-brand-600" />{formatDateTime(entry.created_at)}</span>
          </div>
        </div>
      </div>

      {changes.length > 0 && (
        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700">What changed</p>
          <ul className="space-y-2">
            {changes.map((k) => (
              <li key={k} className="rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
                <p className="text-xs font-semibold text-slate-500">{fieldLabel(k)}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-rose-50 px-2 py-0.5 text-rose-700 line-through decoration-rose-300">{value(k, before[k])}</span>
                  <ArrowRight className="size-3.5 text-slate-400" />
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">{value(k, after[k])}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(facts.length > 0 || metadata.length > 0) && (
        <section>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700">{changes.length > 0 ? 'Other details' : 'Details'}</p>
          <dl className="grid gap-2 sm:grid-cols-2">
            {facts.map((k) => (
              <div key={k} className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
                <dt className="text-xs text-slate-500">{fieldLabel(k)}</dt>
                <dd className="mt-0.5 break-words font-semibold text-slate-900">{value(k, after[k])}</dd>
              </div>
            ))}
            {metadata.map(([k, v]) => (
              <div key={k} className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
                <dt className="text-xs text-slate-500">{fieldLabel(k)}</dt>
                <dd className="mt-0.5 break-words font-semibold text-slate-900">{value(k, v)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {changes.length === 0 && facts.length === 0 && metadata.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-3 text-center text-slate-500">Nothing else was recorded for this action.</p>}

      <details className="rounded-xl bg-slate-50/60 px-4 py-2.5 text-xs text-slate-500 ring-1 ring-slate-100">
        <summary className="cursor-pointer select-none font-semibold text-slate-600">Technical details</summary>
        <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
          <dt>Action code</dt><dd className="font-mono text-slate-700">{entry.action}</dd>
          {entry.auditable_type && <><dt>Record</dt><dd className="font-mono text-slate-700">{entry.auditable_type.split('\\').pop()} #{entry.auditable_id}</dd></>}
          {entry.ip_address && <><dt>IP address</dt><dd className="inline-flex items-center gap-1 font-mono text-slate-700"><Globe className="size-3" />{entry.ip_address}</dd></>}
          <dt>Entry no.</dt><dd className="font-mono text-slate-700">{entry.id}</dd>
        </dl>
      </details>
    </div>
  );
}
