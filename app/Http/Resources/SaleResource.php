<?php

namespace App\Http\Resources;

use App\Models\Sale;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Sale */
class SaleResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $context = app(TenantContext::class);
        $showCost = $context->hasTenant() && $context->can('reports.financial');

        return [
            'id' => $this->id,
            'receipt_number' => $this->receipt_number,
            'status' => $this->status,
            'payment_status' => $this->payment_status,
            'branch_id' => $this->branch_id,
            'register_id' => $this->register_id,
            'register_session_id' => $this->register_session_id,
            'cashier' => $this->whenLoaded('cashier', fn () => $this->cashier->only(['id', 'name'])),
            'cashier_id' => $this->cashier_id,
            'customer' => $this->whenLoaded('customer', fn () => $this->customer?->only(['id', 'name', 'tin'])),
            'subtotal' => $this->subtotal,
            'discount_total' => $this->discount_total,
            'vat_exemption_amount' => $this->vat_exemption_amount,
            'vatable_sales' => $this->vatable_sales,
            'vat_exempt_sales' => $this->vat_exempt_sales,
            'zero_rated_sales' => $this->zero_rated_sales,
            'vat_amount' => $this->vat_amount,
            'total' => $this->total,
            'amount_tendered' => $this->amount_tendered,
            'change_due' => $this->change_due,
            'refunded_total' => $this->refunded_total,
            'discount' => [
                'type' => $this->discount_type,
                'id_number' => $this->discount_id_number,
                'holder_name' => $this->discount_holder_name,
            ],
            'notes' => $this->notes,
            'business_date' => $this->business_date?->toDateString(),
            'sold_at' => $this->sold_at,
            'voided_at' => $this->voided_at,
            'void_reason' => $this->void_reason,
            'items' => $this->whenLoaded('items', fn () => $this->items->map(fn ($item) => [
                'id' => $item->id,
                'product_id' => $item->product_id,
                'sku' => $item->sku,
                'barcode' => $item->barcode,
                'name' => $item->name,
                'unit' => $item->unit,
                'tax_type' => $item->tax_type,
                'quantity' => $item->quantity,
                'unit_price' => $item->unit_price,
                'gross_amount' => $item->gross_amount,
                'discount_type' => $item->discount_type,
                'discount_value' => $item->discount_value,
                'discount_amount' => $item->discount_amount,
                'vat_exemption_amount' => $item->vat_exemption_amount,
                'vat_amount' => $item->vat_amount,
                'line_total' => $item->line_total,
                'quantity_refunded' => $item->quantity_refunded,
                'unit_cost' => $this->when($showCost, $item->unit_cost),
            ])),
            'payments' => $this->whenLoaded('payments', fn () => $this->payments->map(fn ($p) => [
                'id' => $p->id,
                'method' => $p->method,
                'amount' => $p->amount,
                'tendered' => $p->tendered,
                'reference_number' => $p->reference_number,
                'status' => $p->status,
            ])),
        ];
    }
}
