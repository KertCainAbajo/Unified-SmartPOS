<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Controllers\Controller;
use App\Http\Resources\MembershipResource;
use App\Http\Resources\UserResource;
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
        $data = $request->validate([
            'current_password' => ['required', 'current_password'],
            'password' => ['required', 'confirmed', 'different:current_password', Password::defaults()],
        ]);

        $user = $request->user();
        $user->forceFill(['password' => $data['password']])->save();

        $current = $user->currentAccessToken();
        $user->tokens()
            ->when($current instanceof PersonalAccessToken, fn ($q) => $q->where('id', '!=', $current->id))
            ->delete();

        $this->audit->log('user.password_changed', $user, userId: $user->id);

        return response()->json(['message' => 'Password updated.']);
    }

    /** Businesses the current user belongs to, with roles and authorized branches. */
    public function memberships(Request $request): AnonymousResourceCollection
    {
        $memberships = $request->user()->memberships()
            ->where('status', 'active')
            ->with(['tenant', 'roles', 'branches'])
            ->orderBy('id')
            ->get();

        return MembershipResource::collection($memberships);
    }
}
