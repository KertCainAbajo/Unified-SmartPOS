<?php

namespace App\Services\Pos;

use App\Enums\SaleDiscountType;
use App\Models\Branch;
use App\Models\Sale;
use App\Models\Tenant;

/** Builds a client-agnostic receipt document (web print, thermal printer, PDF) from a stored sale. */
class ReceiptBuilder
{
    public function build(Sale $sale, bool $reprint = false): array
    {
        $tenant = Tenant::query()->findOrFail($sale->tenant_id);
        $branch = Branch::query()->findOrFail($sale->branch_id);

        return [
            'header' => [
                'business_name' => $tenant->name,
                'legal_name' => $tenant->legal_name,
                'tin' => $tenant->tin,
                'vat_status' => $tenant->vat_registered ? 'VAT Reg.' : 'Non-VAT Reg.',
                'branch' => $branch->name,
                'address' => $branch->address ?? $tenant->address,
                'phone' => $branch->phone ?? $tenant->phone,
            ],
            'receipt_number' => $sale->receipt_number,
            'status' => $sale->status,
            'reprint' => $reprint,
            'date' => $sale->sold_at?->copy()->setTimezone($tenant->timezone)->format('Y-m-d H:i:s'),
            'cashier' => $sale->relationLoaded('cashier') ? $sale->cashier?->name : null,
            'customer' => $sale->relationLoaded('customer') && $sale->customer
                ? ['name' => $sale->customer->name, 'tin' => $sale->customer->tin, 'address' => $sale->customer->address]
                : null,
            'lines' => $sale->items->map(fn ($item) => [
                'name' => $item->name,
                'sku' => $item->sku,
                'quantity' => $item->quantity,
                'unit_price' => $item->unit_price,
                'discount' => $item->discount_amount,
                'amount' => $item->line_total,
                'tax_code' => match ($item->tax_type->value) {
                    'vatable' => $sale->discount_type === SaleDiscountType::None ? 'V' : 'E',
                    'vat_exempt' => 'E',
                    'zero_rated' => 'Z',
                },
            ])->values(),
            'totals' => [
                'subtotal' => $sale->subtotal,
                'less_vat_sc_pwd' => $sale->vat_exemption_amount,
                'discount' => $sale->discount_total,
                'total' => $sale->total,
                'vatable_sales' => $sale->vatable_sales,
                'vat_amount' => $sale->vat_amount,
                'vat_exempt_sales' => $sale->vat_exempt_sales,
                'zero_rated_sales' => $sale->zero_rated_sales,
            ],
            'statutory_discount' => $sale->discount_type === SaleDiscountType::None ? null : [
                'type' => $sale->discount_type,
                'id_number' => $sale->discount_id_number,
                'holder_name' => $sale->discount_holder_name,
            ],
            'payments' => $sale->payments->map(fn ($p) => [
                'method' => $p->method,
                'tendered' => $p->tendered,
                'reference_number' => $p->reference_number,
            ])->values(),
            'amount_tendered' => $sale->amount_tendered,
            'change' => $sale->change_due,
            'footer' => $tenant->vat_registered ? null : 'THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.',
        ];
    }
}
