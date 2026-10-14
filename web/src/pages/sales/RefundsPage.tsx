import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Card, DataTable, ErrorBanner, Field, Input, Modal, PageHeader, Pagination, Select } from '../../components/ui';
import { formatDateTime, formatMoney, titleCase } from '../../lib/format';
import { useTenantMutation, useTenantQuery } from '../../lib/hooks';
import type { Paginated, Refund } from '../../lib/types';
import { useAuth } from '../../auth/AuthProvider';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

export function RefundsPage() {
  const { can, tenantId } = useTenant();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(can('refunds.approve') ? 'pending_approval' : '');
  const [rejecting, setRejecting] = useState<Refund | null>(null);
  const [reason, setReason] = useState('');
  const list = useTenantQuery<Paginated<Refund>>('/refunds', { page, status });
  const approve = useTenantMutation<number>('POST', (id) => `/refunds/${id}/approve`, { success: 'Refund approved and completed.' });
  const reject = useTenantMutation<{ id: number; reason: string }>('POST', (b) => `/refunds/${b.id}/reject`, {
    success: 'Refund rejected.',
    onSuccess: () => { setRejecting(null); setReason(''); },
    toastErrors: false,
  });

  if (!can('refunds.create') && !can('refunds.approve')) return <NoAccess what="refunds" />;

  return (
    <>
      <PageHeader
        title="Refunds"
        description={can('refunds.approve') ? 'Approve or reject refunds that exceed the approval threshold.' : 'Refunds you requested.'}
        actions={
          <Select className="w-48" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="">All refunds</option>
            <option value="pending_approval">Pending approval</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
          </Select>
        }
      />
      <Card padded={false}>
        <DataTable
          rows={list.data?.data}
          loading={list.isPending}
          error={list.error}
          rowKey={(r) => r.id}
          empty={status === 'pending_approval' ? 'No refunds waiting for approval.' : 'No refunds.'}
          columns={[
            { header: 'Reference', cell: (r) => <span className="font-medium text-slate-900">{r.reference}</span> },
            { header: 'Sale', cell: (r) => <Link className="text-teal-700 hover:underline" to={`/t/${tenantId}/sales/${r.sale_id}`}>View sale</Link> },
            { header: 'Requested', cell: (r) => formatDateTime(r.created_at) },
            { header: 'Reason', cell: (r) => r.reason },
            { header: 'Method', cell: (r) => titleCase(r.refund_method) },
            { header: 'Status', cell: (r) => <Badge status={r.status} /> },
            { header: 'Total', cell: (r) => formatMoney(r.total), align: 'right' },
            {
              header: '',
              cell: (r) =>
                r.status === 'pending_approval' && can('refunds.approve') ? (
                  r.requested_by === user?.id ? (
                    <span className="text-xs text-slate-400">Needs another approver</span>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" loading={approve.isPending && approve.variables === r.id} onClick={() => approve.mutate(r.id)}>Approve</Button>
                      <Button size="sm" variant="secondary" onClick={() => setRejecting(r)}>Reject</Button>
                    </div>
                  )
                ) : null,
            },
          ]}
        />
        <Pagination page={page} data={list.data} onPage={setPage} />
      </Card>

      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={`Reject ${rejecting?.reference ?? ''}`}
        footer={<><Button variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button><Button variant="danger" disabled={!reason.trim()} loading={reject.isPending} onClick={() => rejecting && reject.mutate({ id: rejecting.id, reason })}>Reject refund</Button></>}
      >
        <ErrorBanner error={reject.error} className="mb-3" />
        <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
      </Modal>
    </>
  );
}
