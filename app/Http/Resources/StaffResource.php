<?php

namespace App\Http\Resources;

use App\Enums\MembershipStatus;
use App\Models\StaffInvitation;
use App\Models\TenantMembership;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Arr;

/**
 * A staff member as seen by staff administrators of one business.
 *
 * @mixin TenantMembership
 */
class StaffResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $user = $this->user;
        $managed = $user->managed_by_tenant_id === $this->tenant_id;
        // A personal account that has not accepted yet: reveal nothing beyond what the inviter typed.
        $pendingPersonal = ! $managed && $this->status === MembershipStatus::Invited->value;
        $invitation = $this->whenLoaded('invitations', fn () => $this->invitations
            ->first(fn (StaffInvitation $i) => $i->used_at === null && $i->revoked_at === null));

        return [
            'id' => $this->id,
            'user_id' => $user->id,
            'account_type' => $managed ? 'company_managed' : 'personal',
            'name' => $pendingPersonal ? null : $user->name,
            'username' => $managed ? $user->username : null,
            // How this person signs in: `username` (username or employee ID + password) or `email`.
            'sign_in_with' => $managed && ! $this->requiresEmailSignIn() ? 'username' : 'email',
            'email' => $user->email,
            'employee_code' => $this->employee_code,
            'status' => $this->status,
            'user_status' => $managed ? $user->status : null,
            'status_reason' => $this->status_reason,
            'all_branches' => $this->all_branches,
            'branches' => BranchResource::collection($this->whenLoaded('branches')),
            'roles' => RoleResource::collection($this->whenLoaded('roles')),
            'pending_code' => $invitation instanceof StaffInvitation ? [
                'purpose' => $invitation->purpose,
                'channel' => $invitation->channel,
                'expires_at' => $invitation->expires_at,
                'expired' => $invitation->expires_at->isPast(),
            ] : null,
            'joined_at' => $this->joined_at,
            'suspended_at' => $this->suspended_at,
            'offboarded_at' => $this->offboarded_at,
            'last_login_at' => $pendingPersonal ? null : $user->last_login_at,
            'must_change_password' => $managed ? (bool) $user->must_change_password : null,
            // Personal data: only staff administrators (staff.update) and the employee themselves.
            'profile' => $this->when($this->canSeeProfile($request), fn () => $this->profile ? Arr::only($this->profile->toArray(), [
                'job_title', 'hire_date', 'phone', 'address', 'birth_date', 'emergency_contact_name', 'emergency_contact_phone', 'notes',
            ]) : null),
            'created_at' => $this->created_at,
        ];
    }

    private function canSeeProfile(Request $request): bool
    {
        $context = app(TenantContext::class);

        return $request->user()?->id === $this->user_id || ($context->hasTenant() && $context->can(Permissions::STAFF_UPDATE));
    }
}
