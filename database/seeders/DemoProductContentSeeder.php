<?php

namespace Database\Seeders;

use App\Models\Product;
use App\Services\Catalog\ProductImageService;
use Illuminate\Database\Seeder;

/**
 * Gives the demo products real photos (see demo-images/CREDITS.md) and short shop descriptions. Matches by SKU and
 * never replaces a photo or description someone already set, so it is safe to run on an existing database:
 * php artisan db:seed --class=DemoProductContentSeeder
 */
class DemoProductContentSeeder extends Seeder
{
    /** @var array<string, string> */
    public const DESCRIPTIONS = [
        'BEV-COKE-1L' => 'Classic cola in a 1-litre bottle.',
        'BEV-WATER-500' => 'Purified drinking water, 500 ml bottle.',
        'BEV-COFFEE-3IN1' => 'Coffee, creamer and sugar in one sachet.',
        'SNK-CHIPS-60' => 'Crispy plain salted potato chips.',
        'SNK-CRACKERS' => 'Crunchy crackers, 10 packs per bundle.',
        'CAN-SARDINES-155' => 'Sardines in tomato sauce, 155 g can.',
        'CAN-CORNEDBEEF-150' => 'Corned beef in a 150 g can.',
        'RICE-DINORADO' => 'Fragrant Dinorado rice, sold per kilo.',
        'RICE-WELLMILLED' => 'Everyday well-milled rice, sold per kilo.',
        'HH-DETERGENT-1KG' => 'Laundry powder for everyday washing.',
        'HH-DISHWASH-250' => 'Dishwashing liquid, 250 ml bottle.',
        'PC-SHAMPOO-SACHET' => 'Single-use shampoo sachet.',
        'PC-SOAP-90' => 'Everyday bath soap, 90 g bar.',
        'PC-TOOTHPASTE-150' => 'Toothpaste for everyday brushing.',
    ];

    public function run(ProductImageService $images): void
    {
        $folder = database_path('seeders/demo-images');
        $photos = 0;
        $descriptions = 0;

        Product::query()->whereIn('sku', array_keys(self::DESCRIPTIONS))->orderBy('id')->each(function (Product $product) use ($images, $folder, &$photos, &$descriptions) {
            if (blank($product->description)) {
                $product->forceFill(['description' => self::DESCRIPTIONS[$product->sku]])->save();
                $descriptions++;
            }
            $file = $folder.DIRECTORY_SEPARATOR.$product->sku.'.jpg';
            if ($product->image_path === null && is_file($file)) {
                $images->store($product, $file);
                $photos++;
            }
        });

        $this->command?->info("Added {$photos} demo product photos and {$descriptions} descriptions.");
    }
}
