<?php

namespace App\Services\Pos;

use App\Enums\PaymentMethod;
use App\Enums\PaymentStatus;
use App\Enums\RefundStatus;
use App\Enums\SaleStatus;
use App\Enums\StockMovementType;
use App\Exceptions\BusinessRuleException;
use App\Models\RegisterSession;
use App\Models\Sale;
use App\Services\AuditLogger;
use App\Services\Inventory\StockLedger;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * Voids reverse a whole sale within the same open shift (e.g. cashier error). The sale row is kept,
 * marked voided, and stock and shift cash are restored. Later reversals must use refunds.
 */
class SaleVoidService
{
    public function __construct(
        private readonly StockLedger $ledger,
        private readonly AuditLogger $audit,
    ) {}

    public function void(Sale $sale, string $reason, int $userId): Sale
    {
        return DB::transaction(function () use ($sale, $reason, $userId) {
            $sale = Sale::query()->lockForUpdate()->findOrFail($sale->id);
            $session = RegisterSession::query()->lockForUpdate()->findOrFail($sale->register_session_id);

            if ($sale->status !== SaleStatus::Completed) {
                throw new BusinessRuleException('Only completed sales can be voided.', 'SALE_NOT_VOIDABLE');
            }
            if (! $session->isOpen()) {
                throw new BusinessRuleException('The shift for this sale is closed. Use a refund instead.', 'SHIFT_CLOSED');
            }
            if (Money::isPositive((string) $sale->refunded_total)
                || $sale->refunds()->where('status', RefundStatus::PendingApproval->value)->exists()) {
                throw new BusinessRuleException('Sales with refunds cannot be voided.', 'SALE_HAS_REFUNDS');
            }

            $items = $sale->items()->with('product')->get();
            $tracked = $items->filter(fn ($item) => $item->product->track_inventory);
            $rows = $this->ledger->lockRows($sale->tenant_id, $sale->branch_id, $tracked->pluck('product_id')->all());

            foreach ($tracked as $item) {
                $this->ledger->post($rows[$item->product_id], StockMovementType::SaleVoid, (string) $item->quantity, [
                    'unit_cost' => (string) $item->unit_cost,
                    'reference' => $sale,
                    'reason' => "Void {$sale->receipt_number}",
                    'user_id' => $userId,
                    'allow_negative' => true,
                ]);
            }

            $cashApplied = (string) ($sale->payments()->where('method', PaymentMethod::Cash->value)->sum('amount') ?: '0');
            $sale->payments()->update(['status' => 'voided']);
            if (Money::isPositive($cashApplied)) {
                $session->cash_sales = Money::round(Money::sub((string) $session->cash_sales, $cashApplied));
                $session->save();
            }

            $sale->forceFill([
                'status' => SaleStatus::Voided,
                'payment_status' => PaymentStatus::Voided,
                'voided_at' => now(),
                'voided_by' => $userId,
                'void_reason' => $reason,
            ])->save();

            $this->audit->log('sale.voided', $sale, ['status' => 'completed'], ['status' => 'voided'], [
                'receipt_number' => $sale->receipt_number,
                'total' => $sale->total,
                'reason' => $reason,
            ]);

            return $sale;
        });
    }
}
