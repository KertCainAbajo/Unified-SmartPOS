<?php

namespace App\Services;

use App\Models\Branch;
use App\Models\DocumentSequence;
use Illuminate\Support\Facades\DB;

/**
 * Gap-free document numbers (receipts, refunds, transfers, POs …).
 * Must be called inside the transaction that creates the document so a rollback releases the number.
 */
class DocumentNumberer
{
    private const PREFIXES = [
        'receipt' => 'OR',
        'refund' => 'RF',
        'transfer' => 'TR',
        'purchase_order' => 'PO',
        'goods_receipt' => 'GR',
        'stock_count' => 'SC',
        'online_order' => 'ORD',
    ];

    public function next(int $tenantId, string $type, ?Branch $branch = null): string
    {
        $scope = $branch ? 'branch:'.$branch->id : 'tenant';

        DocumentSequence::query()->insertOrIgnore([
            'tenant_id' => $tenantId,
            'type' => $type,
            'scope' => $scope,
            'next_number' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $sequence = DocumentSequence::query()
            ->where(['tenant_id' => $tenantId, 'type' => $type, 'scope' => $scope])
            ->lockForUpdate()
            ->firstOrFail();

        $number = (int) $sequence->next_number;
        DB::table('document_sequences')->where('id', $sequence->id)->update([
            'next_number' => $number + 1,
            'updated_at' => now(),
        ]);

        $prefix = self::PREFIXES[$type] ?? strtoupper($type);
        $parts = array_filter([$prefix, $branch?->code, str_pad((string) $number, 6, '0', STR_PAD_LEFT)]);

        return implode('-', $parts);
    }
}
