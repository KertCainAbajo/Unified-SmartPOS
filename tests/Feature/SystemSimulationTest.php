<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Product;
use App\Models\Register;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Money;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Pos\PosTestHelpers;
use Tests\Feature\Staff\StaffTestHelpers;
use Tests\TestCase;

/**
 * The "loop engine": runs a business through many rounds of random but realistic work over the real API — selling,
 * voiding, refunding (with approvals), adjusting, transferring, ordering, receiving, counting, expenses and shift
 * closes — and after every single step checks that the books still balance:
 *
 *  - no request ever fails with a server error (5xx);
 *  - every stock balance equals the sum of its ledger movements, and never goes below zero;
 *  - every completed sale is fully paid, and its items add up to its total;
 *  - refunded amounts/quantities on sales match the completed refunds;
 *  - received quantities on purchase orders match the goods receipts;
 *  - each shift's cash sales/refunds match its payments, and closing computes the drawer difference correctly;
 *  - reports agree with the underlying sales.
 *
 * Run longer or reproduce a failure:  SIM_ROUNDS=1000 SIM_SEED=12345 php artisan test --filter SystemSimulation
 */
class SystemSimulationTest extends TestCase
{
    use PosTestHelpers;
    use StaffTestHelpers;

    private Tenant $tenant;

    private User $owner;

    private User $cashier;

    /** @var list<Branch> */
    private array $branches = [];

    /** @var list<Product> */
    private array $products = [];

    private Supplier $supplier;

    private int $expenseCategoryId;

    /** user id => register used by that user */
    private array $registerOf = [];

    /** @var list<string> recent actions, printed when a check fails */
    private array $trail = [];

    private int $simSeed;

    private array $stats = [];

    protected function setUp(): void
    {
        parent::setUp();
        // The simulation fires far more requests per minute than a person could.
        foreach (['api', 'checkout'] as $limiter) {
            RateLimiter::for($limiter, fn () => Limit::none());
        }
    }

    public function test_random_business_operations_keep_the_books_consistent(): void
    {
        $this->simSeed = (int) (getenv('SIM_SEED') ?: random_int(1, 999_999));
        $rounds = (int) (getenv('SIM_ROUNDS') ?: 150);
        mt_srand($this->simSeed);

        $this->setUpBusiness();

        $actions = [
            'sell' => 30, 'void' => 5, 'refund' => 8, 'adjust' => 7, 'transfer' => 8, 'purchase' => 6,
            'directReceipt' => 5, 'stockCount' => 5, 'expense' => 6, 'closeShift' => 5, 'reports' => 5, 'reads' => 5,
        ];
        $bag = [];
        foreach ($actions as $name => $weight) {
            array_push($bag, ...array_fill(0, $weight, $name));
        }

        for ($i = 1; $i <= $rounds; $i++) {
            $action = $bag[mt_rand(0, count($bag) - 1)];
            $this->trail[] = "#{$i} {$action}";
            $this->stats[$action] = ($this->stats[$action] ?? 0) + 1;
            $this->{$action}();
            $this->checkInvariants("after #{$i} {$action}");
        }

        // Wind down: close every open shift and re-check, then compare the reports with the raw data.
        foreach ([$this->owner, $this->cashier] as $user) {
            $this->closeShiftFor($user);
        }
        $this->checkInvariants('after closing all shifts');
        $this->checkReports();

        $t = $this->tenant->id;
        $outcome = [
            'sales' => DB::table('sales')->where('tenant_id', $t)->where('status', 'completed')->count(),
            'voided' => DB::table('sales')->where('tenant_id', $t)->where('status', 'voided')->count(),
            'refunds' => DB::table('refunds')->where('tenant_id', $t)->where('status', 'completed')->count(),
            'refunds_rejected' => DB::table('refunds')->where('tenant_id', $t)->where('status', 'rejected')->count(),
            'transfers' => DB::table('stock_transfers')->where('tenant_id', $t)->count(),
            'purchase_orders' => DB::table('purchase_orders')->where('tenant_id', $t)->count(),
            'goods_receipts' => DB::table('goods_receipts')->where('tenant_id', $t)->count(),
            'stock_movements' => DB::table('stock_movements')->where('tenant_id', $t)->count(),
            'shifts' => DB::table('register_sessions')->where('tenant_id', $t)->count(),
        ];
        fwrite(STDERR, sprintf("\n[simulation] seed=%d rounds=%d\n  actions: %s\n  results: %s\n", $this->simSeed, $rounds, json_encode($this->stats), json_encode($outcome)));
        $this->assertTrue(true);
    }

    /* ======================================================================== Setup */

    private function setUpBusiness(): void
    {
        [$this->tenant, $this->owner, $main] = $this->createTenant();
        $this->tenant->forceFill(['refund_approval_threshold' => '50.00'])->save();
        $this->branches = [$main, $this->createBranch($this->tenant, 'DVO'), $this->createBranch($this->tenant, 'MKT')];

        foreach (range(1, 8) as $n) {
            $product = $this->createProduct($this->tenant, [
                'sku' => "SIM-{$n}", 'name' => "Sim product {$n}",
                'price' => number_format(mt_rand(1000, 25000) / 100, 2, '.', ''),
                'cost_price' => '5.0000', 'track_inventory' => true, 'reorder_level' => '5.000',
            ]);
            foreach ($this->branches as $branch) {
                $this->setStock($product, $branch, (string) mt_rand(0, 30), '5.0000');
            }
            $this->products[] = $product;
        }

        $this->supplier = Supplier::query()->forceCreate(['tenant_id' => $this->tenant->id, 'name' => 'Sim Supplier', 'is_active' => true]);
        $this->expenseCategoryId = $this->api($this->owner, 'POST', 'expense-categories', ['name' => 'Simulation costs'])->assertCreated()->json('data.id');

        // A cashier at the main branch on a second register, so refunds need the owner's approval.
        [$membership] = $this->activeStaff($this->tenant, $this->owner, 'cashier', [$main]);
        $this->cashier = $membership->user;
        $this->registerOf[$this->owner->id] = $this->registerFor($main);
        $this->registerOf[$this->cashier->id] = Register::query()->forceCreate([
            'tenant_id' => $this->tenant->id, 'branch_id' => $main->id, 'code' => 'REG-2', 'name' => 'Register 2', 'is_active' => true,
        ]);
    }

    /* ======================================================================== Actions */

    private function sell(): void
    {
        $user = $this->pickUser();
        $session = $this->ensureShift($user);
        $branchId = $session->branch_id;

        $items = [];
        foreach ($this->pickSome($this->products, mt_rand(1, 3)) as $product) {
            $item = ['product_id' => $product->id, 'quantity' => mt_rand(1, 3)];
            if (mt_rand(1, 6) === 1) {
                $item['discount'] = ['type' => 'percent', 'value' => (string) mt_rand(5, 20)];
            }
            $items[] = $item;
        }
        $body = ['register_id' => $session->register_id, 'items' => $items];
        if (mt_rand(1, 8) === 1) {
            $body['discount'] = ['type' => mt_rand(0, 1) ? 'senior_citizen' : 'pwd', 'id_number' => 'SC-'.mt_rand(1000, 9999), 'holder_name' => 'Juan Dela Cruz'];
        }

        // Ask for the authoritative total first, as the POS does, then pay it in one of several ways.
        $quote = $this->api($user, 'POST', 'sales/quote', $body);
        if ($quote->status() !== 200) {
            return;
        }
        $total = (string) $quote->json('data.totals.total');
        $body['payments'] = match (mt_rand(1, 4)) {
            1 => [['method' => 'cash', 'amount' => $total]],
            2 => [['method' => 'cash', 'amount' => Money::round(Money::add($total, (string) mt_rand(1, 500)))]],
            3 => [['method' => 'gcash', 'amount' => $total, 'reference_number' => 'G'.mt_rand(100000, 999999)]],
            default => Money::cmp($total, '1.00') > 0
                ? [['method' => 'card', 'amount' => '1.00'], ['method' => 'cash', 'amount' => Money::round(Money::sub($total, '1.00'))]]
                : [['method' => 'cash', 'amount' => $total]],
        };

        $response = $this->api($user, 'POST', 'sales', $body, ['Idempotency-Key' => 'sim-'.Str::random(20)]);
        $this->expectStatus($response, [201, 422], 'sell');
        if ($response->status() === 422) {
            $this->assertContains($response->json('code'), ['INSUFFICIENT_STOCK', null, 'BUSINESS_RULE_VIOLATION', 'INVALID_DISCOUNT'], 'Unexpected checkout refusal: '.$response->getContent().$this->context());
        }
        unset($branchId);
    }

    private function void(): void
    {
        $sale = DB::table('sales')->where('tenant_id', $this->tenant->id)->where('status', 'completed')
            ->where('refunded_total', 0)->inRandomOrder()->first();
        if (! $sale) {
            return;
        }
        $response = $this->api($this->owner, 'POST', "sales/{$sale->id}/void", ['reason' => 'Simulation void']);
        $this->expectStatus($response, [200, 422], 'void');
    }

    private function refund(): void
    {
        $item = DB::table('sale_items')->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sales.tenant_id', $this->tenant->id)->where('sales.status', 'completed')
            ->whereColumn('sale_items.quantity_refunded', '<', 'sale_items.quantity')
            ->inRandomOrder()->select('sale_items.*', 'sales.branch_id')->first();
        if (! $item) {
            return;
        }
        $user = mt_rand(0, 1) ? $this->owner : $this->cashier;
        $session = $this->openShiftOf($user);
        $response = $this->api($user, 'POST', 'refunds', [
            'sale_id' => $item->sale_id,
            'reason' => 'Simulation return',
            'refund_method' => 'cash',
            'register_session_id' => $session && $session->branch_id === $item->branch_id ? $session->id : null,
            'items' => [['sale_item_id' => $item->id, 'quantity' => 1, 'restock' => (bool) mt_rand(0, 1)]],
        ]);
        $this->expectStatus($response, [201, 403, 422], 'refund');

        if ($response->status() === 201 && $response->json('data.status') === 'pending_approval') {
            $id = $response->json('data.id');
            $decision = mt_rand(0, 2) ? 'approve' : 'reject';
            $this->expectStatus($this->api($this->owner, 'POST', "refunds/{$id}/{$decision}", ['reason' => 'Simulation decision']), [200, 422], "refund {$decision}");
        }
    }

    private function adjust(): void
    {
        $branch = $this->pick($this->branches);
        $reason = $this->pick(['damaged', 'found', 'correction', 'expired']);
        $change = in_array($reason, ['found'], true) ? mt_rand(1, 5) : $this->pick([-3, -2, -1, 1, 2, 4]);
        $response = $this->api($this->owner, 'POST', 'inventory/adjustments', [
            'branch_id' => $branch->id, 'reason' => $reason,
            'items' => [['product_id' => $this->pick($this->products)->id, 'quantity_change' => (string) $change] + ($reason === 'found' ? ['unit_cost' => '6.00'] : [])],
        ]);
        $this->expectStatus($response, [200, 201, 422], 'adjust');
    }

    private function transfer(): void
    {
        [$from, $to] = $this->pickSome($this->branches, 2);
        $response = $this->api($this->owner, 'POST', 'stock-transfers', [
            'from_branch_id' => $from->id, 'to_branch_id' => $to->id,
            'items' => [['product_id' => $this->pick($this->products)->id, 'quantity' => (string) mt_rand(1, 4)]],
        ]);
        $this->expectStatus($response, [201, 422], 'transfer create');
        if ($response->status() !== 201) {
            return;
        }
        $id = $response->json('data.id');
        if (mt_rand(1, 6) === 1) {
            $this->expectStatus($this->api($this->owner, 'POST', "stock-transfers/{$id}/cancel"), [200], 'transfer cancel draft');

            return;
        }
        $dispatch = $this->api($this->owner, 'POST', "stock-transfers/{$id}/dispatch");
        $this->expectStatus($dispatch, [200, 422], 'transfer dispatch');
        if ($dispatch->status() !== 200) {
            return;
        }
        $next = mt_rand(1, 5) === 1 ? 'cancel' : 'receive';
        $this->expectStatus($this->api($this->owner, 'POST', "stock-transfers/{$id}/{$next}"), [200], "transfer {$next}");
    }

    private function purchase(): void
    {
        $branch = $this->pick($this->branches);
        $lines = array_map(fn (Product $p) => ['product_id' => $p->id, 'quantity' => (string) mt_rand(2, 12), 'unit_cost' => number_format(mt_rand(300, 900) / 100, 2, '.', '')], $this->pickSome($this->products, mt_rand(1, 3)));
        $po = $this->api($this->owner, 'POST', 'purchase-orders', ['branch_id' => $branch->id, 'supplier_id' => $this->supplier->id, 'items' => $lines]);
        $this->expectStatus($po, [201], 'po create');
        $id = $po->json('data.id');
        $this->expectStatus($this->api($this->owner, 'POST', "purchase-orders/{$id}/order"), [200], 'po order');

        $order = $this->api($this->owner, 'GET', "purchase-orders/{$id}")->json('data');
        $partial = mt_rand(0, 1) === 1;
        $receipt = $this->api($this->owner, 'POST', 'goods-receipts', [
            'branch_id' => $branch->id, 'purchase_order_id' => $id,
            'items' => array_map(fn ($i) => [
                'purchase_order_item_id' => $i['id'],
                'quantity' => $partial ? (string) max(1, intdiv((int) $i['quantity_ordered'], 2)) : $i['quantity_ordered'],
            ], $order['items']),
        ]);
        $this->expectStatus($receipt, [201], 'po receive');
        if ($partial && mt_rand(0, 1)) {
            $this->expectStatus($this->api($this->owner, 'POST', "purchase-orders/{$id}/close", ['reason' => 'Supplier short']), [200], 'po close short');
        }
    }

    private function directReceipt(): void
    {
        $response = $this->api($this->owner, 'POST', 'goods-receipts', [
            'branch_id' => $this->pick($this->branches)->id,
            'supplier_id' => mt_rand(0, 1) ? $this->supplier->id : null,
            'items' => [['product_id' => $this->pick($this->products)->id, 'quantity' => (string) mt_rand(1, 10)]],
        ]);
        $this->expectStatus($response, [201], 'direct receipt');
    }

    private function stockCount(): void
    {
        $branch = $this->pick($this->branches);
        $items = array_map(function (Product $p) use ($branch) {
            $qty = (int) (DB::table('inventory')->where('branch_id', $branch->id)->where('product_id', $p->id)->value('quantity') ?? 0);

            return ['product_id' => $p->id, 'counted_quantity' => (string) max(0, $qty + mt_rand(-2, 2))];
        }, $this->pickSome($this->products, 2));
        $count = $this->api($this->owner, 'POST', 'stock-counts', ['branch_id' => $branch->id, 'items' => $items]);
        $this->expectStatus($count, [201], 'stock count');
        $action = mt_rand(1, 5) === 1 ? 'cancel' : 'complete';
        $this->expectStatus($this->api($this->owner, 'POST', 'stock-counts/'.$count->json('data.id').'/'.$action), [200], "stock count {$action}");
    }

    private function expense(): void
    {
        $response = $this->api($this->owner, 'POST', 'expenses', [
            'expense_category_id' => $this->expenseCategoryId,
            'amount' => number_format(mt_rand(5000, 500000) / 100, 2, '.', ''),
            'expense_date' => now($this->tenant->timezone)->toDateString(),
            'description' => 'Simulation expense',
            'branch_id' => mt_rand(0, 3) ? $this->pick($this->branches)->id : null,
            'payment_method' => 'cash',
        ]);
        $this->expectStatus($response, [201], 'expense');
    }

    private function closeShift(): void
    {
        $this->closeShiftFor($this->pickUser());
    }

    private function reports(): void
    {
        $today = now($this->tenant->timezone)->toDateString();
        $query = '?date_from='.$today.'&date_to='.$today.(mt_rand(0, 1) ? '&branch_id='.$this->pick($this->branches)->id : '');
        foreach (['sales-summary', 'sales-by-branch', 'sales-by-cashier', 'sales-by-payment-method', 'best-sellers', 'inventory-movements', 'discounts-refunds', 'profit', 'expenses'] as $report) {
            $this->expectStatus($this->api($this->owner, 'GET', "reports/{$report}{$query}"), [200], "report {$report}");
        }
    }

    /** List and detail pages the web app opens, for every role, including the all-branches view. */
    private function reads(): void
    {
        $user = $this->pickUser();
        $branch = mt_rand(0, 1) ? '' : '&branch_id='.$this->branches[0]->id;
        foreach (['sales', 'refunds', 'register-sessions', 'inventory', 'inventory/low-stock', 'stock-movements', 'stock-transfers', 'purchase-orders', 'goods-receipts', 'stock-counts', 'expenses', 'staff', 'audit-logs', 'products?with_stock=1', 'notifications'] as $path) {
            $this->expectStatus($this->api($user, 'GET', $path.(str_contains($path, '?') ? $branch : ($branch ? '?'.ltrim($branch, '&') : ''))), [200, 403], "read {$path}");
        }
        $sale = DB::table('sales')->where('tenant_id', $this->tenant->id)->inRandomOrder()->first();
        if ($sale) {
            $this->expectStatus($this->api($this->owner, 'GET', "sales/{$sale->id}/receipt"), [200], 'receipt');
        }
    }

    /* ======================================================================== Shifts */

    private function ensureShift(User $user): object
    {
        if ($session = $this->openShiftOf($user)) {
            return $session;
        }
        $response = $this->api($user, 'POST', 'register-sessions', ['register_id' => $this->registerOf[$user->id]->id, 'opening_float' => (string) mt_rand(0, 2000)]);
        $this->expectStatus($response, [201], 'open shift');

        return $this->openShiftOf($user);
    }

    private function openShiftOf(User $user): ?object
    {
        return DB::table('register_sessions')->where('tenant_id', $this->tenant->id)->where('opened_by', $user->id)->where('status', 'open')->first();
    }

    private function closeShiftFor(User $user): void
    {
        $session = $this->openShiftOf($user);
        if (! $session) {
            return;
        }
        $expected = Money::round(Money::sub(Money::add((string) $session->opening_float, (string) $session->cash_sales), (string) $session->cash_refunds));
        $counted = Money::round(Money::add($expected, (string) $this->pick([0, 0, 0, -20, 5, 100])));
        $counted = Money::isNegative($counted) ? '0.00' : $counted;
        $response = $this->api($user, 'POST', "register-sessions/{$session->id}/close", ['counted_cash' => $counted]);
        $this->expectStatus($response, [200], 'close shift');

        $closed = DB::table('register_sessions')->find($session->id);
        $this->assertSame(0, Money::cmp((string) $closed->expected_cash, $expected), "Expected cash {$closed->expected_cash} != {$expected}".$this->context());
        $this->assertSame(0, Money::cmp((string) $closed->cash_difference, Money::sub($counted, $expected)), 'Wrong drawer difference'.$this->context());
    }

    /* ======================================================================== Invariants */

    private function checkInvariants(string $when): void
    {
        $t = $this->tenant->id;

        // Stock: balance == sum of ledger movements == last movement's "after"; never negative.
        foreach (DB::table('inventory')->where('tenant_id', $t)->get() as $row) {
            $sum = (string) (DB::table('stock_movements')->where('branch_id', $row->branch_id)->where('product_id', $row->product_id)->sum('quantity_change') ?? 0);
            $this->assertSame(0, Money::cmp(Money::normalize((string) $row->quantity, 3), Money::fromDatabase($sum, 3)),
                "Stock {$row->quantity} != ledger sum {$sum} (branch {$row->branch_id}, product {$row->product_id}) {$when}".$this->context());
            $this->assertFalse(Money::isNegative((string) $row->quantity), "Negative stock {$when}".$this->context());
            $last = DB::table('stock_movements')->where('branch_id', $row->branch_id)->where('product_id', $row->product_id)->orderByDesc('id')->value('quantity_after');
            if ($last !== null) {
                $this->assertSame(0, Money::cmp((string) $last, (string) $row->quantity), "Last movement after {$last} != stock {$row->quantity} {$when}".$this->context());
            }
        }

        // Sales: fully paid, items add up, refunds recorded on the sale match completed refunds.
        foreach (DB::table('sales')->where('tenant_id', $t)->get() as $sale) {
            $items = DB::table('sale_items')->where('sale_id', $sale->id)->get();
            $lineTotal = $items->reduce(fn ($c, $i) => Money::add($c, (string) $i->line_total), '0');
            $this->assertSame(0, Money::cmp(Money::round($lineTotal), (string) $sale->total), "Sale {$sale->receipt_number}: items {$lineTotal} != total {$sale->total} {$when}".$this->context());

            if ($sale->status === 'completed') {
                $paid = DB::table('payments')->where('sale_id', $sale->id)->get()->reduce(fn ($c, $p) => Money::add($c, (string) $p->amount), '0');
                $this->assertSame(0, Money::cmp(Money::round($paid), (string) $sale->total), "Sale {$sale->receipt_number} paid {$paid} != total {$sale->total} {$when}".$this->context());
            }

            $refunded = DB::table('refunds')->where('sale_id', $sale->id)->where('status', 'completed')->get()->reduce(fn ($c, $r) => Money::add($c, (string) $r->total), '0');
            $this->assertSame(0, Money::cmp(Money::round($refunded), (string) $sale->refunded_total), "Sale {$sale->receipt_number} refunded_total {$sale->refunded_total} != refunds {$refunded} {$when}".$this->context());

            foreach ($items as $item) {
                $qty = DB::table('refund_items')->join('refunds', 'refunds.id', '=', 'refund_items.refund_id')
                    ->where('refund_items.sale_item_id', $item->id)->where('refunds.status', 'completed')->sum('refund_items.quantity');
                $this->assertSame(0, Money::cmp(Money::normalize((string) $item->quantity_refunded, 3), Money::fromDatabase($qty, 3)), "Sale item {$item->id} refunded qty mismatch {$when}".$this->context());
                $this->assertTrue(Money::cmp((string) $item->quantity_refunded, (string) $item->quantity) <= 0, "Refunded more than sold {$when}".$this->context());
            }
        }

        // Purchase orders: received quantities match goods receipts and never exceed what was ordered.
        foreach (DB::table('purchase_order_items')->join('purchase_orders', 'purchase_orders.id', '=', 'purchase_order_items.purchase_order_id')->where('purchase_orders.tenant_id', $t)->select('purchase_order_items.*')->get() as $poItem) {
            $received = DB::table('goods_receipt_items')->where('purchase_order_item_id', $poItem->id)->sum('quantity');
            $this->assertSame(0, Money::cmp(Money::normalize((string) $poItem->quantity_received, 3), Money::fromDatabase($received, 3)), "PO item {$poItem->id} received mismatch {$when}".$this->context());
            $this->assertTrue(Money::cmp((string) $poItem->quantity_received, (string) $poItem->quantity_ordered) <= 0, "Over-received PO item {$when}".$this->context());
        }

        // Shifts: cash sales/refunds kept on the shift match the sales and refunds recorded against it.
        foreach (DB::table('register_sessions')->where('tenant_id', $t)->get() as $session) {
            $cash = DB::table('payments')->join('sales', 'sales.id', '=', 'payments.sale_id')
                ->where('sales.register_session_id', $session->id)->where('sales.status', 'completed')->where('payments.method', 'cash')
                ->get(['payments.amount'])->reduce(fn ($c, $p) => Money::add($c, (string) $p->amount), '0');
            $this->assertSame(0, Money::cmp(Money::round($cash), (string) $session->cash_sales), "Shift {$session->id} cash_sales {$session->cash_sales} != payments {$cash} {$when}".$this->context());
            $refunds = DB::table('refunds')->where('register_session_id', $session->id)->where('status', 'completed')->where('refund_method', 'cash')
                ->get()->reduce(fn ($c, $r) => Money::add($c, (string) $r->total), '0');
            $this->assertSame(0, Money::cmp(Money::round($refunds), (string) $session->cash_refunds), "Shift {$session->id} cash_refunds {$session->cash_refunds} != refunds {$refunds} {$when}".$this->context());
        }
    }

    private function checkReports(): void
    {
        $today = now($this->tenant->timezone)->toDateString();
        $summary = $this->api($this->owner, 'GET', "reports/sales-summary?date_from={$today}&date_to={$today}")->assertOk()->json('data');
        $transactions = array_sum(array_column($summary, 'transactions'));
        $completed = DB::table('sales')->where('tenant_id', $this->tenant->id)->where('status', 'completed')->count();
        $this->assertSame($completed, $transactions, 'Report transaction count does not match completed sales'.$this->context());

        $net = DB::table('sales')->where('tenant_id', $this->tenant->id)->where('status', 'completed')->get()->reduce(fn ($c, $s) => Money::add($c, (string) $s->total), '0');
        $reported = array_reduce($summary, fn ($c, $r) => Money::add($c, (string) $r['net_sales']), '0');
        $this->assertSame(0, Money::cmp(Money::round($reported), Money::round($net)), "Report net sales {$reported} != sales total {$net}".$this->context());
    }

    /* ======================================================================== Helpers */

    private function api(User $user, string $method, string $path, array $data = [], array $headers = []): TestResponse
    {
        $this->app['auth']->forgetGuards();
        $response = $this->actingAsUser($user)->withHeaders($headers)->json($method, $this->tenantUrl($this->tenant, $path), $data);
        $this->assertLessThan(500, $response->status(), "Server error on {$method} {$path}: ".Str::limit($response->getContent(), 600).$this->context());

        return $response;
    }

    private function expectStatus(TestResponse $response, array $allowed, string $what): void
    {
        $this->assertContains($response->status(), $allowed, "{$what} returned {$response->status()}: ".Str::limit($response->getContent(), 600).$this->context());
    }

    private function pickUser(): User
    {
        return mt_rand(0, 2) ? $this->owner : $this->cashier;
    }

    private function pick(array $items): mixed
    {
        return $items[mt_rand(0, count($items) - 1)];
    }

    private function pickSome(array $items, int $n): array
    {
        $keys = array_keys($items);
        for ($i = count($keys) - 1; $i > 0; $i--) {
            $j = mt_rand(0, $i);
            [$keys[$i], $keys[$j]] = [$keys[$j], $keys[$i]];
        }

        return array_map(fn ($k) => $items[$k], array_slice($keys, 0, min($n, count($keys))));
    }

    private function context(): string
    {
        return "\n  Reproduce with SIM_SEED={$this->simSeed}. Last actions: ".implode(' → ', array_slice($this->trail, -12));
    }
}
