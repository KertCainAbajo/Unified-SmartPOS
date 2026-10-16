import { Banknote, Check, CheckCircle2, Clock, CreditCard, ExternalLink, Landmark, MoreHorizontal, RotateCcw, ShieldAlert, Smartphone, X, XCircle, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { BranchTag, ScopeChip } from '../../components/BranchSwitcher';
import { Badge, Button, EmptyState, ErrorBanner, Field, LoadingRows, Modal, PageHeader, Pagination, Segmented, StatCard, Textarea, cx } from '../../components/ui';
import { formatDateTime, formatMoney, titleCase } from '../../lib/format';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Paginated, Refund } from '../../lib/types';
import { useAuth } from '../../auth/AuthProvider';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

const METHOD: Record<string, LucideIcon> = { cash: Banknote, card: CreditCard, gcash: Smartphone, maya: Smartphone, bank_transfer: Landmark, other: MoreHorizontal };
const TILE: Record<Refund['status'], string> = {
  pending_approval: 'bg-amber-50 text-amber-600 ring-amber-100',
  completed: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  rejected: 'bg-rose-50 text-rose-500 ring-rose-100',
};
const QUICK_REASONS = ['Receipt does not match the items', 'Outside the return period', 'Item was used or damaged by customer', 'Needs the original receipt'];
const totalOf = (p?: { meta?: { total: number }; total?: number }) => (p ? p.meta?.total ?? p.total ?? 0 : null);

function useStatusCount(status: string, branchId: number | undefined) {
  return useTenantQuery<Paginated<Refund>>('/refunds', { status, branch_id: branchId, per_page: 1 });
}

export function RefundsPage() {
  const { can, tenantId, viewAll, scopeBranchId } = useTenant();
  const { user } = useAuth();
  const approver = can('refunds.approve');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(approver ? 'pending_approval' : '');
  const [rejecting, setRejecting] = useState<Refund | null>(null);
  const [reason, setReason] = useState('');
  const list = useTenantQuery<Paginated<Refund>>('/refunds', { page, status, branch_id: scopeBranchId });
  const pending = useStatusCount('pending_approval', scopeBranchId);
  const completed = useStatusCount('completed', scopeBranchId);
  const rejected = useStatusCount('rejected', scopeBranchId);
  const approve = useTenantMutation<number>('POST', (id) => `/refunds/${id}/approve`, { success: 'Refund approved and completed.' });
  const reject = useTenantMutation<{ id: number; reason: string }>('POST', (b) => `/refunds/${b.id}/reject`, {
    success: 'Refund rejected.',
    onSuccess: () => { setRejecting(null); setReason(''); },
    toastErrors: false,
  });

  if (!can('refunds.create') && !approver) return <NoAccess what="refunds" />;
  const rows = list.data?.data ?? [];
  const pageValue = rows.reduce((s, r) => s + Number(r.total), 0);
  const pendingCount = totalOf(pending.data);

  return (
    <>
      <PageHeader
        eyebrow="Selling"
        title="Refunds"
        description={approver ? 'Review returns that exceed the approval threshold and keep an eye on money going back to customers.' : 'Refunds you requested and where they stand.'}
        actions={<ScopeChip />}
      />

      <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard tone={pendingCount ? 'warn' : 'default'} icon={Clock} label="Awaiting approval" value={pendingCount} hint={pendingCount ? 'Customers are waiting' : 'Nothing to review'} />
        <StatCard tone="brand" icon={CheckCircle2} label="Completed" value={totalOf(completed.data)} hint="Money returned" />
        <StatCard tone="rose" icon={XCircle} label="Rejected" value={totalOf(rejected.data)} hint="Declined requests" />
        <StatCard tone="featured" icon={RotateCcw} label="Listed value" value={list.data ? formatMoney(pageValue.toFixed(2)) : null} hint={`${rows.length} refunds shown`} />
      </section>

      {approver && pendingCount ? (
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-amber-50 to-cream/60 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200/70">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><ShieldAlert className="size-5" /></span>
          <span className="flex-1"><strong>{pendingCount}</strong> {pendingCount === 1 ? 'refund needs' : 'refunds need'} your approval. You cannot approve a refund you requested yourself.</span>
          {status !== 'pending_approval' && <Button size="sm" variant="secondary" onClick={() => { setStatus('pending_approval'); setPage(1); }}>Review</Button>}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <Segmented label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }}
            options={[
              { value: 'pending_approval', label: <>Pending{pendingCount ? <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">{pendingCount}</span> : null}</> },
              { value: 'completed', label: 'Completed' },
              { value: 'rejected', label: 'Rejected' },
              { value: '', label: 'All' },
            ]} />
        </div>

        {list.error ? <ErrorBanner error={list.error} className="m-4" /> : list.isPending ? <LoadingRows label="Loading refunds" /> : rows.length === 0 ? (
          <EmptyState icon={RotateCcw} title={status === 'pending_approval' ? 'All caught up' : 'No refunds here'}
            description={status === 'pending_approval' ? 'No refunds are waiting for approval.' : 'Refunds are started from a sale’s receipt page.'} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const Icon = METHOD[r.refund_method] ?? MoreHorizontal;
              const mine = r.requested_by === user?.id;
              return (
                <li key={r.id} className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-brand-50/30 lg:flex-row lg:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl ring-1', TILE[r.status])}><RotateCcw className="size-5" /></span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium text-slate-900">{r.reference}</span>
                        <Badge status={r.status} />
                        {viewAll && <BranchTag id={r.branch_id} />}
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-600">“{r.reason}”</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                        <span>{formatDateTime(r.created_at)}</span>
                        <span className="inline-flex items-center gap-1"><Icon className="size-3.5" />{titleCase(r.refund_method)}</span>
                        <span>{r.items?.length ?? 0} {r.items?.length === 1 ? 'item' : 'items'}</span>
                        <Link className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline" to={`/t/${tenantId}/sales/${r.sale_id}`}>View sale <ExternalLink className="size-3" /></Link>
                      </p>
                      {r.status === 'rejected' && r.rejection_reason && <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">Rejected: {r.rejection_reason}</p>}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 lg:justify-end">
                    <span className="text-right">
                      <span className="block font-display text-lg font-bold tabular-nums text-rose-600">−{formatMoney(r.total)}</span>
                      <span className="block text-[11px] text-slate-400">incl. {formatMoney(r.vat_amount)} VAT</span>
                    </span>
                    {r.status === 'pending_approval' && approver && (
                      mine ? (
                        <span className="max-w-32 rounded-lg bg-slate-50 px-2.5 py-1.5 text-center text-[11px] text-slate-500 ring-1 ring-slate-200">Needs another approver</span>
                      ) : (
                        <span className="flex gap-2">
                          <Button size="sm" variant="secondary" icon={<X className="size-4" />} onClick={() => setRejecting(r)}>Reject</Button>
                          <Button size="sm" icon={<Check className="size-4" />} loading={approve.isPending && approve.variables === r.id} onClick={() => approve.mutate(r.id)}>Approve</Button>
                        </span>
                      )
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination page={page} data={list.data} onPage={setPage} />
      </section>

      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject refund"
        icon={XCircle}
        description={rejecting ? <><span className="font-mono">{rejecting.reference}</span> · −{formatMoney(rejecting.total)}</> : undefined}
        footer={<><Button variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button><Button variant="danger" disabled={!reason.trim()} loading={reject.isPending} onClick={() => rejecting && reject.mutate({ id: rejecting.id, reason })}>Reject refund</Button></>}
      >
        <div className="space-y-4">
          <ErrorBanner error={reject.error} />
          {rejecting && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600 ring-1 ring-slate-100">Customer’s reason: “{rejecting.reason}”</p>}
          <div className="flex flex-wrap gap-2">
            {QUICK_REASONS.map((q) => (
              <button key={q} type="button" onClick={() => setReason(q)} className={cx('rounded-full px-3 py-1 text-xs font-medium ring-1 transition', reason === q ? 'bg-brand-50 text-brand-800 ring-brand-300' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>{q}</button>
            ))}
          </div>
          <Field label="Reason shown to the requester">{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
        </div>
      </Modal>
    </>
  );
}
