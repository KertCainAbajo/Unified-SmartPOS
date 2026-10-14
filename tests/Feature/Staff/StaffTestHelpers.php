<?php

namespace Tests\Feature\Staff;

use App\Models\Branch;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use Illuminate\Testing\TestResponse;

trait StaffTestHelpers
{
    /** Create a company-managed account through the API as $actor. */
    protected function createStaff(Tenant $tenant, User $actor, string $roleKey, array $branches, array $extra = []): TestResponse
    {
        return $this->actingAsUser($actor)->postJson($this->tenantUrl($tenant, 'staff'), [
            'name' => 'Juan Staff',
            'role_ids' => [Role::system($roleKey)->id],
            'branch_ids' => array_map(fn (Branch $b) => $b->id, $branches),
            'delivery' => 'manual',
            ...$extra,
        ]);
    }

    /** Create and activate a company-managed account; returns [membership, username, password]. */
    protected function activeStaff(Tenant $tenant, User $actor, string $roleKey, array $branches, array $extra = []): array
    {
        $response = $this->createStaff($tenant, $actor, $roleKey, $branches, $extra)->assertCreated();
        $username = $response->json('data.username');
        $password = 'Employee123';

        $this->postJson('/api/v1/staff/activate', [
            'business_code' => $tenant->slug,
            'username' => $username,
            'code' => $response->json('activation_code'),
            'password' => $password,
            'password_confirmation' => $password,
        ])->assertOk();

        return [TenantMembership::query()->findOrFail($response->json('data.id')), $username, $password];
    }

    protected function staffLogin(Tenant $tenant, string $username, string $password): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->postJson('/api/v1/auth/login', [
            'business_code' => $tenant->slug,
            'username' => $username,
            'password' => $password,
            'device_name' => 'test',
        ]);
    }

    protected function membershipOf(Tenant $tenant, User $user): TenantMembership
    {
        return TenantMembership::query()->where('tenant_id', $tenant->id)->where('user_id', $user->id)->firstOrFail();
    }
}
