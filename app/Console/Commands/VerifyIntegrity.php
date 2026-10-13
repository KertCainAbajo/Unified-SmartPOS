<?php

namespace App\Console\Commands;

use App\Support\Money;
use Illuminate\Console\Attributes\AsCommand;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Read-only consistency checks over the ledger and financial tables. Safe to run in production.
 */
#[AsCommand(name: 'smartpos:verify-integrity')]
class VerifyIntegrity extends Command
{
    protected $signature = 'smartpos:verify-integrity {--tenant= : Limit checks to one tenant ID}';

    protected $description = 'Verify stock ledger, sale, payment and refund invariants (read-only)';

    public function handle(): int
    {
        $tenant = $this->option('tenant');
        $failures = 0;

        $checks = [
            'Inventory balance equals the sum of stock movements' => DB::table('inventory')
                ->leftJoinSub(
                    DB::table('stock_movements')->groupBy('branch_id', 'product_id')
                        ->selectRaw('branch_id, product_id, SUM(quantity_change) as moved'),
                    'm', fn ($j) => $j->on('m.branch_id', '=', 'inventory.branch_id')->on('m.product_id', '=', 'inventory.product_id'))
                ->when($tenant, fn ($q) => $q->where('inventory.tenant_id', $tenant))
                ->get(['inventory.id', 'inventory.quantity as expected', 'm.moved as actual'])
                ->filter(fn ($r) => Money::cmp(Money::fromDatabase($r->expected, 3), Money::fromDatabase($r->actual, 3)) !== 0),

            'Sale total equals the sum of its line totals' => DB::table('sales')
                ->leftJoinSub(DB::table('sale_items')->groupBy('sale_id')->selectRaw('sale_id, SUM(line_total) as line_sum'), 'i', 'i.sale_id', '=', 'sales.id')
                ->when($tenant, fn ($q) => $q->where('sales.tenant_id', $tenant))
                ->get(['sales.id', 'sales.total as expected', 'i.line_sum as actual'])
                ->filter(fn ($r) => Money::cmp(Money::fromDatabase($r->expected), Money::fromDatabase($r->actual)) !== 0),

            'Completed sale payments equal the sale total' => DB::table('sales')
                ->leftJoinSub(DB::table('payments')->where('status', 'completed')->groupBy('sale_id')->selectRaw('sale_id, SUM(amount) as paid'), 'p', 'p.sale_id', '=', 'sales.id')
                ->where('sales.status', 'completed')
                ->when($tenant, fn ($q) => $q->where('sales.tenant_id', $tenant))
                ->get(['sales.id', 'sales.total as expected', 'p.paid as actual'])
                ->filter(fn ($r) => Money::cmp(Money::fromDatabase($r->expected), Money::fromDatabase($r->actual)) !== 0),

            'Sale refunded_total equals completed refunds' => DB::table('sales')
                ->leftJoinSub(DB::table('refunds')->where('status', 'completed')->groupBy('sale_id')->selectRaw('sale_id, SUM(total) as refunded'), 'r', 'r.sale_id', '=', 'sales.id')
                ->when($tenant, fn ($q) => $q->where('sales.tenant_id', $tenant))
                ->get(['sales.id', 'sales.refunded_total as expected', 'r.refunded as actual'])
                ->filter(fn ($r) => Money::cmp(Money::fromDatabase($r->expected), Money::fromDatabase($r->actual)) !== 0),

            'Sale item quantity_refunded equals completed refund items' => DB::table('sale_items')
                ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
                ->leftJoinSub(DB::table('refund_items')->join('refunds', 'refunds.id', '=', 'refund_items.refund_id')
                    ->where('refunds.status', 'completed')->groupBy('refund_items.sale_item_id')
                    ->selectRaw('refund_items.sale_item_id, SUM(refund_items.quantity) as qty'), 'ri', 'ri.sale_item_id', '=', 'sale_items.id')
                ->when($tenant, fn ($q) => $q->where('sales.tenant_id', $tenant))
                ->get(['sale_items.id', 'sale_items.quantity_refunded as expected', 'ri.qty as actual'])
                ->filter(fn ($r) => Money::cmp(Money::fromDatabase($r->expected, 3), Money::fromDatabase($r->actual, 3)) !== 0),
        ];

        foreach ($checks as $label => $violations) {
            if ($violations->isEmpty()) {
                $this->components->twoColumnDetail($label, '<fg=green>OK</>');

                continue;
            }

            $failures += $violations->count();
            $this->components->twoColumnDetail($label, "<fg=red>{$violations->count()} violation(s)</>");
            $this->table(['id', 'expected', 'actual'], $violations->take(20)->map(fn ($r) => (array) $r)->all());
        }

        return $failures === 0 ? self::SUCCESS : self::FAILURE;
    }
}
