<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Requires an active membership in the {tenant} route parameter and loads it into TenantContext.
 *
 * Platform administrators receive no bypass: they need a membership like everyone else.
 * Non-members get 404 so that tenant IDs cannot be enumerated.
 */
class ResolveTenant
{
    public function __construct(private readonly TenantContext $context) {}

    public function handle(Request $request, Closure $next): Response
    {
        $tenant = $request->route('tenant');

        if (! $tenant instanceof Tenant) {
            $tenant = Tenant::query()->find($tenant);
        }

        $membership = $tenant ? $request->user()?->activeMembershipFor($tenant->id) : null;

        if ($tenant === null || $membership === null) {
            return response()->json(['message' => 'Business not found.'], 404);
        }

        if (! $tenant->isActive()) {
            return response()->json([
                'message' => 'This business account is suspended.',
                'code' => 'TENANT_SUSPENDED',
            ], 403);
        }

        $membership->setRelation('tenant', $tenant);
        $this->context->set($tenant, $membership);

        return $next($request);
    }
}
