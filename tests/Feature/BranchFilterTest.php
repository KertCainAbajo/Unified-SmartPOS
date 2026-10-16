<?php

namespace Tests\Feature;

use Tests\Feature\Pos\PosTestHelpers;
use Tests\Feature\Staff\StaffTestHelpers;
use Tests\TestCase;

/** The header branch switcher narrows lists with `branch_id`; omitting it shows every authorized branch. */
class BranchFilterTest extends TestCase
{
    use PosTestHelpers;
    use StaffTestHelpers;

    public function test_staff_filter_keeps_all_branch_members_and_drops_other_branches(): void
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $davao = $this->createBranch($tenant, 'DVO');
        [$mainCashier] = $this->activeStaff($tenant, $owner, 'cashier', [$main]);
        [$davaoCashier] = $this->activeStaff($tenant, $owner, 'cashier', [$davao]);
        $this->actingAsUser($owner);

        $ids = fn (string $query) => array_column($this->getJson($this->tenantUrl($tenant, 'staff'.$query))->assertOk()->json('data'), 'id');
        $ownerMembership = $this->membershipOf($tenant, $owner)->id;

        $this->assertEqualsCanonicalizing([$ownerMembership, $davaoCashier->id], $ids('?branch_id='.$davao->id));
        $this->assertEqualsCanonicalizing([$ownerMembership, $mainCashier->id, $davaoCashier->id], $ids(''));
    }

    public function test_transfer_filter_matches_source_or_destination(): void
    {
        [$tenant, $owner, $main] = $this->createTenant();
        $davao = $this->createBranch($tenant, 'DVO');
        $makati = $this->createBranch($tenant, 'MKT');
        $product = $this->createProduct($tenant);
        $this->setStock($product, $main, '20', '10.0000');
        $this->setStock($product, $makati, '20', '10.0000');
        $this->actingAsUser($owner);

        $create = fn ($from, $to) => $this->postJson($this->tenantUrl($tenant, 'stock-transfers'), [
            'from_branch_id' => $from->id, 'to_branch_id' => $to->id, 'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data.id');
        $toDavao = $create($main, $davao);
        $create($makati, $main);

        $this->getJson($this->tenantUrl($tenant, 'stock-transfers?branch_id='.$davao->id))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $toDavao);
        $this->getJson($this->tenantUrl($tenant, 'stock-transfers?branch_id='.$main->id))->assertOk()->assertJsonCount(2, 'data');
        $this->getJson($this->tenantUrl($tenant, 'stock-transfers'))->assertOk()->assertJsonCount(2, 'data');
    }
}
