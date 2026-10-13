<?php

namespace App\Services\Reports;

use App\Enums\RefundStatus;
use App\Enums\SaleStatus;
use App\Models\Tenant;
use App\Support\Money;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Server-side reports computed with database aggregation.
 *
 * Every query is scoped to one tenant and to a list of branches (null = all branches). Sales are
 * reported by their tenant-local business date; refunds by the tenant-local date they were completed;
 * expenses by expense date. Voided sales are excluded everywhere.
 */
class ReportService
{
    /**
     * @param  list<int>|null  $branchIds  null = every branch of the tenant
     */
    public function __construct(
        private readonly Tenant $tenant,
        private readonly string $dateFrom,
        private readonly string $dateTo,
        private readonly ?array $branchIds,
    ) {}

    public function salesSummary(string $groupBy): array
    {
        $period = $groupBy === 'month' ? 'SUBSTR(business_date, 1, 7)' : 'SUBSTR(business_date, 1, 10)';

        $sales = $this->completedSales()
            ->selectRaw("{$period} as period")
            ->selectRaw('COUNT(*) as transactions')
            ->selectRaw('SUM(subtotal) as gross_sales, SUM(discount_total) as discounts, SUM(vat_exemption_amount) as vat_exemptions')
            ->selectRaw('SUM(total) as net_sales, SUM(vat_amount) as vat')
            ->groupByRaw($period)
            ->orderBy('period')
            ->get()->keyBy('period');

        $refundPeriod = $groupBy === 'month' ? 7 : 10;
        $refunds = $this->completedRefunds()->get(['refunds.total', 'refunds.completed_at'])
            ->groupBy(fn ($r) => substr(Carbon::parse($r->completed_at)->setTimezone($this->tenant->timezone)->toDateString(), 0, $refundPeriod))
            ->map(fn ($rows) => $rows->reduce(fn ($sum, $r) => Money::add($sum, (string) $r->total), '0'));

        $periods = $sales->keys()->merge($refunds->keys())->unique()->sort()->values();

        return $periods->map(function (string $p) use ($sales, $refunds) {
            $row = $sales[$p] ?? null;
            $netSales = Money::fromDatabase($row?->net_sales);
            $refunded = Money::round($refunds[$p] ?? '0');

            return [
                'period' => $p,
                'transactions' => (int) ($row?->transactions ?? 0),
                'gross_sales' => Money::fromDatabase($row?->gross_sales),
                'discounts' => Money::fromDatabase($row?->discounts),
                'vat_exemptions' => Money::fromDatabase($row?->vat_exemptions),
                'net_sales' => $netSales,
                'vat' => Money::fromDatabase($row?->vat),
                'refunds' => $refunded,
                'net_after_refunds' => Money::round(Money::sub($netSales, $refunded)),
            ];
        })->all();
    }

    public function salesByBranch(): array
    {
        return $this->completedSales()
            ->join('branches', 'branches.id', '=', 'sales.branch_id')
            ->groupBy('sales.branch_id', 'branches.name')
            ->orderBy('branches.name')
            ->selectRaw('sales.branch_id, branches.name as branch_name, COUNT(*) as transactions, SUM(sales.total) as net_sales, SUM(sales.vat_amount) as vat')
            ->get()
            ->map(fn ($r) => [
                'branch_id' => (int) $r->branch_id,
                'branch_name' => $r->branch_name,
                'transactions' => (int) $r->transactions,
                'net_sales' => Money::fromDatabase($r->net_sales),
                'vat' => Money::fromDatabase($r->vat),
            ])->all();
    }

    public function salesByCashier(): array
    {
        return $this->completedSales()
            ->join('users', 'users.id', '=', 'sales.cashier_id')
            ->groupBy('sales.cashier_id', 'users.name')
            ->orderBy('users.name')
            ->selectRaw('sales.cashier_id, users.name as cashier_name, COUNT(*) as transactions, SUM(sales.total) as net_sales, SUM(sales.discount_total) as discounts')
            ->get()
            ->map(fn ($r) => [
                'cashier_id' => (int) $r->cashier_id,
                'cashier_name' => $r->cashier_name,
                'transactions' => (int) $r->transactions,
                'net_sales' => Money::fromDatabase($r->net_sales),
                'discounts' => Money::fromDatabase($r->discounts),
            ])->all();
    }

    public function salesByPaymentMethod(): array
    {
        $collected = $this->completedSales()
            ->join('payments', 'payments.sale_id', '=', 'sales.id')
            ->where('payments.status', 'completed')
            ->groupBy('payments.method')
            ->selectRaw('payments.method, COUNT(*) as count, SUM(payments.amount) as amount')
            ->get()->keyBy('method');

        $refunded = $this->completedRefunds()
            ->groupBy('refunds.refund_method')
            ->selectRaw('refunds.refund_method as method, SUM(refunds.total) as amount')
            ->get()->keyBy('method');

        return $collected->keys()->merge($refunded->keys())->unique()->sort()->values()->map(function (string $method) use ($collected, $refunded) {
            $amount = Money::fromDatabase($collected[$method]->amount ?? null);
            $refund = Money::fromDatabase($refunded[$method]->amount ?? null);

            return [
                'method' => $method,
                'payments' => (int) ($collected[$method]->count ?? 0),
                'collected' => $amount,
                'refunded' => $refund,
                'net' => Money::round(Money::sub($amount, $refund)),
            ];
        })->all();
    }

    public function bestSellers(int $limit = 20): array
    {
        return $this->completedSales()
            ->join('sale_items', 'sale_items.sale_id', '=', 'sales.id')
            ->groupBy('sale_items.product_id', 'sale_items.sku', 'sale_items.name')
            ->selectRaw('sale_items.product_id, sale_items.sku, sale_items.name')
            ->selectRaw('SUM(sale_items.quantity) as quantity_sold, SUM(sale_items.quantity_refunded) as quantity_refunded, SUM(sale_items.line_total) as revenue')
            ->orderByRaw('SUM(sale_items.quantity) - SUM(sale_items.quantity_refunded) DESC')
            ->limit($limit)
            ->get()
            ->map(fn ($r) => [
                'product_id' => (int) $r->product_id,
                'sku' => $r->sku,
                'name' => $r->name,
                'quantity_sold' => Money::fromDatabase($r->quantity_sold, 3),
                'quantity_refunded' => Money::fromDatabase($r->quantity_refunded, 3),
                'net_quantity' => Money::round(Money::sub(Money::fromDatabase($r->quantity_sold, 3), Money::fromDatabase($r->quantity_refunded, 3)), 3),
                'revenue' => Money::fromDatabase($r->revenue),
            ])->all();
    }

    public function inventoryMovements(): array
    {
        return $this->scoped(DB::table('stock_movements'), 'stock_movements.branch_id')
            ->where('stock_movements.tenant_id', $this->tenant->id)
            ->whereBetween('stock_movements.created_at', $this->utcRange())
            ->groupBy('stock_movements.type')
            ->orderBy('stock_movements.type')
            ->selectRaw('stock_movements.type, COUNT(*) as movements, SUM(stock_movements.quantity_change) as quantity')
            ->selectRaw('SUM(stock_movements.quantity_change * COALESCE(stock_movements.unit_cost, 0)) as value')
            ->get()
            ->map(fn ($r) => [
                'type' => $r->type,
                'movements' => (int) $r->movements,
                'quantity' => Money::fromDatabase($r->quantity, 3),
                'value_at_cost' => Money::fromDatabase($r->value),
            ])->all();
    }

    public function discountsAndRefunds(): array
    {
        $byType = $this->completedSales()
            ->groupBy('sales.discount_type')
            ->selectRaw('sales.discount_type, COUNT(*) as transactions, SUM(sales.discount_total) as discounts, SUM(sales.vat_exemption_amount) as vat_exemptions')
            ->get()
            ->map(fn ($r) => [
                'discount_type' => $r->discount_type === 'none' ? 'manual' : $r->discount_type,
                'transactions' => (int) $r->transactions,
                'discounts' => Money::fromDatabase($r->discounts),
                'vat_exemptions' => Money::fromDatabase($r->vat_exemptions),
            ])
            ->filter(fn ($r) => $r['discount_type'] !== 'manual' || Money::isPositive($r['discounts']))
            ->values()->all();

        $refunds = $this->completedRefunds()->selectRaw('COUNT(*) as count, SUM(refunds.total) as total, SUM(refunds.vat_amount) as vat')->first();
        $pending = $this->scoped(DB::table('refunds'), 'refunds.branch_id')
            ->where('refunds.tenant_id', $this->tenant->id)
            ->where('refunds.status', RefundStatus::PendingApproval->value)
            ->selectRaw('COUNT(*) as count, SUM(refunds.total) as total')->first();

        return [
            'discounts' => $byType,
            'refunds' => [
                'completed_count' => (int) $refunds->count,
                'completed_total' => Money::fromDatabase($refunds->total),
                'completed_vat' => Money::fromDatabase($refunds->vat),
                'pending_count' => (int) $pending->count,
                'pending_total' => Money::fromDatabase($pending->total),
            ],
            'voided_sales' => $this->scoped(DB::table('sales'), 'sales.branch_id')
                ->where('sales.tenant_id', $this->tenant->id)
                ->where('sales.status', SaleStatus::Voided->value)
                ->whereBetween('sales.business_date', [$this->dateFrom, $this->dateTo])
                ->count(),
        ];
    }

    /**
     * Estimated gross and operating profit.
     *
     * net revenue   = Σ(sale total − VAT) − Σ(completed refund total − refund VAT)
     * COGS          = Σ(sale item unit cost × quantity) − Σ(restocked refund item unit cost × quantity)
     * gross profit  = net revenue − COGS
     * operating     = gross profit − recorded operating expenses
     *
     * This is not net profit: income tax, percentage tax, depreciation, financing costs and
     * unrecorded expenses are not available in the system.
     */
    public function profit(): array
    {
        $sales = $this->completedSales()
            ->selectRaw('COUNT(*) as transactions, SUM(sales.total) as total, SUM(sales.vat_amount) as vat')
            ->first();

        $cogs = $this->completedSales()
            ->join('sale_items', 'sale_items.sale_id', '=', 'sales.id')
            ->selectRaw('SUM(sale_items.unit_cost * sale_items.quantity) as cogs')
            ->selectRaw('SUM(CASE WHEN sale_items.unit_cost = 0 THEN 1 ELSE 0 END) as uncosted_lines')
            ->first();

        $refunds = $this->completedRefunds()->selectRaw('SUM(refunds.total) as total, SUM(refunds.vat_amount) as vat')->first();

        $cogsReversed = $this->completedRefunds()
            ->join('refund_items', 'refund_items.refund_id', '=', 'refunds.id')
            ->where('refund_items.restock', true)
            ->selectRaw('SUM(refund_items.unit_cost * refund_items.quantity) as cogs')
            ->first();

        $expenses = $this->expensesQuery()->sum('expenses.amount');

        $salesNet = Money::sub(Money::fromDatabase($sales->total), Money::fromDatabase($sales->vat));
        $refundsNet = Money::sub(Money::fromDatabase($refunds->total), Money::fromDatabase($refunds->vat));
        $netRevenue = Money::round(Money::sub($salesNet, $refundsNet));
        $netCogs = Money::round(Money::sub(Money::fromDatabase($cogs->cogs), Money::fromDatabase($cogsReversed->cogs)));
        $grossProfit = Money::round(Money::sub($netRevenue, $netCogs));
        $operatingExpenses = Money::fromDatabase($expenses);
        $uncosted = (int) $cogs->uncosted_lines;

        return [
            'net_sales_excluding_vat' => Money::round($salesNet),
            'refunds_excluding_vat' => Money::round($refundsNet),
            'net_revenue' => $netRevenue,
            'cost_of_goods_sold' => $netCogs,
            'gross_profit' => $grossProfit,
            'gross_margin_percent' => Money::isPositive($netRevenue) ? Money::round(Money::mul(Money::div($grossProfit, $netRevenue), '100')) : null,
            'operating_expenses' => $operatingExpenses,
            'estimated_operating_profit' => Money::round(Money::sub($grossProfit, $operatingExpenses)),
            'transactions' => (int) $sales->transactions,
            'data_quality' => [
                'sale_lines_without_cost' => $uncosted,
                'cogs_complete' => $uncosted === 0,
                'business_wide_expenses_included' => $this->branchIds === null,
            ],
            'notes' => [
                'Revenue and COGS exclude VAT and voided sales.',
                'COGS uses the branch weighted-average cost captured on each sale line.',
                'Refunded items that were not restocked remain in COGS (treated as a loss).',
                'Operating profit only deducts expenses recorded in SmartPOS.',
                'This is not net profit: taxes on income, depreciation, financing costs and unrecorded expenses are not included.',
            ],
        ];
    }

    public function expensesByCategory(): array
    {
        return $this->expensesQuery()
            ->join('expense_categories', 'expense_categories.id', '=', 'expenses.expense_category_id')
            ->groupBy('expenses.expense_category_id', 'expense_categories.name')
            ->orderBy('expense_categories.name')
            ->selectRaw('expenses.expense_category_id, expense_categories.name as category, COUNT(*) as count, SUM(expenses.amount) as amount')
            ->get()
            ->map(fn ($r) => [
                'expense_category_id' => (int) $r->expense_category_id,
                'category' => $r->category,
                'count' => (int) $r->count,
                'amount' => Money::fromDatabase($r->amount),
            ])->all();
    }

    private function completedSales(): Builder
    {
        return $this->scoped(DB::table('sales'), 'sales.branch_id')
            ->where('sales.tenant_id', $this->tenant->id)
            ->where('sales.status', SaleStatus::Completed->value)
            ->whereBetween('sales.business_date', [$this->dateFrom, $this->dateTo]);
    }

    private function completedRefunds(): Builder
    {
        return $this->scoped(DB::table('refunds'), 'refunds.branch_id')
            ->where('refunds.tenant_id', $this->tenant->id)
            ->where('refunds.status', RefundStatus::Completed->value)
            ->whereBetween('refunds.completed_at', $this->utcRange());
    }

    /** Business-wide expenses (no branch) are included only when reporting across all branches. */
    private function expensesQuery(): Builder
    {
        $query = DB::table('expenses')
            ->where('expenses.tenant_id', $this->tenant->id)
            ->whereNull('expenses.deleted_at')
            ->whereBetween('expenses.expense_date', [$this->dateFrom, $this->dateTo]);

        return $this->branchIds === null ? $query : $query->whereIn('expenses.branch_id', $this->branchIds);
    }

    private function scoped(Builder $query, string $column): Builder
    {
        return $this->branchIds === null ? $query : $query->whereIn($column, $this->branchIds);
    }

    /** @return array{0: Carbon, 1: Carbon} */
    private function utcRange(): array
    {
        $tz = $this->tenant->timezone;

        return [
            Carbon::parse($this->dateFrom, $tz)->startOfDay()->utc(),
            Carbon::parse($this->dateTo, $tz)->endOfDay()->utc(),
        ];
    }
}
