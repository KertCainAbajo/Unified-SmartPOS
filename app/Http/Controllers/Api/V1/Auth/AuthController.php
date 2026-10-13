<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Resources\TenantResource;
use App\Http\Resources\UserResource;
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
     * With `device_name`: returns a personal access token for `Authorization: Bearer`.
     * Without it (SPA on a stateful domain, after GET /sanctum/csrf-cookie): starts a session.
     *
     * @unauthenticated
     */
    public function login(LoginRequest $request): JsonResponse
    {
        $data = $request->validated();
        $user = User::query()->where('email', $data['email'])->first();

        // Hash even when the user does not exist so response timing does not reveal accounts.
        $valid = Hash::check($data['password'], $user?->password ?? '$2y$12$'.str_repeat('a', 53));

        if (! $user || ! $valid) {
            throw ValidationException::withMessages(['email' => __('auth.failed')]);
        }

        if (! $user->isActive()) {
            throw ValidationException::withMessages(['email' => 'This account has been disabled.']);
        }

        $user->forceFill(['last_login_at' => now()])->save();
        $this->audit->log('auth.login', $user, metadata: ['client' => isset($data['device_name']) ? 'token' : 'session'], userId: $user->id);

        return response()->json([
            'user' => new UserResource($user),
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
