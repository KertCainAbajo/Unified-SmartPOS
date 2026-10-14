import { ShoppingCart } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, Button, Card, DataTable, PageHeader, StatCard } from '../components/ui';
import { firstOfMonthManila, formatDateTime, formatMoney, formatQty, titleCase, todayManila } from '../lib/format';
import { useTenantQuery } from '../lib/hooks';
import type { Paginated, ReportResponse, Sale } from '../lib/types';
import { useTenant } from '../tenant/TenantProvider';

interface SummaryRow {
  period: string;
  transactions: number;
  net_sales: string;
  refunds: string;
  net_after_refunds: string;
}

export function DashboardPage() {
  const { can, branch, tenant, tenantId } = useTenant();
  const today = todayManila();
  const scope = { branch_id: branch?.id };
  const canReports = can('reports.view');

  const todaySummary = useTenantQuery<ReportResponse<SummaryRow[]>>('/reports/sales-summary', { ...scope, date_from: today, date_to: today }, { enabled: canReports });
  const monthSummary = useTenantQuery<ReportResponse<SummaryRow[]>>('/reports/sales-summary', { ...scope, date_from: firstOfMonthManila(), date_to: today, group_by: 'month' }, { enabled: canReports });
  const methods = useTenantQuery<ReportResponse<{ method: string; payments: number; net: string }[]>>('/reports/sales-by-payment-method', { ...scope, date_from: today, date_to: today }, { enabled: canReports });
  const best = useTenantQuery<ReportResponse<{ product_id: number; name: string; net_quantity: string; revenue: string }[]>>('/reports/best-sellers', { ...scope, date_from: firstOfMonthManila(), date_to: today, limit: 5 }, { enabled: canReports });
  const lowStock = useTenantQuery<Paginated<{ product_id: number; name: string; sku: string; quantity: string; reorder_level: string; unit: string }>>('/inventory/low-stock', { ...scope, per_page: 6 }, { enabled: can('inventory.view') });
  const recent = useTenantQuery<Paginated<Sale>>('/sales', { ...scope, per_page: 6 }, { enabled: can('sales.view') || can('sales.view_all') });

  const t = todaySummary.data?.data[0];
  const m = monthSummary.data?.data[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello — ${tenant.name}`}
        description={`${branch?.name ?? 'All branches'} · ${today}`}
        actions={
          can('sales.create') && (
            <Link to={`/t/${tenantId}/pos`}>
              <Button icon={<ShoppingCart className="size-4" />}>Open POS</Button>
            </Link>
          )
        }
      />

      {canReports && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Today's net sales" value={formatMoney(t?.net_after_refunds ?? '0.00')} hint={`${t?.transactions ?? 0} transactions`} />
          <StatCard label="Today's refunds" value={formatMoney(t?.refunds ?? '0.00')} />
          <StatCard label="Month to date" value={formatMoney(m?.net_after_refunds ?? '0.00')} hint={`${m?.transactions ?? 0} transactions`} />
          <StatCard label="Low-stock items" value={lowStock.data?.total ?? '—'} tone={(lowStock.data?.total ?? 0) > 0 ? 'warn' : 'default'} hint="At or below reorder level" />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {canReports && (
          <Card title="Today by payment method" padded={false}>
            <DataTable
              rows={methods.data?.data}
              loading={methods.isPending}
              error={methods.error}
              rowKey={(r) => r.method}
              empty="No payments yet today."
              columns={[
                { header: 'Method', cell: (r) => titleCase(r.method) },
                { header: 'Payments', cell: (r) => r.payments, align: 'right' },
                { header: 'Net', cell: (r) => formatMoney(r.net), align: 'right' },
              ]}
            />
          </Card>
        )}

        {canReports && (
          <Card title="Best sellers this month" padded={false}>
            <DataTable
              rows={best.data?.data}
              loading={best.isPending}
              error={best.error}
              rowKey={(r) => r.product_id}
              empty="No sales this month."
              columns={[
                { header: 'Product', cell: (r) => r.name },
                { header: 'Qty', cell: (r) => formatQty(r.net_quantity), align: 'right' },
                { header: 'Revenue', cell: (r) => formatMoney(r.revenue), align: 'right' },
              ]}
            />
          </Card>
        )}

        {can('inventory.view') && (
          <Card title="Low stock" padded={false} actions={<Link className="text-xs font-medium text-teal-700 hover:underline" to={`/t/${tenantId}/inventory`}>View inventory</Link>}>
            <DataTable
              rows={lowStock.data?.data}
              loading={lowStock.isPending}
              error={lowStock.error}
              rowKey={(r) => r.product_id}
              empty="Everything is above its reorder level."
              columns={[
                { header: 'Product', cell: (r) => r.name },
                { header: 'On hand', cell: (r) => `${formatQty(r.quantity)} ${r.unit}`, align: 'right' },
                { header: 'Reorder at', cell: (r) => formatQty(r.reorder_level), align: 'right' },
              ]}
            />
          </Card>
        )}

        {(can('sales.view') || can('sales.view_all')) && (
          <Card title={can('sales.view_all') ? 'Recent sales' : 'My recent sales'} padded={false} actions={<Link className="text-xs font-medium text-teal-700 hover:underline" to={`/t/${tenantId}/sales`}>All sales</Link>}>
            <DataTable
              rows={recent.data?.data}
              loading={recent.isPending}
              error={recent.error}
              rowKey={(r) => r.id}
              empty="No sales yet."
              columns={[
                { header: 'Receipt', cell: (r) => <Link className="font-medium text-teal-700 hover:underline" to={`/t/${tenantId}/sales/${r.id}`}>{r.receipt_number}</Link> },
                { header: 'Time', cell: (r) => formatDateTime(r.sold_at) },
                { header: 'Status', cell: (r) => <Badge status={r.payment_status} /> },
                { header: 'Total', cell: (r) => formatMoney(r.total), align: 'right' },
              ]}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
