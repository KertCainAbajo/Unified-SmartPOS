<?php

namespace App\Http\Resources;

use App\Models\TenantMembership;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin TenantMembership */
class MembershipResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'tenant_id' => $this->tenant_id,
            'status' => $this->status,
            'all_branches' => $this->all_branches,
            'joined_at' => $this->joined_at,
            'user' => new UserResource($this->whenLoaded('user')),
            'tenant' => $this->whenLoaded('tenant', fn () => [
                'id' => $this->tenant->id,
                'name' => $this->tenant->name,
                'slug' => $this->tenant->slug,
                'status' => $this->tenant->status,
            ]),
            'roles' => RoleResource::collection($this->whenLoaded('roles')),
            'branches' => BranchResource::collection($this->whenLoaded('branches')),
        ];
    }
}
