<?php

namespace Tests\Feature\Shop;

use App\Models\CustomerAccount;
use App\Services\Catalog\ProductImageService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class CustomerShopTest extends TestCase
{
    public function test_catalog_lists_online_products_with_their_photos(): void
    {
        Storage::fake('public');
        [$tenant] = $this->createTenant();
        $listed = $this->createProduct($tenant, ['name' => 'Bath Soap']);
        $hidden = $this->createProduct($tenant, ['name' => 'Back Room Item', 'show_online' => false]);
        app(ProductImageService::class)->store($listed, UploadedFile::fake()->image('soap.jpg'));
        app(ProductImageService::class)->store($hidden, UploadedFile::fake()->image('hidden.jpg'));

        $response = $this->getJson("/api/v1/shop/{$tenant->slug}")->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Bath Soap');

        $this->get($response->json('data.0.image_url'))->assertOk()->assertHeader('Content-Type', 'image/jpeg');
        $this->get("/api/v1/shop/{$tenant->slug}/products/{$hidden->id}/image")->assertNotFound();
    }

    /** Customers cannot order more than the chosen branch has in stock. */
    public function test_orders_are_limited_to_the_branch_stock(): void
    {
        [$tenant, , $branch] = $this->createTenant();
        $product = $this->createProduct($tenant, ['name' => 'Bath Soap']);
        $customer = CustomerAccount::query()->forceCreate(['tenant_id' => $tenant->id, 'name' => 'Ana', 'email' => 'ana@example.com', 'phone' => '0917', 'password' => 'long-password-1']);
        $order = fn (string $qty) => $this->actingAs($customer, 'customer')->postJson("/api/v1/shop/{$tenant->slug}/orders", [
            'branch_id' => $branch->id, 'contact_name' => 'Ana', 'contact_phone' => '0917', 'items' => [['product_id' => $product->id, 'quantity' => $qty]],
        ]);

        $order('1')->assertUnprocessable()->assertJsonPath('errors.items.0', fn ($m) => str_contains($m, 'out of stock'));
        $this->setStock($product, $branch, '3');
        $order('5')->assertUnprocessable()->assertJsonPath('errors.items.0', fn ($m) => str_contains($m, 'Only 3'));
        $order('3')->assertCreated();
    }

    public function test_customer_order_reaches_the_staff_queue_and_staff_can_confirm_it(): void
    {
        [$tenant, $owner, $branch] = $this->createTenant();
        $product = $this->createProduct($tenant, ['name' => 'Bath Soap']);
        $this->setStock($product, $branch, '20');

        $this->withHeaders(['Origin' => 'http://localhost', 'Referer' => 'http://localhost/'])->postJson("/api/v1/shop/{$tenant->slug}/register", [
            'name' => 'Ana Reyes', 'email' => 'ana@example.com', 'phone' => '09171234567',
            'password' => 'long-password-1', 'password_confirmation' => 'long-password-1', 'accept_terms' => true,
        ])->assertStatus(202);
        $account = CustomerAccount::query()->where('email', 'ana@example.com')->firstOrFail();
        $account->forceFill(['status' => 'active', 'email_verified_at' => now()])->save(); // the code step is covered in CustomerEmailVerificationTest

        $order = $this->actingAs($account, 'customer')->postJson("/api/v1/shop/{$tenant->slug}/orders", [
            'branch_id' => $branch->id, 'contact_name' => 'Ana Reyes', 'contact_phone' => '09171234567',
            'items' => [['product_id' => $product->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');

        $this->actingAsUser($owner)->getJson($this->tenantUrl($tenant, 'online-orders'))
            ->assertOk()->assertJsonPath('data.0.order_number', $order['order_number']);
        $this->postJson($this->tenantUrl($tenant, "online-orders/{$order['id']}/status"), ['status' => 'confirmed'])
            ->assertOk()->assertJsonPath('data.status', 'confirmed');
    }
}
