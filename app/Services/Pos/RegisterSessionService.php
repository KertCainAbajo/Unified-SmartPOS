<?php

namespace App\Services\Pos;

use App\Enums\RefundStatus;
use App\Enums\RegisterSessionStatus;
use App\Enums\SaleStatus;
use App\Exceptions\BusinessRuleException;
use App\Models\Refund;
use App\Models\Register;
use App\Models\RegisterSession;
use App\Services\AuditLogger;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/** Cashier shifts: open with a float, close with a cash count. */
class RegisterSessionService
{
    public function __construct(private readonly AuditLogger $audit) {}

    public function open(Register $register, string $openingFloat, int $userId, ?string $notes = null): RegisterSession
    {
        return DB::transaction(function () use ($register, $openingFloat, $userId, $notes) {
            // Serialize openings on this register.
            $register = Register::query()->lockForUpdate()->findOrFail($register->id);

            if (! $register->is_active) {
                throw new BusinessRuleException('This register is inactive.', 'REGISTER_INACTIVE');
            }
            if ($register->openSession()->exists()) {
                throw new BusinessRuleException('This register already has an open shift.', 'REGISTER_ALREADY_OPEN');
            }
            if (RegisterSession::query()->where('tenant_id', $register->tenant_id)->where('opened_by', $userId)
                ->where('status', RegisterSessionStatus::Open->value)->exists()) {
                throw new BusinessRuleException('You already have an open shift on another register.', 'USER_HAS_OPEN_SHIFT');
            }

            $session = RegisterSession::query()->create([
                'tenant_id' => $register->tenant_id,
                'branch_id' => $register->branch_id,
                'register_id' => $register->id,
                'opened_by' => $userId,
                'status' => RegisterSessionStatus::Open,
                'opening_float' => Money::normalize($openingFloat),
                'cash_sales' => '0.00',
                'cash_refunds' => '0.00',
                'opened_at' => now(),
                'notes' => $notes,
            ]);

            $this->audit->log('shift.opened', $session, null, ['register_id' => $register->id, 'opening_float' => $session->opening_float]);

            return $session;
        });
    }

    public function close(RegisterSession $session, string $countedCash, int $userId, ?string $notes = null): RegisterSession
    {
        return DB::transaction(function () use ($session, $countedCash, $userId, $notes) {
            $session = RegisterSession::query()->lockForUpdate()->findOrFail($session->id);

            if (! $session->isOpen()) {
                throw new BusinessRuleException('This shift is already closed.', 'SHIFT_CLOSED');
            }

            $expected = Money::round(Money::sub(Money::add((string) $session->opening_float, (string) $session->cash_sales), (string) $session->cash_refunds));
            $counted = Money::normalize($countedCash);

            $session->forceFill([
                'status' => RegisterSessionStatus::Closed,
                'closed_by' => $userId,
                'closed_at' => now(),
                'expected_cash' => $expected,
                'counted_cash' => $counted,
                'cash_difference' => Money::round(Money::sub($counted, $expected)),
                'notes' => trim(($session->notes ? $session->notes."\n" : '').($notes ?? '')) ?: null,
            ])->save();

            $this->audit->log('shift.closed', $session, ['status' => 'open'], [
                'expected_cash' => $expected,
                'counted_cash' => $counted,
                'cash_difference' => $session->cash_difference,
            ]);

            return $session;
        });
    }

    /** X/Z-reading style summary of a shift. */
    public function summary(RegisterSession $session): array
    {
        $sales = DB::table('sales')->where('register_session_id', $session->id);

        $byMethod = DB::table('payments')
            ->join('sales', 'sales.id', '=', 'payments.sale_id')
            ->where('sales.register_session_id', $session->id)
            ->where('payments.status', 'completed')
            ->groupBy('payments.method')
            ->selectRaw('payments.method, COUNT(*) as count, SUM(payments.amount) as amount')
            ->get()
            ->map(fn ($r) => ['method' => $r->method, 'count' => (int) $r->count, 'amount' => Money::round((string) $r->amount)]);

        $completed = (clone $sales)->where('status', SaleStatus::Completed->value);

        return [
            'sales_count' => (clone $completed)->count(),
            'voided_count' => (clone $sales)->where('status', SaleStatus::Voided->value)->count(),
            'gross_sales' => Money::round((string) ((clone $completed)->sum('total') ?: '0')),
            'discounts' => Money::round((string) ((clone $completed)->sum('discount_total') ?: '0')),
            'vat_amount' => Money::round((string) ((clone $completed)->sum('vat_amount') ?: '0')),
            'refunds' => Money::round((string) (Refund::query()->where('register_session_id', $session->id)
                ->where('status', RefundStatus::Completed->value)->sum('total') ?: '0')),
            'payments_by_method' => $byMethod->values(),
            'cash' => [
                'opening_float' => $session->opening_float,
                'cash_sales' => $session->cash_sales,
                'cash_refunds' => $session->cash_refunds,
                'expected_cash' => $session->expected_cash
                    ?? Money::round(Money::sub(Money::add((string) $session->opening_float, (string) $session->cash_sales), (string) $session->cash_refunds)),
                'counted_cash' => $session->counted_cash,
                'cash_difference' => $session->cash_difference,
            ],
        ];
    }
}
