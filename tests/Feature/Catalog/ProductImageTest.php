<?php

namespace Tests\Feature\Catalog;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ProductImageTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
    }

    public function test_manager_uploads_a_photo_that_is_resized_re_encoded_and_served(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $product = $this->createProduct($tenant);

        $response = $this->actingAsUser($owner)
            ->post($this->tenantUrl($tenant, "products/{$product->id}/image"), ['image' => UploadedFile::fake()->image('soap.png', 2400, 1600)], ['Accept' => 'application/json'])
            ->assertOk();

        $product->refresh();
        $this->assertNotNull($product->image_path);
        Storage::disk('public')->assertExists($product->image_path);
        [$width, $height, $type] = getimagesizefromstring(Storage::disk('public')->get($product->image_path));
        $this->assertSame([900, 600, IMAGETYPE_JPEG], [$width, $height, $type]);
        $this->assertStringStartsWith("/api/v1/tenants/{$tenant->id}/products/{$product->id}/image?v=", $response->json('data.image_url'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'product.image_updated', 'auditable_id' => $product->id]);

        $this->get($response->json('data.image_url'))->assertOk()->assertHeader('Content-Type', 'image/jpeg');
    }

    public function test_replacing_and_removing_a_photo_cleans_up_the_old_file(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $product = $this->createProduct($tenant);
        $url = $this->tenantUrl($tenant, "products/{$product->id}/image");

        $this->actingAsUser($owner)->post($url, ['image' => UploadedFile::fake()->image('a.jpg')], ['Accept' => 'application/json'])->assertOk();
        $first = $product->refresh()->image_path;
        $this->post($url, ['image' => UploadedFile::fake()->image('b.jpg')], ['Accept' => 'application/json'])->assertOk();
        $second = $product->refresh()->image_path;

        $this->assertNotSame($first, $second);
        Storage::disk('public')->assertMissing($first);

        $this->deleteJson($url)->assertOk()->assertJsonPath('data.image_url', null);
        Storage::disk('public')->assertMissing($second);
        $this->getJson($url)->assertNotFound();
    }

    public function test_files_that_are_not_images_are_rejected(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $product = $this->createProduct($tenant);

        $this->actingAsUser($owner)
            ->post($this->tenantUrl($tenant, "products/{$product->id}/image"), ['image' => UploadedFile::fake()->create('menu.pdf', 20, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors('image');
        $this->assertNull($product->refresh()->image_path);
    }

    public function test_staff_without_product_management_cannot_change_photos(): void
    {
        [$tenant] = $this->createTenant();
        $product = $this->createProduct($tenant);
        $cashier = $this->addMember($tenant, 'cashier');

        $this->actingAsUser($cashier)
            ->post($this->tenantUrl($tenant, "products/{$product->id}/image"), ['image' => UploadedFile::fake()->image('a.jpg')], ['Accept' => 'application/json'])
            ->assertForbidden();
    }

    public function test_another_business_cannot_read_the_photo(): void
    {
        [$tenant, $owner] = $this->createTenant();
        [$otherTenant, $otherOwner] = $this->createTenant();
        $product = $this->createProduct($tenant);
        $this->actingAsUser($owner)->post($this->tenantUrl($tenant, "products/{$product->id}/image"), ['image' => UploadedFile::fake()->image('a.jpg')], ['Accept' => 'application/json'])->assertOk();

        $this->actingAsUser($otherOwner)->getJson($this->tenantUrl($otherTenant, "products/{$product->id}/image"))->assertNotFound();
    }
}
