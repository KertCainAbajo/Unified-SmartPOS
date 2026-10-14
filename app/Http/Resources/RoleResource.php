<?php

namespace App\Http\Resources;

use App\Models\Role;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Role */
class RoleResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'key' => $this->key,
            'name' => $this->name,
            'description' => $this->description,
            'is_system' => $this->is_system,
            // Staff holding this role sign in with email instead of username / employee ID.
            'requires_email_sign_in' => $this->requiresEmailSignIn(),
            // Whether the signed-in user may give this role to staff (administrative roles are owner-only).
            'assignable' => $this->assignable(),
            'permissions' => $this->whenLoaded('permissions', fn () => $this->permissions->pluck('key')->values()),
        ];
    }

    private function assignable(): ?bool
    {
        $context = app(TenantContext::class);
        if (! $context->hasTenant()) {
            return null;
        }

        return $context->tenant()->owner_user_id === auth()->id() || ! $this->isAdministrative();
    }
}
