<?php

namespace App\Models;

use App\Enums\LineDiscountType;
use App\Enums\TaxType;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Historical snapshot of a product line at the moment of sale. */
class SaleItem extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'tax_type' => TaxType::class,
            'discount_type' => LineDiscountType::class,
            'quantity' => 'decimal:3',
            'unit_price' => 'decimal:2',
            'unit_cost' => 'decimal:4',
            'gross_amount' => 'decimal:2',
            'discount_value' => 'decimal:2',
            'discount_amount' => 'decimal:2',
            'vat_exemption_amount' => 'decimal:2',
            'vat_amount' => 'decimal:2',
            'line_total' => 'decimal:2',
            'quantity_refunded' => 'decimal:3',
        ];
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
