<?php

namespace Database\Factories;

use App\Enums\ProductStatus;
use App\Enums\TaxType;
use App\Models\Product;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Product>
 */
class ProductFactory extends Factory
{
    public function definition(): array
    {
        $price = fake()->numberBetween(10, 2000);

        return [
            'sku' => strtoupper(fake()->unique()->bothify('SKU-####??')),
            'barcode' => fake()->unique()->ean13(),
            'name' => ucfirst(fake()->words(3, true)),
            'description' => null,
            'unit' => 'pc',
            'price' => $price.'.00',
            'cost_price' => number_format($price * 0.65, 4, '.', ''),
            'tax_type' => TaxType::Vatable,
            'track_inventory' => true,
            'allow_decimal_quantity' => false,
            'reorder_level' => '5.000',
            'status' => ProductStatus::Active,
        ];
    }

    public function price(string $price, string $cost = '0.0000'): static
    {
        return $this->state(['price' => $price, 'cost_price' => $cost]);
    }

    public function taxType(TaxType $type): static
    {
        return $this->state(['tax_type' => $type]);
    }
}
