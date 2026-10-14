import { useState } from 'react';
import { Card, DataTable, ErrorBanner, Input, PageHeader, Select, Spinner, StatCard, Tabs } from '../../components/ui';
import { firstOfMonthManila, formatMoney, formatQty, fromCents, titleCase, toCents, todayManila } from '../../lib/format';
import { useTenantQuery } from '../../lib/hooks';
import type { ReportResponse } from '../../lib/types';
import { useTenant } from '../../tenant/TenantProvider';
import { NoAccess } from '../NotFoundPage';

type Tab = 'sales' | 'breakdown' | 'products' | 'profit';

interface Filters {
  date_from: string;
  date_to: string;
  branch_id: string;
}

export function ReportsPage() {
  const { can, branches } = useTenant();
  const [tab, setTab] = useState<Tab>(can('reports.view') ? 'sales' : 'profit');
  const [filters, setFilters] = useState<Filters>({ date_from: firstOfMonthManila(), date_to: todayManila(), branch_id: '' });

  if (!can('reports.view') && !can('reports.financial')) return <NoAccess what="reports" />;

  const tabs = [
    ...(can('reports.view')
      ? [{ value: 'sales' as Tab, label: 'Sales' }, { value: 'breakdown' as Tab, label: 'By branch / cashier / payment' }, { value: 'products' as Tab, label: 'Products & stock' }]
      : []),
    ...(can('reports.financial') ? [{ value: 'profit' as Tab, label: 'Profit & expenses' }] : []),
  ];

  return (
    <>
      <PageHeader title="Reports" description="All figures are computed by the server for your authorized branches. Voided sales are excluded." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-600">From<Input className="mt-1 w-auto" type="date" value={filters.date_from} onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))} /></label>
        <label className="text-sm text-slate-600">To<Input className="mt-1 w-auto" type="date" value={filters.date_to} onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))} /></label>
        <label className="text-sm text-slate-600">Branch
          <Select className="mt-1 w-auto" value={filters.branch_id} onChange={(e) => setFilters((f) => ({ ...f, branch_id: e.target.value }))}>
            <option value="">All my branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </label>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'sales' && <SalesReport filters={filters} />}
      {tab === 'breakdown' && <BreakdownReport filters={filters} />}
      {tab === 'products' && <ProductsReport filters={filters} />}
      {tab === 'profit' && <ProfitReport filters={filters} />}
    </>
  );
}

function useReport<T>(endpoint: string, filters: Filters, extra: Record<string, string | number> = {}) {
  return useTenantQuery<ReportResponse<T>>(`/reports/${endpoint}`, { ...filters, ...extra });
}

interface SummaryRow { period: string; transactions: number; gross_sales: string; discounts: string; vat_exemptions: string; net_sales: string; vat: string; refunds: string; net_after_refunds: string }

function SalesReport({ filters }: { filters: Filters }) {
  const [groupBy, setGroupBy] = useState<'day' | 'month'>('day');
  const report = useReport<SummaryRow[]>('sales-summary', filters, { group_by: groupBy });
  const discounts = useReport<{ discounts: { discount_type: string; transactions: number; discounts: string; vat_exemptions: string }[]; refunds: { completed_count: number; completed_total: string; pending_count: number; pending_total: string }; voided_sales: number }>('discounts-refunds', filters);
  const rows = report.data?.data ?? [];
  const max = Math.max(1, ...rows.map((r) => Number(r.net_after_refunds)));
  const sum = (key: keyof SummaryRow) => fromCents(rows.reduce((s, r) => s + toCents(String(r[key])), 0));

  return (
    <div className="space-y-6">
      <ErrorBanner error={report.error} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Net sales" value={formatMoney(sum('net_sales'))} hint={`${rows.reduce((s, r) => s + r.transactions, 0)} transactions`} />
        <StatCard label="Refunds" value={formatMoney(sum('refunds'))} hint={discounts.data ? `${discounts.data.data.refunds.pending_count} pending approval` : undefined} />
        <StatCard label="Net after refunds" value={formatMoney(sum('net_after_refunds'))} />
        <StatCard label="VAT collected" value={formatMoney(sum('vat'))} hint={discounts.data ? `${discounts.data.data.voided_sales} voided sales excluded` : undefined} />
      </div>
      <Card title="Sales over time" actions={<Select className="h-8 w-auto" value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'day' | 'month')}><option value="day">Daily</option><option value="month">Monthly</option></Select>}>
        {report.isPending ? <Spinner /> : rows.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No sales in this period.</p> : (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.period} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 tabular-nums text-slate-500">{r.period}</span>
                <div className="h-5 flex-1 rounded bg-slate-100">
                  <div className="h-5 rounded bg-teal-600" style={{ width: `${Math.max(0, (Number(r.net_after_refunds) / max) * 100)}%` }} />
                </div>
                <span className="w-28 shrink-0 text-right tabular-nums">{formatMoney(r.net_after_refunds)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Details" padded={false}>
        <DataTable rows={rows} loading={report.isPending} rowKey={(r) => r.period} empty="No sales in this period." columns={[
          { header: 'Period', cell: (r) => r.period },
          { header: 'Txns', cell: (r) => r.transactions, align: 'right' },
          { header: 'Gross', cell: (r) => formatMoney(r.gross_sales), align: 'right' },
          { header: 'Discounts', cell: (r) => formatMoney(r.discounts), align: 'right' },
          { header: 'SC/PWD VAT', cell: (r) => formatMoney(r.vat_exemptions), align: 'right' },
          { header: 'Net sales', cell: (r) => formatMoney(r.net_sales), align: 'right' },
          { header: 'VAT', cell: (r) => formatMoney(r.vat), align: 'right' },
          { header: 'Refunds', cell: (r) => formatMoney(r.refunds), align: 'right' },
          { header: 'Net after refunds', cell: (r) => <strong>{formatMoney(r.net_after_refunds)}</strong>, align: 'right' },
        ]} />
      </Card>
      <Card title="Discounts" padded={false}>
        <DataTable rows={discounts.data?.data.discounts} loading={discounts.isPending} rowKey={(r) => r.discount_type} empty="No discounts given." columns={[
          { header: 'Type', cell: (r) => titleCase(r.discount_type) },
          { header: 'Sales', cell: (r) => r.transactions, align: 'right' },
          { header: 'Discount', cell: (r) => formatMoney(r.discounts), align: 'right' },
          { header: 'VAT exempted', cell: (r) => formatMoney(r.vat_exemptions), align: 'right' },
        ]} />
      </Card>
    </div>
  );
}

function BreakdownReport({ filters }: { filters: Filters }) {
  const byBranch = useReport<{ branch_id: number; branch_name: string; transactions: number; net_sales: string; vat: string }[]>('sales-by-branch', filters);
  const byCashier = useReport<{ cashier_id: number; cashier_name: string; transactions: number; net_sales: string; discounts: string }[]>('sales-by-cashier', filters);
  const byMethod = useReport<{ method: string; payments: number; collected: string; refunded: string; net: string }[]>('sales-by-payment-method', filters);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="By branch" padded={false}>
        <DataTable rows={byBranch.data?.data} loading={byBranch.isPending} error={byBranch.error} rowKey={(r) => r.branch_id} empty="No sales." columns={[
          { header: 'Branch', cell: (r) => r.branch_name },
          { header: 'Txns', cell: (r) => r.transactions, align: 'right' },
          { header: 'Net sales', cell: (r) => formatMoney(r.net_sales), align: 'right' },
        ]} />
      </Card>
      <Card title="By payment method" padded={false}>
        <DataTable rows={byMethod.data?.data} loading={byMethod.isPending} error={byMethod.error} rowKey={(r) => r.method} empty="No payments." columns={[
          { header: 'Method', cell: (r) => titleCase(r.method) },
          { header: 'Collected', cell: (r) => formatMoney(r.collected), align: 'right' },
          { header: 'Refunded', cell: (r) => formatMoney(r.refunded), align: 'right' },
          { header: 'Net', cell: (r) => formatMoney(r.net), align: 'right' },
        ]} />
      </Card>
      <Card title="By cashier" padded={false} className="lg:col-span-2">
        <DataTable rows={byCashier.data?.data} loading={byCashier.isPending} error={byCashier.error} rowKey={(r) => r.cashier_id} empty="No sales." columns={[
          { header: 'Cashier', cell: (r) => r.cashier_name },
          { header: 'Txns', cell: (r) => r.transactions, align: 'right' },
          { header: 'Discounts given', cell: (r) => formatMoney(r.discounts), align: 'right' },
          { header: 'Net sales', cell: (r) => formatMoney(r.net_sales), align: 'right' },
        ]} />
      </Card>
    </div>
  );
}

function ProductsReport({ filters }: { filters: Filters }) {
  const best = useReport<{ product_id: number; sku: string; name: string; quantity_sold: string; quantity_refunded: string; net_quantity: string; revenue: string }[]>('best-sellers', filters, { limit: 20 });
  const movements = useReport<{ type: string; movements: number; quantity: string; value_at_cost: string }[]>('inventory-movements', filters);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Best sellers" padded={false}>
        <DataTable rows={best.data?.data} loading={best.isPending} error={best.error} rowKey={(r) => r.product_id} empty="No sales." columns={[
          { header: 'Product', cell: (r) => r.name },
          { header: 'Net qty', cell: (r) => formatQty(r.net_quantity), align: 'right' },
          { header: 'Revenue', cell: (r) => formatMoney(r.revenue), align: 'right' },
        ]} />
      </Card>
      <Card title="Inventory movements" padded={false}>
        <DataTable rows={movements.data?.data} loading={movements.isPending} error={movements.error} rowKey={(r) => r.type} empty="No movements." columns={[
          { header: 'Type', cell: (r) => titleCase(r.type) },
          { header: 'Count', cell: (r) => r.movements, align: 'right' },
          { header: 'Quantity', cell: (r) => formatQty(r.quantity), align: 'right' },
          { header: 'Value at cost', cell: (r) => formatMoney(r.value_at_cost), align: 'right' },
        ]} />
      </Card>
    </div>
  );
}

interface Profit {
  net_sales_excluding_vat: string;
  refunds_excluding_vat: string;
  net_revenue: string;
  cost_of_goods_sold: string;
  gross_profit: string;
  gross_margin_percent: string | null;
  operating_expenses: string;
  estimated_operating_profit: string;
  data_quality: { sale_lines_without_cost: number; cogs_complete: boolean; business_wide_expenses_included: boolean };
  notes: string[];
}

function ProfitReport({ filters }: { filters: Filters }) {
  const profit = useReport<Profit>('profit', filters);
  const expenses = useReport<{ expense_category_id: number; category: string; count: number; amount: string }[]>('expenses', filters);
  const p = profit.data?.data;
  if (profit.isPending) return <Spinner />;
  if (profit.error || !p) return <ErrorBanner error={profit.error} />;

  const line = (label: string, value: string, strong = false, indent = false) => (
    <div className={`flex justify-between py-1.5 text-sm ${strong ? 'border-t border-slate-200 font-semibold text-slate-900' : 'text-slate-600'} ${indent ? 'pl-4' : ''}`}>
      <span>{label}</span><span className="tabular-nums">{formatMoney(value)}</span>
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Estimated profit (excluding VAT)">
        {line('Net sales', p.net_sales_excluding_vat)}
        {line('Less refunds', `-${p.refunds_excluding_vat}`, false, true)}
        {line('Net revenue', p.net_revenue, true)}
        {line('Cost of goods sold', `-${p.cost_of_goods_sold}`, false, true)}
        {line('Gross profit', p.gross_profit, true)}
        <p className="pb-2 text-right text-xs text-slate-500">Gross margin {p.gross_margin_percent ?? '—'}%</p>
        {line('Recorded operating expenses', `-${p.operating_expenses}`, false, true)}
        {line('Estimated operating profit', p.estimated_operating_profit, true)}
        {!p.data_quality.cogs_complete && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{p.data_quality.sale_lines_without_cost} sale lines had no cost recorded, so COGS may be understated.</p>}
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-slate-500">{p.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      </Card>
      <Card title="Expenses by category" padded={false}>
        <DataTable rows={expenses.data?.data} loading={expenses.isPending} error={expenses.error} rowKey={(r) => r.expense_category_id} empty="No expenses recorded." columns={[
          { header: 'Category', cell: (r) => r.category },
          { header: 'Entries', cell: (r) => r.count, align: 'right' },
          { header: 'Amount', cell: (r) => formatMoney(r.amount), align: 'right' },
        ]} />
        {!p.data_quality.business_wide_expenses_included && <p className="px-4 py-3 text-xs text-slate-500">Business-wide expenses are excluded because this report covers only some branches.</p>}
      </Card>
    </div>
  );
}
