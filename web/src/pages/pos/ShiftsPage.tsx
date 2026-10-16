import { useState } from 'react';
import { BranchTag } from '../../components/BranchSwitcher';
import { Badge, Button, Card, DataTable, Modal, PageHeader, Pagination, Select, Spinner } from '../../components/ui';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useTenantQuery } from '../../lib/hooks';
import type { Paginated, RegisterSession } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';
import { CloseShiftModal, ShiftSummaryView } from './ShiftDialogs';

export function ShiftsPage() {
  const { can, viewAll, scopeBranchId } = useTenant();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [closing, setClosing] = useState<RegisterSession | null>(null);
  const list = useTenantQuery<Paginated<RegisterSession>>('/register-sessions', { page, status, branch_id: scopeBranchId });
  const detail = useTenantQuery<{ data: RegisterSession }>(`/register-sessions/${selected}`, undefined, { enabled: selected !== null });

  if (!can('shifts.operate') && !can('shifts.view_all')) return <NoAccess what="shifts" />;

  return (
    <>
      <PageHeader
        title="Shifts"
        description={can('shifts.view_all') ? 'Cashier shifts in your branches.' : 'Your cashier shifts.'}
        actions={
          <Select className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="">All shifts</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </Select>
        }
      />
      <Card padded={false}>
        <DataTable
          rows={list.data?.data}
          loading={list.isPending}
          error={list.error}
          rowKey={(r) => r.id}
          onRowClick={(r) => setSelected(r.id)}
          empty="No shifts yet."
          columns={[
            { header: 'Shift', cell: (r) => `#${r.id}` },
            ...(viewAll ? [{ header: 'Branch', cell: (r: RegisterSession) => <BranchTag id={r.branch_id} /> }] : []),
            { header: 'Register', cell: (r) => `#${r.register_id}` },
            { header: 'Opened', cell: (r) => formatDateTime(r.opened_at) },
            { header: 'Closed', cell: (r) => formatDateTime(r.closed_at) },
            { header: 'Status', cell: (r) => <Badge status={r.status} /> },
            { header: 'Cash sales', cell: (r) => formatMoney(r.cash_sales), align: 'right' },
            { header: 'Difference', cell: (r) => (r.cash_difference === null ? '—' : formatMoney(r.cash_difference)), align: 'right' },
          ]}
        />
        <Pagination page={page} data={list.data} onPage={setPage} />
      </Card>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={`Shift #${selected}`}
        footer={
          detail.data?.data.status === 'open' ? (
            <Button variant="danger" onClick={() => { setClosing(detail.data!.data); setSelected(null); }}>
              Close this shift
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
          )
        }
      >
        {detail.isPending || !detail.data?.data.summary ? <Spinner /> : <div className="print-area"><ShiftSummaryView summary={detail.data.data.summary} /></div>}
      </Modal>

      {closing && <CloseShiftModal session={closing} open onClose={() => setClosing(null)} />}
    </>
  );
}
