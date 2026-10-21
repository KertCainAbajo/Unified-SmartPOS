<?php

namespace App\Console\Commands;

use App\Enums\TaxType;
use App\Models\Category;
use App\Models\Inventory;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Catalog\ProductImageService;
use App\Services\Catalog\ProductService;
use App\Services\Inventory\StockAdjustmentService;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * `php artisan smartpos:import-catalog` — load the product list in database/data/catalog/products.csv (sku, category,
 * name, unit, price) with a photo per product from database/data/catalog/images/<sku>.jpg, list every product in the
 * online shop and give each active branch opening stock. Safe to run again: existing SKUs are not duplicated, and only
 * missing photos and zero-stock branches are filled in.
 */
class ImportCatalog extends Command
{
    protected $signature = 'smartpos:import-catalog
        {--business=aling-nena-mini-mart : Business code (shop address) to import into}
        {--stock=50 : Opening stock per branch for each product (0 = none)}
        {--file= : CSV file (default database/data/catalog/products.csv)}
        {--images= : Photo folder (default database/data/catalog/images)}';

    protected $description = 'Import the product catalogue with photos and opening stock';

    /** Unprocessed farm food is VAT-exempt in the Philippines (rice, vegetables, fruit, raw meat, eggs). */
    private const VAT_EXEMPT_CATEGORIES = ['Fresh Produce & Meat'];

    private const VAT_EXEMPT_SKUS = ['GRC-001', 'GRC-002', 'GRC-003'];

    public function handle(ProductService $products, ProductImageService $images, StockAdjustmentService $stock): int
    {
        $tenant = Tenant::query()->where('slug', $this->option('business'))->first();
        if (! $tenant) {
            $this->error('No business with the code '.$this->option('business').'.');

            return self::FAILURE;
        }
        $owner = $tenant->memberships()->where('user_id', $tenant->owner_user_id)->first();
        if (! $owner) {
            $this->error('The business owner has no membership; cannot record who imported the catalogue.');

            return self::FAILURE;
        }
        app(TenantContext::class)->set($tenant, $owner);

        $file = $this->option('file') ?: database_path('data/catalog/products.csv');
        $folder = $this->option('images') ?: database_path('data/catalog/images');
        $rows = $this->readCsv($file);
        $this->info(sprintf('Importing %d products into %s…', count($rows), $tenant->name));

        $categories = $tenant->categories()->get()->keyBy('name');
        $order = (int) $tenant->categories()->max('sort_order');
        $created = $photos = 0;
        $bar = $this->output->createProgressBar(count($rows));

        foreach ($rows as $row) {
            $category = $categories[$row['category']] ??= $tenant->categories()->create([
                'name' => $row['category'], 'slug' => Str::slug($row['category']), 'sort_order' => ++$order,
            ]);

            $product = Product::query()->where('tenant_id', $tenant->id)->where('sku', $row['sku'])->first();
            if (! $product) {
                $exempt = in_array($row['category'], self::VAT_EXEMPT_CATEGORIES, true) || in_array($row['sku'], self::VAT_EXEMPT_SKUS, true);
                $product = $products->create($tenant, [
                    'category_id' => $category->id,
                    'sku' => $row['sku'],
                    'name' => $row['name'],
                    'unit' => $row['unit'],
                    'price' => $row['price'],
                    'tax_type' => $exempt ? TaxType::VatExempt : TaxType::Vatable,
                    'track_inventory' => true,
                    'allow_decimal_quantity' => $row['unit'] === 'kg',
                    'reorder_level' => 10,
                    'show_online' => true,
                ], $tenant->owner_user_id);
                $created++;
            }

            $photo = $folder.DIRECTORY_SEPARATOR.$row['sku'].'.jpg';
            if ($product->image_path === null && is_file($photo)) {
                $images->store($product, $photo);
                $photos++;
            }
            $bar->advance();
        }
        $bar->finish();
        $this->newLine();

        $stocked = $this->openingStock($tenant, $stock, array_column($rows, 'sku'), (int) $this->option('stock'));
        $this->info("Done: {$created} new products, {$photos} photos, opening stock added at {$stocked} branch(es).");

        return self::SUCCESS;
    }

    /** Give each active branch the opening quantity for products it has none of. */
    private function openingStock(Tenant $tenant, StockAdjustmentService $stock, array $skus, int $quantity): int
    {
        if ($quantity <= 0) {
            return 0;
        }
        $ids = Product::query()->where('tenant_id', $tenant->id)->whereIn('sku', $skus)->pluck('id');
        $branches = 0;
        foreach ($tenant->branches()->where('is_active', true)->get() as $branch) {
            $have = Inventory::query()->where('branch_id', $branch->id)->whereIn('product_id', $ids)->where('quantity', '>', 0)->pluck('product_id')->all();
            $items = $ids->diff($have)->map(fn (int $id) => ['product_id' => $id, 'quantity_change' => (string) $quantity])->values()->all();
            if ($items) {
                $stock->adjust($branch, 'opening', 'Catalogue import', $items, $tenant->owner_user_id);
                $branches++;
            }
        }

        return $branches;
    }

    /** @return list<array{sku: string, category: string, name: string, unit: string, price: string}> */
    private function readCsv(string $file): array
    {
        $handle = fopen($file, 'r');
        $header = fgetcsv($handle, escape: '\\');
        $rows = [];
        while (($line = fgetcsv($handle, escape: '\\')) !== false) {
            if ($line !== [null]) {
                $rows[] = array_combine($header, $line);
            }
        }
        fclose($handle);

        return $rows;
    }
}
