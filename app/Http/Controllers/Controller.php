<?php

namespace App\Http\Controllers;

use App\Support\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Auth\Access\AuthorizesRequests;
use Illuminate\Http\Request;

abstract class Controller
{
    use AuthorizesRequests;

    protected function tenantContext(): TenantContext
    {
        return app(TenantContext::class);
    }

    /** Requested page size, bounded by config('smartpos.max_per_page'). */
    protected function perPage(Request $request, int $default = 25): int
    {
        return max(1, min((int) $request->integer('per_page', $default), (int) config('smartpos.max_per_page')));
    }

    /** Require a permission and access to a specific branch of the current tenant. */
    protected function authorizeAtBranch(string $permission, int|string|null $branchId): void
    {
        $context = $this->tenantContext();

        if (! $context->can($permission) || ! $context->canAccessBranch($branchId)) {
            throw new AuthorizationException('This action is unauthorized.');
        }
    }

    protected function authorizePermission(string $permission): void
    {
        $this->authorize('tenant-permission', [$permission]);
    }

    /**
     * Restrict a query to branches the caller may access.
     *
     * @template TBuilder of \Illuminate\Database\Eloquent\Builder|\Illuminate\Database\Query\Builder
     *
     * @param  TBuilder  $query
     * @return TBuilder
     */
    protected function scopeToAccessibleBranches($query, string $column = 'branch_id')
    {
        $branchIds = $this->tenantContext()->branchIds();

        return $branchIds === null ? $query : $query->whereIn($column, $branchIds);
    }
}
