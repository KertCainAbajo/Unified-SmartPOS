import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Card, DataTable, Input, PageHeader, Pagination, Select } from '../../components/ui';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useDebounced, useTenantQuery } from '../../lib/hooks';
import type { Paginated, Sale } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

export function SalesPage() {
  const { can, tenantId, branches, branch } = useTenant();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ date_from: '', date_to: '', status: '', branch_id: String(branch?.id ?? ''), receipt_number: '' });
  const receipt = useDebounced(filters.receipt_number.trim());
  const list = useTenantQuery<Paginated<Sale>>('/sales', { ...filters, receipt_number: receipt || undefined, page });

  if (!can('sales.view') && !can('sales.view_all')) return <NoAccess what="sales" />;
  const set = (key: keyof typeof filters) => (value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  return (
    <>
      <PageHeader title="Sales" description={can('sales.view_all') ? 'All sales in your authorized branches.' : 'Sales you processed.'} />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Input placeholder="Receipt # (exact)" value={filters.receipt_number} onChange={(e) => set('receipt_number')(e.target.value)} aria-label="Receipt number" />
          <Input type="date" value={filters.date_from} onChange={(e) => set('date_from')(e.target.value)} aria-label="From date" />
          <Input type="date" value={filters.date_to} onChange={(e) => set('date_to')(e.target.value)} aria-label="To date" />
          <Select value={filters.status} onChange={(e) => set('status')(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="completed">Completed</option>
            <option value="voided">Voided</option>
          </Select>
          <Select value={filters.branch_id} onChange={(e) => set('branch_id')(e.target.value)} aria-label="Branch">
            <option value="">All my branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          rows={list.data?.data}
          loading={list.isPending}
          error={list.error}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/t/${tenantId}/sales/${r.id}`)}
          empty="No sales match these filters."
          columns={[
            { header: 'Receipt', cell: (r) => <span className="font-medium text-slate-900">{r.receipt_number}</span> },
            { header: 'Date', cell: (r) => formatDateTime(r.sold_at) },
            { header: 'Cashier', cell: (r) => r.cashier?.name ?? '—' },
            { header: 'Discount', cell: (r) => (r.discount.type === 'none' ? '' : <Badge>{r.discount.type === 'pwd' ? 'PWD' : 'Senior'}</Badge>) },
            { header: 'Status', cell: (r) => <Badge status={r.status === 'voided' ? 'voided' : r.payment_status} /> },
            { header: 'Total', cell: (r) => formatMoney(r.total), align: 'right' },
          ]}
        />
        <Pagination page={page} data={list.data} onPage={setPage} />
      </Card>
    </>
  );
}
