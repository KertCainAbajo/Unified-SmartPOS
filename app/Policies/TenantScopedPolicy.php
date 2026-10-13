<?php

namespace App\Policies;

use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Model;

/**
 * Base for policies on tenant-owned models.
 *
 * Every check requires (1) a resolved tenant context, (2) that the model belongs to that tenant,
 * (3) the permission, and where relevant (4) access to the model's branch.
 */
abstract class TenantScopedPolicy
{
    protected function context(): TenantContext
    {
        return app(TenantContext::class);
    }

    protected function allows(string $permission): bool
    {
        $context = $this->context();

        return $context->hasTenant() && $context->can($permission);
    }

    protected function owns(Model $model): bool
    {
        $context = $this->context();

        return $context->hasTenant() && (int) $model->getAttribute('tenant_id') === $context->tenantId();
    }

    protected function allowsFor(Model $model, string $permission): bool
    {
        return $this->owns($model) && $this->allows($permission);
    }

    protected function allowsAtBranch(Model $model, string $permission, string $branchColumn = 'branch_id'): bool
    {
        return $this->allowsFor($model, $permission)
            && $this->context()->canAccessBranch($model->getAttribute($branchColumn));
    }
}
