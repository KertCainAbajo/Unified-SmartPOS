<?php

namespace App\Services;

use App\Models\AppNotification;
use App\Models\TenantMembership;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/** Creates in-app notifications for members who hold a permission at a branch. */
class NotificationService
{
    /**
     * @param  array<string, mixed>  $data
     */
    public function notifyPermissionHolders(
        int $tenantId,
        ?int $branchId,
        string $permission,
        string $type,
        string $title,
        ?string $body = null,
        array $data = [],
        ?int $exceptUserId = null,
    ): int {
        $userIds = TenantMembership::query()
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereHas('roles.permissions', fn (Builder $q) => $q->where('key', $permission))
            ->when($branchId !== null, fn (Builder $q) => $q->where(fn (Builder $q) => $q
                ->where('all_branches', true)
                ->orWhereHas('branches', fn (Builder $b) => $b->where('branches.id', $branchId))))
            ->when($exceptUserId !== null, fn (Builder $q) => $q->where('user_id', '!=', $exceptUserId))
            ->pluck('user_id');

        $now = now();
        $rows = $userIds->map(fn ($userId) => [
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'type' => $type,
            'title' => $title,
            'body' => $body,
            'data' => json_encode($data),
            'created_at' => $now,
        ])->all();

        if ($rows !== []) {
            AppNotification::query()->insert($rows);
        }

        return count($rows);
    }

    /** Defer notification creation until the surrounding transaction commits. */
    public function afterCommit(callable $callback): void
    {
        DB::afterCommit($callback);
    }
}
