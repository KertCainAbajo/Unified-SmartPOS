<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Enums\MembershipStatus;
use App\Http\Controllers\Controller;
use App\Http\Resources\MembershipResource;
use App\Http\Resources\UserResource;
use App\Models\TenantMembership;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * @tags Profile
 */
class ProfileController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** Current user. */
    public function show(Request $request): UserResource
    {
        return new UserResource($request->user());
    }

    /**
     * Update profile. Changing the email marks it unverified and sends a new verification link.
     */
    public function update(Request $request): UserResource
    {
        $user = $request->user();
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'email' => ['sometimes', 'required', 'email:rfc', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
        ]);

        if (isset($data['email'])) {
            $data['email'] = mb_strtolower(trim($data['email']));
        }

        $original = $user->getOriginal();
        $user->fill($data);
        $emailChanged = $user->isDirty('email');
        if ($emailChanged) {
            $user->email_verified_at = null;
        }
        $user->save();

        if ($emailChanged) {
            $user->sendEmailVerificationNotification();
        }

        $this->audit->logChanges('user.profile_updated', $user, $original);

        return new UserResource($user);
    }

    /** Change password. Other devices' tokens are revoked. */
    public function updatePassword(Request $request): JsonResponse
    {
        // Same tolerance as sign-in: a temporary password never contains spaces.
        if ($request->user()->must_change_password && is_string($request->input('current_password'))) {
            $request->merge(['current_password' => trim($request->input('current_password'))]);
        }

        $data = $request->validate([
            'current_password' => ['required', 'current_password'],
            'password' => ['required', 'confirmed', 'different:current_password', Password::defaults()],
        ]);

        $user = $request->user();
        $wasTemporary = (bool) $user->must_change_password;
        $user->forceFill([
            'password' => $data['password'],
            'must_change_password' => false,
            'temporary_password_expires_at' => null,
        ])->save();

        $current = $user->currentAccessToken();
        $user->tokens()
            ->when($current instanceof PersonalAccessToken, fn ($q) => $q->where('id', '!=', $current->id))
            ->delete();

        $this->audit->log('user.password_changed', $user, metadata: $wasTemporary ? ['replaced_temporary_password' => true] : [], userId: $user->id);

        return response()->json(['message' => 'Password updated.']);
    }

    /** Businesses the current user belongs to, with roles and authorized branches. */
    public function memberships(Request $request): AnonymousResourceCollection
    {
        // Active memberships, plus invitations to existing accounts that are waiting for acceptance.
        $memberships = $request->user()->memberships()
            ->whereIn('status', [MembershipStatus::Active->value, MembershipStatus::Invited->value])
            ->with(['tenant', 'roles', 'branches'])
            ->orderBy('id')
            ->get();

        return MembershipResource::collection($memberships);
    }

    /** Accept an invitation to join a business (existing personal accounts). */
    public function acceptMembership(Request $request, TenantMembership $membership): MembershipResource
    {
        $membership = $this->ownInvitation($request, $membership);
        $membership->forceFill(['status' => MembershipStatus::Active->value, 'joined_at' => now()])->save();
        $this->audit->log('staff.invitation_accepted', $membership, ['status' => 'invited'], ['status' => 'active'], tenantId: $membership->tenant_id);

        return new MembershipResource($membership->load(['tenant', 'roles', 'branches']));
    }

    /** Decline an invitation. The membership is closed and grants nothing. */
    public function declineMembership(Request $request, TenantMembership $membership): JsonResponse
    {
        $membership = $this->ownInvitation($request, $membership);
        $membership->forceFill(['status' => MembershipStatus::Offboarded->value, 'offboarded_at' => now(), 'status_reason' => 'Invitation declined'])->save();
        $this->audit->log('staff.invitation_declined', $membership, ['status' => 'invited'], ['status' => 'offboarded'], tenantId: $membership->tenant_id);

        return response()->json(['message' => 'Invitation declined.']);
    }

    private function ownInvitation(Request $request, TenantMembership $membership): TenantMembership
    {
        // Other people's memberships are indistinguishable from missing ones.
        abort_unless($membership->user_id === $request->user()->id && $membership->hasStatus(MembershipStatus::Invited), 404, 'Resource not found.');

        return $membership;
    }
}
