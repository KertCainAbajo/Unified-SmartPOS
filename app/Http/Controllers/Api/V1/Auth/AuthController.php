<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Enums\UserStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Resources\TenantResource;
use App\Http\Resources\UserResource;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\Tenancy\TenantOnboardingService;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * @tags Authentication
 */
class AuthController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

    /**
     * Register a business owner and their business.
     *
     * Creates the user, the business, a main branch, a default register and the owner membership
     * in one transaction. Send `device_name` to receive a bearer token (mobile); omit it from a
     * stateful SPA origin to be logged in with a session cookie instead.
     *
     * @unauthenticated
     */
    public function register(RegisterRequest $request, TenantOnboardingService $onboarding): JsonResponse
    {
        $data = $request->validated();

        ['user' => $user, 'tenant' => $tenant] = $onboarding->registerOwner(
            [
                'name' => $data['name'],
                'email' => $data['email'],
                'phone' => $data['phone'] ?? null,
                'password' => $data['password'],
            ],
            $data['business'],
        );

        event(new Registered($user));

        return response()->json([
            'user' => new UserResource($user),
            'tenant' => new TenantResource($tenant),
            ...$this->establishSession($request, $user, $data['device_name'] ?? null),
        ], 201);
    }

    /**
     * Log in.
     *
     * Identify with `email`, or (company-managed staff) `business_code` + `username`, where `username` may also be
     * the employee ID. Owners, managers and HR (User & Access Manager, or any role with administrative permissions)
     * must use their email; a correct username password for them is refused with a hint.
     * With `device_name`: returns a personal access token for `Authorization: Bearer`.
     * Without it (SPA on a stateful domain, after GET /sanctum/csrf-cookie): starts a session.
     *
     * @unauthenticated
     */
    public function login(LoginRequest $request): JsonResponse
    {
        $data = $request->validated();
        $field = isset($data['username']) ? 'username' : 'email';
        $tenant = isset($data['username']) ? Tenant::query()->where('slug', $data['business_code'])->first() : null;

        $user = match ($field) {
            'email' => User::query()->where('email', $data['email'])->first(),
            'username' => $tenant ? $this->findStaff($tenant, $data['username']) : null,
        };

        // Hash even when the user does not exist so response timing does not reveal accounts.
        $hash = $user?->password ?? '$2y$12$'.str_repeat('a', 53);
        $valid = Hash::check($data['password'], $hash);
        // Temporary passwords never contain spaces, so a space picked up when copying one from the slip is ignored.
        // The extra check depends only on the input, so timing still reveals nothing about the account.
        $trimmed = trim($data['password']);
        if (! $valid && $trimmed !== $data['password']) {
            $valid = Hash::check($trimmed, $hash) && (bool) $user?->must_change_password;
        }

        if (! $user || ! $valid) {
            $this->audit->log('auth.login_failed', null, metadata: [
                'identifier' => $request->identifier(),
                'reason' => 'invalid_credentials',
            ], tenantId: $tenant?->id);

            throw ValidationException::withMessages([$field => __('auth.failed')]);
        }

        // Checked only after the password is verified, so roles are never revealed to someone guessing usernames.
        $membership = $field === 'username' ? $tenant->memberships()->where('user_id', $user->id)->first() : null;
        if ($membership?->requiresEmailSignIn()) {
            $this->audit->log('auth.login_failed', $user, metadata: ['reason' => 'email_sign_in_required'], tenantId: $tenant->id, userId: $user->id);

            throw ValidationException::withMessages([$field => 'Managers and administrators sign in with their email address.']);
        }

        // Staff choose their branch on the sign-in page; it must be one they are assigned to (checked after the
        // password, so assignments are never revealed to someone guessing).
        if ($membership && isset($data['branch_id']) && ! $this->assignedTo($membership, (int) $data['branch_id'])) {
            $this->audit->log('auth.login_failed', $user, metadata: ['reason' => 'branch_not_assigned', 'branch_id' => (int) $data['branch_id']], tenantId: $tenant->id, userId: $user->id);

            throw ValidationException::withMessages(['branch_id' => 'You are not assigned to this branch. Choose your branch or ask your manager.']);
        }

        if ($user->must_change_password && $user->temporary_password_expires_at?->isPast()) {
            $this->audit->log('auth.login_failed', $user, metadata: ['reason' => 'temporary_password_expired'], tenantId: $tenant?->id, userId: $user->id);

            throw ValidationException::withMessages([$field => 'This temporary password has expired. Ask your manager to reset your password.']);
        }

        if (! $user->isActive()) {
            $this->audit->log('auth.login_failed', $user, metadata: ['reason' => "account_{$user->status}"], tenantId: $tenant?->id, userId: $user->id);

            throw ValidationException::withMessages([$field => $user->status === UserStatus::Pending->value
                ? 'This account has not been activated yet. Use the activation code from your manager.'
                : 'This account has been disabled.']);
        }

        $user->forceFill(['last_login_at' => now()])->save();
        $this->audit->log('auth.login', $user, metadata: ['client' => isset($data['device_name']) ? 'token' : 'session'], userId: $user->id);

        return response()->json([
            'user' => new UserResource($user),
            // Clients route straight to "choose your password" when an administrator-issued temporary password was used.
            'must_change_password' => (bool) $user->must_change_password,
            ...$this->establishSession($request, $user, $data['device_name'] ?? null),
        ]);
    }

    /**
     * Log out the current device.
     *
     * Revokes the bearer token used for this request, or ends the SPA session.
     */
    public function logout(Request $request): JsonResponse
    {
        $user = $request->user();
        $token = $user->currentAccessToken();

        if ($token instanceof PersonalAccessToken) {
            $token->delete();
        } else {
            Auth::guard('web')->logout();
            if ($request->hasSession()) {
                $request->session()->invalidate();
                $request->session()->regenerateToken();
            }
        }

        $this->audit->log('auth.logout', $user, userId: $user->id);

        return response()->json(['message' => 'Logged out.']);
    }

    /** Revoke every token belonging to the current user (log out all mobile devices). */
    public function logoutAll(Request $request): JsonResponse
    {
        $user = $request->user();
        $count = $user->tokens()->delete();
        $this->audit->log('auth.logout_all', $user, metadata: ['tokens_revoked' => $count], userId: $user->id);

        return response()->json(['message' => 'All tokens revoked.', 'tokens_revoked' => $count]);
    }

    private function assignedTo(TenantMembership $membership, int $branchId): bool
    {
        $branch = $membership->tenant->branches()->whereKey($branchId)->where('is_active', true)->exists();

        return $branch && ($membership->all_branches || in_array($branchId, $membership->branchIds(), true));
    }

    /** Company-managed account of this business by username, or else by employee ID (case-insensitive). */
    private function findStaff(Tenant $tenant, string $identifier): ?User
    {
        $managed = User::query()->where('managed_by_tenant_id', $tenant->id);

        return (clone $managed)->where('username', $identifier)->first()
            ?? $managed->whereHas('memberships', fn ($m) => $m->where('tenant_id', $tenant->id)
                ->whereRaw('LOWER(employee_code) = ?', [mb_strtolower($identifier)]))->first();
    }

    /** @return array<string, mixed> */
    private function establishSession(Request $request, User $user, ?string $deviceName): array
    {
        if ($deviceName !== null) {
            return [
                'token_type' => 'Bearer',
                'token' => $user->createToken($deviceName)->plainTextToken,
            ];
        }

        if ($request->hasSession()) {
            Auth::guard('web')->login($user);
            $request->session()->regenerate();

            return ['session' => true];
        }

        throw ValidationException::withMessages([
            'device_name' => 'device_name is required for token-based clients.',
        ]);
    }
}
