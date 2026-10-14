<?php

namespace App\Http\Resources;

use App\Models\Role;
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
            'permissions' => $this->whenLoaded('permissions', fn () => $this->permissions->pluck('key')->values()),
        ];
    }
}
