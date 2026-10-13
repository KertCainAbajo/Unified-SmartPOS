<?php

namespace Tests\Feature\Catalog;

use App\Models\Category;
use App\Models\Product;
use Tests\TestCase;

class ProductTest extends TestCase
{
    private function payload(array $overrides = []): array
    {
        return [
            'sku' => 'coke-330',
            'barcode' => '4800888111111',
            'name' => 'Coke 330ml',
            'price' => '25.00',
            'cost_price' => '18.5000',
            'reorder_level' => 12,
            ...$overrides,
        ];
    }

    public function test_owner_creates_product_with_normalized_sku_and_initial_price_history(): void
    {
        [$tenant, $owner] = $this->createTenant();

        $response = $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, 'products'), $this->payload())
            ->assertCreated()
            ->assertJsonPath('data.sku', 'COKE-330')
            ->assertJsonPath('data.price', '25.00')
            ->assertJsonPath('data.cost_price', '18.5000')
            ->assertJsonPath('data.tax_type', 'vatable');

        $product = Product::query()->findOrFail($response->json('data.id'));
        $this->assertSame($tenant->id, $product->tenant_id);
        $this->assertDatabaseHas('price_history', ['product_id' => $product->id, 'old_price' => null, 'new_price' => '25.00']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'product.created', 'auditable_id' => $product->id]);
    }

    public function test_sku_and_barcode_are_unique_per_tenant_but_reusable_across_tenants(): void
    {
        [$tenantA, $ownerA] = $this->createTenant();
        [$tenantB, $ownerB] = $this->createTenant();

        $this->actingAsUser($ownerA)->postJson($this->tenantUrl($tenantA, 'products'), $this->payload())->assertCreated();

        $this->postJson($this->tenantUrl($tenantA, 'products'), $this->payload(['sku' => 'COKE-330', 'name' => 'Dup']))
            ->assertUnprocessable()->assertJsonValidationErrors(['sku', 'barcode']);

        $this->actingAsUser($ownerB)->postJson($this->tenantUrl($tenantB, 'products'), $this->payload())->assertCreated();
    }

    public function test_barcode_check_digit_and_sku_format_are_validated(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $this->actingAsUser($owner);

        $this->postJson($this->tenantUrl($tenant, 'products'), $this->payload(['barcode' => '4800888111110']))
            ->assertUnprocessable()->assertJsonValidationErrors('barcode');
        $this->postJson($this->tenantUrl($tenant, 'products'), $this->payload(['sku' => 'bad sku!']))
            ->assertUnprocessable()->assertJsonValidationErrors('sku');
        $this->postJson($this->tenantUrl($tenant, 'products'), $this->payload(['price' => '-1', 'sku' => 'X1', 'barcode' => null]))
            ->assertUnprocessable()->assertJsonValidationErrors('price');
        $this->postJson($this->tenantUrl($tenant, 'products'), $this->payload(['price' => '10.999', 'sku' => 'X2', 'barcode' => null]))
            ->assertUnprocessable()->assertJsonValidationErrors('price');
        // Internal non-GTIN code is accepted.
        $this->postJson($this->tenantUrl($tenant, 'products'), $this->payload(['barcode' => 'INT-0001', 'sku' => 'X3']))
            ->assertCreated();
    }

    public function test_category_must_belong_to_the_same_tenant(): void
    {
        [$tenantA, $ownerA] = $this->createTenant();
        [$tenantB] = $this->createTenant();
        $foreign = Category::factory()->create(['tenant_id' => $tenantB->id]);

        $this->actingAsUser($ownerA)->postJson($this->tenantUrl($tenantA, 'products'), $this->payload(['category_id' => $foreign->id]))
            ->assertUnprocessable()->assertJsonValidationErrors('category_id');
    }

    public function test_price_changes_use_dedicated_endpoint_and_record_history(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $product = $this->createProduct($tenant, ['price' => '100.00', 'cost_price' => '60.0000']);
        $this->actingAsUser($owner);

        $this->patchJson($this->tenantUrl($tenant, "products/{$product->id}"), ['price' => '1.00'])
            ->assertUnprocessable()->assertJsonValidationErrors('price');

        $this->patchJson($this->tenantUrl($tenant, "products/{$product->id}/price"), ['price' => '110.00', 'reason' => 'Supplier increase'])
            ->assertOk()->assertJsonPath('data.price', '110.00');

        $this->assertDatabaseHas('price_history', [
            'product_id' => $product->id, 'old_price' => '100.00', 'new_price' => '110.00', 'reason' => 'Supplier increase', 'changed_by' => $owner->id,
        ]);
        $this->getJson($this->tenantUrl($tenant, "products/{$product->id}/price-history"))
            ->assertOk()->assertJsonPath('data.0.new_price', '110.00');
    }

    public function test_cashier_can_view_but_not_manage_products_or_prices_and_cannot_see_cost(): void
    {
        [$tenant] = $this->createTenant();
        $product = $this->createProduct($tenant);
        $cashier = $this->addMember($tenant, 'cashier');
        $this->actingAsUser($cashier);

        $this->getJson($this->tenantUrl($tenant, "products/{$product->id}"))->assertOk()->assertJsonMissingPath('data.cost_price');
        $this->postJson($this->tenantUrl($tenant, 'products'), $this->payload())->assertForbidden();
        $this->patchJson($this->tenantUrl($tenant, "products/{$product->id}"), ['name' => 'X'])->assertForbidden();
        $this->patchJson($this->tenantUrl($tenant, "products/{$product->id}/price"), ['price' => '1.00'])->assertForbidden();
        $this->postJson($this->tenantUrl($tenant, "products/{$product->id}/archive"))->assertForbidden();
    }

    public function test_search_pagination_and_archival(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $this->createProduct($tenant, ['name' => 'Lucky Me Pancit Canton', 'sku' => 'LM-001']);
        $this->createProduct($tenant, ['name' => 'Bear Brand Milk', 'sku' => 'BB-001', 'barcode' => '4800361000017']);
        $archived = $this->createProduct($tenant, ['name' => 'Lucky Me Beef', 'sku' => 'LM-002']);
        $this->actingAsUser($owner);

        $this->postJson($this->tenantUrl($tenant, "products/{$archived->id}/archive"))->assertOk()->assertJsonPath('data.status', 'archived');

        $this->getJson($this->tenantUrl($tenant, 'products?q=lucky'))->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.sku', 'LM-001');
        $this->getJson($this->tenantUrl($tenant, 'products?barcode=4800361000017'))->assertJsonPath('data.0.sku', 'BB-001');
        $this->getJson($this->tenantUrl($tenant, 'products?status=archived'))->assertJsonCount(1, 'data');
        $this->getJson($this->tenantUrl($tenant, 'products?per_page=1&status=all'))
            ->assertJsonCount(1, 'data')->assertJsonPath('meta.total', 3)->assertJsonPath('meta.last_page', 3);

        $this->postJson($this->tenantUrl($tenant, "products/{$archived->id}/restore"))->assertOk()->assertJsonPath('data.status', 'active');
    }

    public function test_category_crud_and_in_use_protection(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $this->actingAsUser($owner);

        $id = $this->postJson($this->tenantUrl($tenant, 'categories'), ['name' => 'Beverages'])
            ->assertCreated()->assertJsonPath('data.slug', 'beverages')->json('data.id');
        $this->postJson($this->tenantUrl($tenant, 'categories'), ['name' => 'Beverages'])->assertUnprocessable();

        $this->createProduct($tenant, ['category_id' => $id]);
        $this->deleteJson($this->tenantUrl($tenant, "categories/{$id}"))->assertUnprocessable()->assertJsonPath('code', 'CATEGORY_IN_USE');
        $this->patchJson($this->tenantUrl($tenant, "categories/{$id}"), ['is_active' => false])->assertOk()->assertJsonPath('data.is_active', false);
    }
}
