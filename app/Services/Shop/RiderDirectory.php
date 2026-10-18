<?php

namespace App\Services\Shop;

use App\Enums\MembershipStatus;
use App\Enums\OnlineOrderStatus;
use App\Models\TenantMembership;
use App\Models\Tenant;
use App\Support\Permissions;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * Staff who can take a delivery: active members whose role grants `deliveries.ride` and who can work at the order's
 * branch. Owners and managers hold every permission, so they are not listed as riders unless they also carry a
 * rider role of their own.
 */
class RiderDirectory
{
    /** @return Collection<int, array{user_id: int, name: string, phone: ?string, active_deliveries: int, on_duty: bool}> On-duty riders first, least busy first. */
    public function forBranch(Tenant $tenant, int $branchId): Collection
    {
        $members = $this->query($tenant, $branchId)->with('user:id,name,phone')->get();
        $busy = $tenant->onlineOrders()->where('status', OnlineOrderStatus::OutForDelivery->value)->whereNull('delivered_at')
            ->whereIn('rider_user_id', $members->pluck('user_id'))->selectRaw('rider_user_id, count(*) as n')->groupBy('rider_user_id')
            ->pluck('n', 'rider_user_id');

        return $members->map(fn (TenantMembership $m) => [
            'user_id' => (int) $m->user_id,
            'name' => $m->user->name,
            'phone' => $m->user->phone,
            'active_deliveries' => (int) ($busy[$m->user_id] ?? 0),
            'on_duty' => (bool) $m->on_duty,
        ])->sortBy([['on_duty', 'desc'], ['active_deliveries', 'asc'], ['name', 'asc']])->values();
    }

    public function isRider(Tenant $tenant, int $branchId, int $userId): bool
    {
        return $this->query($tenant, $branchId)->where('user_id', $userId)->exists();
    }

    private function query(Tenant $tenant, int $branchId): Builder
    {
        return TenantMembership::query()
            ->where('tenant_id', $tenant->id)
            ->where('status', MembershipStatus::Active->value)
            ->whereHas('roles', fn (Builder $r) => $r
                ->whereNotIn('key', [Permissions::ROLE_OWNER, Permissions::ROLE_MANAGER])
                ->whereHas('permissions', fn (Builder $p) => $p->where('key', Permissions::DELIVERIES_RIDE)))
            ->where(fn (Builder $q) => $q->where('all_branches', true)
                ->orWhereHas('branches', fn (Builder $b) => $b->where('branches.id', $branchId)));
    }
}
