<?php

namespace Tests\Feature\Platform;

use App\Models\User;
use Tests\TestCase;

/** Super admin console: overview, business detail, account lookup, platform admins and the activity log. */
class PlatformConsoleTest extends TestCase
{
    private function admin(): User
    {
        $admin = User::factory()->create(['name' => 'Platform Admin']);
        $admin->forceFill(['is_platform_admin' => true])->save();

        return $admin;
    }

    public function test_overview_and_business_detail_show_account_facts_only(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $this->addMember($tenant, 'cashier');
        $this->actingAsUser($this->admin());

        $this->getJson('/api/v1/platform/overview')->assertOk()
            ->assertJsonPath('businesses.total', 1)->assertJsonPath('platform_admins', 1)
            ->assertJsonPath('newest.0.name', $tenant->name);

        $detail = $this->getJson("/api/v1/platform/tenants/{$tenant->id}")->assertOk()
            ->assertJsonPath('data.owner.email', $owner->email)->assertJsonPath('data.people.active', 2)->json('data');
        $this->assertCount(1, $detail['branches']);
        // No sales, products or other transactions are part of the console.
        foreach (['sales', 'products', 'payments', 'customers'] as $key) {
            $this->assertArrayNotHasKey($key, $detail);
        }
    }

    public function test_admin_disables_and_reenables_an_account_with_a_reason(): void
    {
        [$tenant] = $this->createTenant();
        $cashier = $this->addMember($tenant, 'cashier');
        $admin = $this->admin();

        $this->actingAsUser($admin)->getJson('/api/v1/platform/users?q='.urlencode($cashier->name))->assertOk()
            ->assertJsonPath('data.0.id', $cashier->id)->assertJsonPath('data.0.businesses.0.name', $tenant->name);

        $this->patchJson("/api/v1/platform/users/{$cashier->id}/status", ['status' => 'disabled', 'reason' => 'Reported stolen phone'])
            ->assertOk()->assertJsonPath('data.status', 'disabled');
        $this->actingAsUser($cashier->fresh())->getJson($this->tenantUrl($tenant))->assertUnauthorized();

        $this->actingAsUser($admin)->patchJson("/api/v1/platform/users/{$cashier->id}/status", ['status' => 'active', 'reason' => 'Phone recovered'])->assertOk();
        $this->assertDatabaseHas('audit_logs', ['action' => 'platform.user_status_changed', 'auditable_id' => $cashier->id, 'user_id' => $admin->id]);

        // An administrator cannot lock themselves out.
        $this->patchJson("/api/v1/platform/users/{$admin->id}/status", ['status' => 'disabled', 'reason' => 'x'])->assertStatus(409);
    }

    public function test_platform_admins_are_granted_and_removed_but_never_the_last_one(): void
    {
        $admin = $this->admin();
        $other = User::factory()->create();

        $this->actingAsUser($admin)->patchJson("/api/v1/platform/users/{$admin->id}/admin", ['is_platform_admin' => false, 'reason' => 'x'])
            ->assertStatus(409);
        $this->patchJson("/api/v1/platform/users/{$other->id}/admin", ['is_platform_admin' => true, 'reason' => 'New support lead'])
            ->assertOk()->assertJsonPath('data.is_platform_admin', true);
        $this->patchJson("/api/v1/platform/users/{$other->id}/admin", ['is_platform_admin' => false, 'reason' => 'Left the team'])
            ->assertOk()->assertJsonPath('data.is_platform_admin', false);

        $actions = array_column($this->getJson('/api/v1/platform/activity')->assertOk()->json('data'), 'action');
        $this->assertSame(['platform.admin_revoked', 'platform.admin_granted'], $actions);
    }

    /** A login created by a business becomes a personal account when made an admin, so the business cannot reset it. */
    public function test_company_managed_login_is_made_personal_when_granted_admin(): void
    {
        [$tenant] = $this->createTenant();
        $manager = $this->addMember($tenant, 'branch_manager');
        $manager->forceFill(['managed_by_tenant_id' => $tenant->id])->save();

        $this->actingAsUser($this->admin())->patchJson("/api/v1/platform/users/{$manager->id}/admin", ['is_platform_admin' => true, 'reason' => 'Runs the platform'])
            ->assertOk()->assertJsonPath('data.is_platform_admin', true)->assertJsonPath('data.company_managed', false);
        $this->assertNull($manager->fresh()->managed_by_tenant_id);
        $this->assertDatabaseHas('tenant_memberships', ['tenant_id' => $tenant->id, 'user_id' => $manager->id, 'status' => 'active']);
    }

    /** Someone who signed up in an online shop is found by exact email and made admin; they sign in with the same password. */
    public function test_shop_customer_becomes_platform_admin_with_their_shop_password(): void
    {
        [$tenant] = $this->createTenant();
        $customer = \App\Models\CustomerAccount::query()->forceCreate([
            'tenant_id' => $tenant->id, 'name' => 'Lea Cruz', 'email' => 'lea@example.com', 'phone' => '0917', 'password' => 'shop-password-1',
        ]);
        $admin = $this->admin();

        $this->actingAsUser($admin)->getJson('/api/v1/platform/customer-lookup?email=lea@example.com')->assertOk()
            ->assertJsonPath('data.0.id', $customer->id)->assertJsonPath('data.0.shop', $tenant->name)->assertJsonPath('login', null);
        // Partial emails never list customers.
        $this->getJson('/api/v1/platform/customer-lookup?email=lea')->assertUnprocessable();

        $this->postJson("/api/v1/platform/customer-accounts/{$customer->id}/make-admin", ['reason' => 'New platform partner'])
            ->assertOk()->assertJsonPath('login_created', true)->assertJsonPath('data.is_platform_admin', true);

        $user = User::query()->where('email', 'lea@example.com')->firstOrFail();
        $this->assertTrue($user->is_platform_admin);
        $this->assertTrue(\Illuminate\Support\Facades\Hash::check('shop-password-1', $user->password));
        $this->assertSame('moved_to_admin', $customer->fresh()->status, 'The shop account moved to the console.');

        // The email no longer signs in to the shop, and cannot sign up again as a customer.
        $this->postJson("/api/v1/shop/{$tenant->slug}/login", ['email' => 'lea@example.com', 'password' => 'shop-password-1'])
            ->assertUnprocessable()->assertJsonPath('code', 'MOVED_TO_ADMIN');
        $this->postJson("/api/v1/shop/{$tenant->slug}/register", ['name' => 'Lea', 'email' => 'lea@example.com', 'phone' => '0917', 'password' => 'shop-password-2', 'password_confirmation' => 'shop-password-2'])
            ->assertUnprocessable()->assertJsonValidationErrors('email');
    }

    /** An existing login with the same email becomes the admin and takes the shop password. */
    public function test_existing_login_takes_the_shop_password_when_moved(): void
    {
        [$tenant] = $this->createTenant();
        $staff = $this->addMember($tenant, 'branch_manager');
        $staff->forceFill(['password' => 'old-Staff-pass-1'])->save();
        $customer = \App\Models\CustomerAccount::query()->forceCreate([
            'tenant_id' => $tenant->id, 'name' => 'Same Person', 'email' => $staff->email, 'phone' => '0917', 'password' => 'Shop-pass-99',
        ]);

        $this->actingAsUser($this->admin())->postJson("/api/v1/platform/customer-accounts/{$customer->id}/make-admin", ['reason' => 'Moving to the console'])
            ->assertOk()->assertJsonPath('login_created', false);
        $staff->refresh();
        $this->assertTrue($staff->is_platform_admin);
        $this->assertTrue(\Illuminate\Support\Facades\Hash::check('Shop-pass-99', $staff->password));
        $this->assertFalse(\Illuminate\Support\Facades\Hash::check('old-Staff-pass-1', $staff->password));
    }

    /** An email that is a platform admin cannot keep shopping, however it became admin; a signed-in shopper is signed out. */
    public function test_admin_email_is_signed_out_of_the_shop_and_its_shop_account_closed(): void
    {
        [$tenant] = $this->createTenant();
        $person = User::factory()->create(['email' => 'boss@example.com']);
        $customer = \App\Models\CustomerAccount::query()->forceCreate([
            'tenant_id' => $tenant->id, 'name' => 'Boss', 'email' => 'boss@example.com', 'phone' => '0917', 'password' => 'Shop-pass-99',
        ]);
        $person->forceFill(['is_platform_admin' => true])->save(); // made admin some other way, shop account still open

        $this->actingAs($customer, 'customer')->getJson("/api/v1/shop/{$tenant->slug}/me")
            ->assertForbidden()->assertJsonPath('code', 'MOVED_TO_ADMIN');
        $this->assertSame('moved_to_admin', $customer->fresh()->status);

        // Granting admin from the account list closes the shop accounts straight away.
        $other = User::factory()->create(['email' => 'lead@example.com']);
        $shopper = \App\Models\CustomerAccount::query()->forceCreate([
            'tenant_id' => $tenant->id, 'name' => 'Lead', 'email' => 'lead@example.com', 'phone' => '0918', 'password' => 'Shop-pass-98',
        ]);
        $this->actingAsUser($this->admin())->patchJson("/api/v1/platform/users/{$other->id}/admin", ['is_platform_admin' => true, 'reason' => 'Support lead'])->assertOk();
        $this->assertSame('moved_to_admin', $shopper->fresh()->status);
    }

    public function test_console_is_closed_to_business_owners(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $this->actingAsUser($owner);
        foreach (['overview', "tenants/{$tenant->id}", 'users', 'activity'] as $path) {
            $this->getJson("/api/v1/platform/{$path}")->assertForbidden();
        }
        $this->patchJson("/api/v1/platform/users/{$owner->id}/admin", ['is_platform_admin' => true, 'reason' => 'x'])->assertForbidden();
    }
}
