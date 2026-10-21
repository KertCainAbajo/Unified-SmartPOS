<?php

namespace Tests\Feature\Catalog;

use App\Enums\TaxType;
use App\Models\Inventory;
use App\Models\Product;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ImportCatalogTest extends TestCase
{
    public function test_catalogue_import_creates_products_photos_and_opening_stock_and_can_run_again(): void
    {
        Storage::fake('public');
        [$tenant, , $main] = $this->createTenant();
        $dir = sys_get_temp_dir().'/catalog-'.uniqid();
        mkdir($dir.'/images', 0777, true);
        file_put_contents($dir.'/products.csv', "sku,category,name,unit,price\nGRC-001,Grocery & Pantry,Sinandomeng Rice,kg,55.00\nFRS-004,Fresh Produce & Meat,Tomato,kg,80.00\nBEV-008,Beverages,C2 Green Tea,bottle,25.00\n");
        $img = imagecreatetruecolor(40, 40);
        imagejpeg($img, $dir.'/images/BEV-008.jpg');

        $args = ['--business' => $tenant->slug, '--file' => $dir.'/products.csv', '--images' => $dir.'/images', '--stock' => 30];
        $this->artisan('smartpos:import-catalog', $args)->assertSuccessful();
        $this->artisan('smartpos:import-catalog', $args)->assertSuccessful();

        $this->assertSame(3, Product::query()->where('tenant_id', $tenant->id)->count());
        $this->assertSame(3, $tenant->categories()->count());
        $rice = Product::query()->where('sku', 'GRC-001')->firstOrFail();
        $this->assertSame('55.00', (string) $rice->price);
        $this->assertSame(TaxType::VatExempt, $rice->tax_type);
        $this->assertTrue((bool) $rice->allow_decimal_quantity);
        $this->assertTrue((bool) $rice->show_online);
        $this->assertSame(TaxType::VatExempt, Product::query()->where('sku', 'FRS-004')->value('tax_type'));
        $tea = Product::query()->where('sku', 'BEV-008')->firstOrFail();
        $this->assertSame(TaxType::Vatable, $tea->tax_type);
        $this->assertNotNull($tea->image_path);
        Storage::disk('public')->assertExists($tea->image_path);
        // Opening stock once per branch, not doubled by the second run.
        $this->assertEquals(30, (float) Inventory::query()->where('branch_id', $main->id)->where('product_id', $tea->id)->value('quantity'));
    }
}
