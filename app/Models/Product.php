<?php

namespace App\Models;

use App\Enums\ProductStatus;
use App\Enums\TaxType;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Price and cost are intentionally not fillable: they change only through ProductService,
 * which records price history.
 */
#[Fillable([
    'category_id', 'sku', 'barcode', 'name', 'description', 'unit', 'tax_type',
    'track_inventory', 'allow_decimal_quantity', 'reorder_level', 'show_online',
])]
class Product extends Model
{
    use HasFactory;

    /** Mirrors database defaults so freshly created instances are complete. */
    protected $attributes = [
        'unit' => 'pc',
        'tax_type' => 'vatable',
        'track_inventory' => true,
        'allow_decimal_quantity' => false,
        'reorder_level' => '0.000',
        'status' => 'active',
        'show_online' => true,
    ];

    protected function casts(): array
    {
        return [
            'price' => 'decimal:2',
            'cost_price' => 'decimal:4',
            'reorder_level' => 'decimal:3',
            'tax_type' => TaxType::class,
            'status' => ProductStatus::class,
            'track_inventory' => 'boolean',
            'allow_decimal_quantity' => 'boolean',
            'archived_at' => 'datetime',
            'show_online' => 'boolean',
        ];
    }

    public function isActive(): bool
    {
        return $this->status === ProductStatus::Active;
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function inventory(): HasMany
    {
        return $this->hasMany(Inventory::class);
    }

    public function priceHistory(): HasMany
    {
        return $this->hasMany(PriceHistory::class);
    }

    public function stockMovements(): HasMany
    {
        return $this->hasMany(StockMovement::class);
    }
}
