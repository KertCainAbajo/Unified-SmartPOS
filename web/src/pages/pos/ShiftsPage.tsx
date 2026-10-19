import { Banknote, CheckCircle2, Clock, Monitor, Printer, Scale, TimerReset, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { BranchTag, ScopeChip } from '../../components/BranchSwitcher';
import { Badge, Button, EmptyState, ErrorBanner, LoadingRows, Modal, PageHeader, Pagination, Segmented, StatCard, cx } from '../../components/ui';
import { formatDateTime, formatMoney } from '../../lib/format';
import { printDocument } from '../../lib/print';
import { useTenantQuery } from '../../lib/hooks';
import type { Paginated, Register, RegisterSession } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';
import { CloseShiftModal, ShiftSummaryView } from './ShiftDialogs';

const duration = (from: string, to: string | null) => {
  const mins = Math.max(0, Math.round(((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
};
const totalOf = (p?: { meta?: { total: number }; total?: number }) => (p ? p.meta?.total ?? p.total ?? 0 : null);

/** Over / short / balanced chip for a closed shift's cash count. */
function Variance({ value }: { value: string | null }) {
  if (value === null) return <span className="text-xs text-slate-300">—</span>;
  const n = Number(value);
  if (n === 0) return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20"><CheckCircle2 className="size-3.5" />Balanced</span>;
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset', n < 0 ? 'bg-rose-50 text-rose-700 ring-rose-600/20' : 'bg-amber-50 text-amber-800 ring-amber-600/20')}>
      <TriangleAlert className="size-3.5" />{n < 0 ? 'Short' : 'Over'} {formatMoney(String(Math.abs(n)))}
    </span>
  );
}

export function ShiftsPage() {
  const { can, viewAll, scopeBranchId } = useTenant();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [closing, setClosing] = useState<RegisterSession | null>(null);
  const list = useTenantQuery<Paginated<RegisterSession>>('/register-sessions', { page, status, branch_id: scopeBranchId });
  const openNow = useTenantQuery<Paginated<RegisterSession>>('/register-sessions', { status: 'open', branch_id: scopeBranchId, per_page: 1 });
  const registers = useTenantQuery<{ data: Register[] }>('/registers', { branch_id: scopeBranchId });
  const detail = useTenantQuery<{ data: RegisterSession }>(`/register-sessions/${selected}`, undefined, { enabled: selected !== null });

  if (!can('shifts.operate') && !can('shifts.view_all')) return <NoAccess what="shifts" />;
  const rows = list.data?.data ?? [];
  const registerName = (id: number) => registers.data?.data.find((r) => r.id === id)?.name ?? `Register #${id}`;
  const closed = rows.filter((r) => r.status === 'closed');
  const cash = rows.reduce((s, r) => s + Number(r.cash_sales), 0);
  const variance = closed.reduce((s, r) => s + Number(r.cash_difference ?? 0), 0);
  const balanced = closed.filter((r) => Number(r.cash_difference ?? 0) === 0).length;
  const d = detail.data?.data;

  return (
    <>
      <PageHeader
        eyebrow="Selling"
        title="Shifts"
        description={can('shifts.view_all') ? 'Cashier shifts in your branches: opening float, cash taken and how the drawer counted at close.' : 'Your cashier shifts and how each drawer counted.'}
        actions={<ScopeChip />}
      />

      <section className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard tone="brand" icon={TimerReset} label="Open now" value={totalOf(openNow.data)} hint="Drawers currently in use" />
        <StatCard tone="featured" icon={Banknote} label="Cash sales" value={list.data ? formatMoney(cash.toFixed(2)) : null} hint={`${rows.length} shifts listed`} />
        <StatCard tone="sky" icon={Scale} label="Balanced closes" value={list.data ? `${balanced}/${closed.length}` : null} hint={closed.length ? `${Math.round((balanced / closed.length) * 100)}% counted exactly` : 'No closed shifts listed'} />
        <StatCard tone={variance < 0 ? 'rose' : variance > 0 ? 'warn' : 'default'} icon={TriangleAlert} label="Net over / short" value={list.data ? `${variance > 0 ? '+' : ''}${formatMoney(variance.toFixed(2))}` : null} hint="Counted minus expected" />
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <Segmented label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: '', label: 'All shifts' }, { value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]} />
        </div>

        {list.error ? <ErrorBanner error={list.error} className="m-4" /> : list.isPending ? <LoadingRows label="Loading shifts" /> : rows.length === 0 ? (
          <EmptyState icon={Clock} title="No shifts yet" description="A shift starts when a cashier opens a register on the Point of Sale." />
        ) : (
          <div className="overflow-x-auto">
            <table className="sp-cards w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-[11px] uppercase tracking-wider text-slate-400">
                  <th scope="col" className="py-3 pl-5 pr-3 text-left font-semibold">Shift</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Timeline</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Float</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Cash sales</th>
                  <th scope="col" className="px-3 py-3 text-left font-semibold">Count</th>
                  <th scope="col" className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const open = r.status === 'open';
                  return (
                    <tr key={r.id} tabIndex={0} onClick={() => setSelected(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(r.id); }}
                      className="group cursor-pointer transition-colors hover:bg-brand-50/40 focus-visible:bg-brand-50/60 focus-visible:outline-none">
                      <td className="py-3 pl-5 pr-3">
                        <span className="flex items-center gap-3">
                          <span className={cx('relative grid size-10 shrink-0 place-items-center rounded-xl ring-1', open ? 'bg-emerald-50 text-emerald-600 ring-emerald-100' : 'bg-slate-50 text-slate-500 ring-slate-200')}>
                            <Monitor className="size-5" />
                            {open && <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full bg-emerald-500 ring-2 ring-white" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block font-medium text-slate-900">{registerName(r.register_id)}</span>
                            <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">Shift #{r.id}{viewAll && <BranchTag id={r.branch_id} />}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="block whitespace-nowrap text-slate-700">{formatDateTime(r.opened_at)}</span>
                        <span className="flex items-center gap-1.5 text-xs text-slate-400">
                          {open ? <Badge status="open">Open · {duration(r.opened_at, null)}</Badge> : <>→ {formatDateTime(r.closed_at)} · {duration(r.opened_at, r.closed_at)}</>}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-500">{formatMoney(r.opening_float)}</td>
                      <td className="px-3 py-3 text-right font-display font-semibold tabular-nums text-slate-900">{formatMoney(r.cash_sales)}</td>
                      <td className="px-3 py-3">{open ? <span className="text-xs text-slate-400">Not counted yet</span> : <Variance value={r.cash_difference} />}</td>
                      <td className="pr-4 text-right text-slate-300 transition group-hover:text-brand-600">›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} data={list.data} onPage={setPage} />
      </section>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={d ? registerName(d.register_id) : `Shift #${selected}`}
        description={d ? <>Shift #{d.id} · opened {formatDateTime(d.opened_at)}{d.closed_at && <> · closed {formatDateTime(d.closed_at)}</>}</> : undefined}
        icon={Clock}
        footer={
          d?.status === 'open' ? (
            <Button variant="danger" onClick={() => { setClosing(d); setSelected(null); }}>Close this shift</Button>
          ) : (
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => printDocument()}>Print summary</Button>
          )
        }
      >
        {detail.isPending || !d?.summary ? <LoadingRows rows={4} /> : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Opening float', value: formatMoney(d.opening_float) },
                { label: 'Expected cash', value: d.expected_cash ? formatMoney(d.expected_cash) : '—' },
                { label: 'Counted', value: d.counted_cash ? formatMoney(d.counted_cash) : '—' },
              ].map((k) => (
                <div key={k.label} className="rounded-xl bg-slate-50 px-2 py-3 ring-1 ring-slate-100">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{k.label}</p>
                  <p className="mt-1 font-display font-semibold tabular-nums text-slate-900">{k.value}</p>
                </div>
              ))}
            </div>
            {d.status === 'closed' && <div className="flex justify-center"><Variance value={d.cash_difference} /></div>}
            <div className="print-area" data-print-width="80mm"><ShiftSummaryView summary={d.summary} /></div>
          </div>
        )}
      </Modal>

      {closing && <CloseShiftModal session={closing} open onClose={() => setClosing(null)} />}
    </>
  );
}
