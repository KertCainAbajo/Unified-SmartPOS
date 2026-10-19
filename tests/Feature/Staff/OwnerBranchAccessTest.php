<?php

namespace Tests\Feature\Staff;

use App\Models\Role;
use App\Models\TenantMembership;
use App\Models\User;
use Tests\TestCase;

/** A business owner always works across every branch: switching between them and restocking any of them. */
class OwnerBranchAccessTest extends TestCase
{
    public function test_an_owner_limited_to_one_branch_still_reaches_every_branch(): void
    {
        [$tenant, , $main] = $this->createTenant();
        $second = $this->createBranch($tenant, 'DVO');
        $coOwner = User::factory()->create();
        $membership = TenantMembership::query()->create(['tenant_id' => $tenant->id, 'user_id' => $coOwner->id, 'status' => 'active', 'all_branches' => false, 'joined_at' => now()]);
        $membership->roles()->attach(Role::system('business_owner')->id);
        $membership->branches()->attach($second->id); // an older record limited to one branch

        $branches = collect($this->actingAsUser($coOwner)->getJson("/api/v1/tenants/{$tenant->id}/context")->assertOk()->json('branches'))->pluck('id');
        $this->assertTrue($branches->contains($main->id) && $branches->contains($second->id));
    }

    public function test_giving_someone_the_owner_role_gives_them_every_branch(): void
    {
        [$tenant, $owner] = $this->createTenant();
        $second = $this->createBranch($tenant, 'DVO');
        $staff = $this->addMember($tenant, 'cashier', [$second]);
        $membership = TenantMembership::query()->where('tenant_id', $tenant->id)->where('user_id', $staff->id)->firstOrFail();

        $this->actingAsUser($owner)->postJson($this->tenantUrl($tenant, "staff/{$membership->id}/change-role"), ['role_ids' => [Role::system('business_owner')->id]]);

        $this->assertTrue($membership->fresh()->all_branches);
    }
}
